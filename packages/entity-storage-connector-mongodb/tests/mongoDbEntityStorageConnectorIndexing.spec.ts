// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	LogicalOperator,
	SortDirection,
	entity,
	property
} from "@twin.org/entity";
import { IndexHelper } from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";
import { MongoClient } from "mongodb";
import { TEST_MONGODB_CONFIG } from "./setupTestEnv.js";
import { MongoDbEntityStorageConnector } from "../src/mongoDbEntityStorageConnector.js";

// Set to false for connectors that do not maintain secondary indexes (e.g. file, memory).
const SUPPORT_SECONDARY_INDEXING = true;

// Set to false for connectors that do not create named index objects in the database.
const SUPPORT_NAMED_INDEX_OBJECTS = false;

// Set to false for connectors which create no index for a property marked isSecondary.
const SUPPORT_SECONDARY_INDEX_CREATION = true;

// Set to false for connectors which create no index for a property that only declares a
// sortDirection.
const SUPPORT_SORT_DIRECTION_INDEX_CREATION = true;

// Set to false for connectors which cannot add an index to an already created store.
const SUPPORT_INDEX_UPDATE = true;

// Set to false for connectors which cannot create a composite index over a schema index group.
const SUPPORT_COMPOSITE_INDEXING = true;

@entity()
class IndexedTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", isSecondary: true })
	public category!: string;

	@property({ type: "number", format: "uint32" })
	public value!: number;
}

@entity()
class SortedTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", sortDirection: SortDirection.Descending })
	public sorted!: string;

	@property({ type: "number", format: "uint32" })
	public value!: number;
}

@entity()
class UnindexedTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public category!: string;

	@property({ type: "number", format: "uint32" })
	public value!: number;
}

/**
 * Resolve the index name a connector generates for one of the schema's index groups.
 * @param tableName The table or collection the index belongs to.
 * @param groupName The name of the index group.
 * @returns The generated index name.
 */
function compositeIndexName(tableName: string, groupName: string): string {
	const indexGroups = EntitySchemaHelper.getIndexGroups(
		EntitySchemaHelper.getSchema(CompositeIndexedTestType)
	);
	return IndexHelper.generateCompositeName(tableName, indexGroups[groupName]);
}

@entity()
class CompositeIndexedTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({
		type: "string",
		indexGroup: [{ name: "categoryStatus", direction: SortDirection.Ascending, index: 0 }]
	})
	public category!: string;

	@property({
		type: "string",
		indexGroup: [
			{ name: "categoryStatus", direction: SortDirection.Descending, index: 1 },
			{ name: "statusValue", direction: SortDirection.Ascending, index: 1 }
		]
	})
	public status!: string;

	@property({
		type: "number",
		format: "uint32",
		indexGroup: [{ name: "statusValue", direction: SortDirection.Descending, index: 0 }]
	})
	public value!: number;
}

function createIndexedConnector(): MongoDbEntityStorageConnector<IndexedTestType> {
	return new MongoDbEntityStorageConnector<IndexedTestType>({
		entitySchema: nameof<IndexedTestType>(),
		config: {
			...TEST_MONGODB_CONFIG,
			collection: `${TEST_MONGODB_CONFIG.collection}_indexed_${Date.now()}`
		}
	});
}

function createUnindexedConnector(): MongoDbEntityStorageConnector<UnindexedTestType> {
	return new MongoDbEntityStorageConnector<UnindexedTestType>({
		entitySchema: nameof<UnindexedTestType>(),
		config: {
			...TEST_MONGODB_CONFIG,
			collection: `${TEST_MONGODB_CONFIG.collection}_unindexed_${Date.now()}`
		}
	});
}

/**
 * Read the key fields of every index on a collection, in key order.
 * @param collectionName The collection to inspect.
 * @returns The key fields and their sort order for each index, keyed by index name.
 */
async function indexFieldsByName(
	collectionName: string
): Promise<{ [indexName: string]: string[] }> {
	const client = new MongoClient(buildConnectionUrl());
	try {
		await client.connect();
		const indexes = await client
			.db(TEST_MONGODB_CONFIG.database)
			.collection(collectionName)
			.listIndexes()
			.toArray();
		const indexFields: { [indexName: string]: string[] } = {};
		for (const index of indexes) {
			const key = index.key as { [k: string]: number };
			indexFields[index.name as string] = Object.keys(key).map(
				field => `${field} ${key[field] === -1 ? "DESC" : "ASC"}`
			);
		}
		return indexFields;
	} finally {
		await client.close();
	}
}

function buildConnectionUrl(): string {
	const port = TEST_MONGODB_CONFIG.port ?? 27017;
	return `mongodb://${TEST_MONGODB_CONFIG.host}:${port}/${TEST_MONGODB_CONFIG.database}`;
}

describe("MongoDbEntityStorageConnector", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<IndexedTestType>(), () =>
			EntitySchemaHelper.getSchema(IndexedTestType)
		);
		EntitySchemaFactory.register(nameof<SortedTestType>(), () =>
			EntitySchemaHelper.getSchema(SortedTestType)
		);
		EntitySchemaFactory.register(nameof<UnindexedTestType>(), () =>
			EntitySchemaHelper.getSchema(UnindexedTestType)
		);
		EntitySchemaFactory.register(nameof<CompositeIndexedTestType>(), () =>
			EntitySchemaHelper.getSchema(CompositeIndexedTestType)
		);

		ContextIdStore.getContextIds = vi
			.fn()
			.mockReturnValue({ node: "node", tenant: "tenant", user: "user" });
	});

	test.skipIf(!SUPPORT_SECONDARY_INDEXING)(
		"secondary index reduces query time compared to full scan",
		async () => {
			const indexed = createIndexedConnector();
			const unindexed = createUnindexedConnector();

			try {
				await indexed.bootstrap();
				await unindexed.bootstrap();

				const rowCount = process.env.CI ? 5_000 : 50_000;

				const items: IndexedTestType[] = [];
				for (let i = 0; i < rowCount; i++) {
					items.push({
						id: String(i + 1),
						category: `cat${String(i + 1).padStart(6, "0")}`,
						value: i
					});
				}
				await indexed.setBatch(items);
				await unindexed.setBatch(items);

				const queryCategories: string[] = [];
				for (let i = 0; i < 20; i++) {
					const step = i * 1_000;
					queryCategories.push(`cat${String(step + 1).padStart(6, "0")}`);
				}

				const startIndexed = Date.now();
				for (const cat of queryCategories) {
					await indexed.query({
						property: "category",
						value: cat,
						comparison: ComparisonOperator.Equals
					});
				}
				const indexedMs = Date.now() - startIndexed;

				const startUnindexed = Date.now();
				for (const cat of queryCategories) {
					await unindexed.query({
						property: "category",
						value: cat,
						comparison: ComparisonOperator.Equals
					});
				}
				const unindexedMs = Date.now() - startUnindexed;

				console.debug(
					`indexed: ${indexedMs}ms, unindexed: ${unindexedMs}ms, improvement: ${unindexedMs - indexedMs}ms`
				);
				expect(indexedMs).toBeLessThan(unindexedMs);
			} finally {
				try {
					await indexed.teardown?.();
				} catch {}
				try {
					await indexed.stop?.();
				} catch {}
				try {
					await unindexed.teardown?.();
				} catch {}
				try {
					await unindexed.stop?.();
				} catch {}
			}
		},
		300_000
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_CREATION)(
		"bootstrap creates an index for a property marked isSecondary",
		async () => {
			const collectionName = `${TEST_MONGODB_CONFIG.collection}_secondary_${Date.now()}`;
			const connector = new MongoDbEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
			});

			try {
				expect(await connector.bootstrap()).toBe(true);

				// MongoDB names the index itself, so the key it covers is what identifies it.
				const indexFields = await indexFieldsByName(collectionName);
				expect(Object.values(indexFields)).toContainEqual(["category ASC"]);

				// The index has to actually serve a query on the property it covers.
				await connector.set({ id: "1", category: "catA", value: 1 });
				const result = await connector.query({
					property: "category",
					value: "catA",
					comparison: ComparisonOperator.Equals
				});
				expect(result.entities.map(e => e.id)).toEqual(["1"]);
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_SORT_DIRECTION_INDEX_CREATION)(
		"bootstrap creates an index for a property which only declares a sortDirection",
		async () => {
			const collectionName = `${TEST_MONGODB_CONFIG.collection}_sortdirection_${Date.now()}`;
			const connector = new MongoDbEntityStorageConnector<SortedTestType>({
				entitySchema: nameof<SortedTestType>(),
				config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
			});

			try {
				expect(await connector.bootstrap()).toBe(true);

				// A sortDirection alone marks the property as sortable, which needs the same index
				// an isSecondary property gets. A single-field index is traversed in either
				// direction, so the declared direction does not change the key.
				const indexFields = await indexFieldsByName(collectionName);
				expect(Object.values(indexFields)).toContainEqual(["sorted ASC"]);

				// The index has to actually serve a sort on the property it covers.
				await connector.set({ id: "1", sorted: "a", value: 1 });
				await connector.set({ id: "2", sorted: "b", value: 2 });
				const result = await connector.query(undefined, [
					{ property: "sorted", sortDirection: SortDirection.Descending }
				]);
				expect(result.entities.map(e => e.id)).toEqual(["2", "1"]);
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test("bootstrap is idempotent when called multiple times", async () => {
		const connector = createIndexedConnector();

		try {
			const firstResult = await connector.bootstrap();
			const secondResult = await connector.bootstrap();

			expect(firstResult).toBe(true);
			expect(secondResult).toBe(true);

			await connector.set({ id: "1", category: "catA", value: 1 });
			const storedEntity = await connector.get("1");
			expect(storedEntity?.category).toBe("catA");
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
		}
	}, 60_000);

	test("bootstrap returns true when a non-unique index already exists on the primary property", async () => {
		const collectionName = `${TEST_MONGODB_CONFIG.collection}_primary_conflict_${Date.now()}`;
		const connector = new MongoDbEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
		});
		const client = new MongoClient(buildConnectionUrl());
		try {
			await client.connect();
			const col = client.db(TEST_MONGODB_CONFIG.database).collection(collectionName);

			// Seed a non-unique index on the primary property; bootstrap would normally create it unique.
			await col.createIndex({ id: 1 });

			const result = await connector.bootstrap();
			expect(result).toBe(true);

			// The pre-existing non-unique index must not have been overwritten.
			const indexes = await col.listIndexes().toArray();
			const idIndex = indexes.find(idx => {
				const key = idx.key as { [k: string]: number };
				return Object.keys(key).length === 1 && key.id === 1;
			});
			expect(idIndex).toBeDefined();
			expect(idIndex?.unique).toBeUndefined();
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
			await client.close();
		}
	});

	test("bootstrap returns true when a sparse index already exists on a secondary property", async () => {
		const collectionName = `${TEST_MONGODB_CONFIG.collection}_secondary_conflict_${Date.now()}`;
		const connector = new MongoDbEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
		});
		const client = new MongoClient(buildConnectionUrl());
		try {
			await client.connect();
			const col = client.db(TEST_MONGODB_CONFIG.database).collection(collectionName);

			// Seed a sparse index on the secondary property; bootstrap would normally create a plain one.
			await col.createIndex({ category: 1 }, { sparse: true });

			const result = await connector.bootstrap();
			expect(result).toBe(true);

			// The sparse index must not have been overwritten.
			const indexes = await col.listIndexes().toArray();
			const catIndex = indexes.find(idx => {
				const key = idx.key as { [k: string]: number };
				return Object.keys(key).length === 1 && key.category === 1;
			});
			expect(catIndex).toBeDefined();
			expect(catIndex?.sparse).toBe(true);
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
			await client.close();
		}
	});

	test("does not create a duplicate index when a descending index already covers a secondary property", async () => {
		const collectionName = `${TEST_MONGODB_CONFIG.collection}_desc_secondary_${Date.now()}`;
		const connector = new MongoDbEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
		});
		const client = new MongoClient(buildConnectionUrl());
		try {
			await client.connect();
			const col = client.db(TEST_MONGODB_CONFIG.database).collection(collectionName);

			await col.createIndex({ category: -1 });

			const result = await connector.bootstrap();
			expect(result).toBe(true);

			const indexes = await col.listIndexes().toArray();
			const categoryIndexes = indexes.filter(idx => {
				const key = idx.key as { [k: string]: number };
				return Object.keys(key).length === 1 && Object.keys(key)[0] === "category";
			});
			expect(categoryIndexes).toHaveLength(1);
			expect(categoryIndexes[0].key.category).toBe(-1);
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
			await client.close();
		}
	});

	test("does not create a duplicate index when a compound index leads on a secondary property", async () => {
		const collectionName = `${TEST_MONGODB_CONFIG.collection}_compound_secondary_${Date.now()}`;
		const connector = new MongoDbEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
		});
		const client = new MongoClient(buildConnectionUrl());
		try {
			await client.connect();
			const col = client.db(TEST_MONGODB_CONFIG.database).collection(collectionName);

			await col.createIndex({ category: 1, value: 1 });

			const result = await connector.bootstrap();
			expect(result).toBe(true);

			const indexes = await col.listIndexes().toArray();
			const singleFieldCategoryIndex = indexes.find(idx => {
				const key = idx.key as { [k: string]: number };
				return Object.keys(key).length === 1 && key.category === 1;
			});
			expect(singleFieldCategoryIndex).toBeUndefined();
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
			await client.close();
		}
	});

	test("does not create a duplicate unique index when a descending unique index exists on the primary property", async () => {
		const collectionName = `${TEST_MONGODB_CONFIG.collection}_desc_primary_${Date.now()}`;
		const connector = new MongoDbEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
		});
		const client = new MongoClient(buildConnectionUrl());
		try {
			await client.connect();
			const col = client.db(TEST_MONGODB_CONFIG.database).collection(collectionName);

			await col.createIndex({ id: -1 }, { unique: true });

			const result = await connector.bootstrap();
			expect(result).toBe(true);

			const indexes = await col.listIndexes().toArray();
			const idIndexes = indexes.filter(idx => {
				const key = idx.key as { [k: string]: number };
				return Object.keys(key).length === 1 && Object.keys(key)[0] === "id";
			});
			expect(idIndexes).toHaveLength(1);
			expect(idIndexes[0].key.id).toBe(-1);
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
			await client.close();
		}
	});

	test("still creates a unique index when a non-unique descending index exists on the primary property", async () => {
		const collectionName = `${TEST_MONGODB_CONFIG.collection}_desc_primary_nonunique_${Date.now()}`;
		const connector = new MongoDbEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
		});
		const client = new MongoClient(buildConnectionUrl());
		try {
			await client.connect();
			const col = client.db(TEST_MONGODB_CONFIG.database).collection(collectionName);

			await col.createIndex({ id: -1 });

			const result = await connector.bootstrap();
			expect(result).toBe(true);

			const indexes = await col.listIndexes().toArray();
			const uniqueIdIndex = indexes.find(idx => {
				const key = idx.key as { [k: string]: number };
				return Object.keys(key).length === 1 && key.id === 1;
			});
			expect(uniqueIdIndex).toBeDefined();
			expect(uniqueIdIndex?.unique).toBe(true);
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
			await client.close();
		}
	});

	test("still creates its own index when a secondary property is only a non-leading member of a compound index", async () => {
		const collectionName = `${TEST_MONGODB_CONFIG.collection}_non_leading_${Date.now()}`;
		const connector = new MongoDbEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
		});
		const client = new MongoClient(buildConnectionUrl());
		try {
			await client.connect();
			const col = client.db(TEST_MONGODB_CONFIG.database).collection(collectionName);

			await col.createIndex({ value: 1, category: 1 });

			const result = await connector.bootstrap();
			expect(result).toBe(true);

			const indexes = await col.listIndexes().toArray();
			const categoryIndex = indexes.find(idx => {
				const key = idx.key as { [k: string]: number };
				return Object.keys(key).length === 1 && key.category === 1;
			});
			expect(categoryIndex).toBeDefined();
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
			await client.close();
		}
	});

	test("still creates its own index when a secondary property is only covered by a hidden index", async () => {
		const collectionName = `${TEST_MONGODB_CONFIG.collection}_hidden_${Date.now()}`;
		const connector = new MongoDbEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
		});
		const client = new MongoClient(buildConnectionUrl());
		try {
			await client.connect();
			const col = client.db(TEST_MONGODB_CONFIG.database).collection(collectionName);

			await col.createIndex({ category: -1 }, { hidden: true });

			const result = await connector.bootstrap();
			expect(result).toBe(true);

			const indexes = await col.listIndexes().toArray();
			const categoryIndex = indexes.find(idx => {
				const key = idx.key as { [k: string]: number };
				return Object.keys(key).length === 1 && key.category === 1;
			});
			expect(categoryIndex).toBeDefined();
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
			await client.close();
		}
	});

	test("still creates its own index when a secondary property is only covered by a sparse descending index", async () => {
		const collectionName = `${TEST_MONGODB_CONFIG.collection}_sparse_desc_${Date.now()}`;
		const connector = new MongoDbEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
		});
		const client = new MongoClient(buildConnectionUrl());
		try {
			await client.connect();
			const col = client.db(TEST_MONGODB_CONFIG.database).collection(collectionName);

			await col.createIndex({ category: -1 }, { sparse: true });

			const result = await connector.bootstrap();
			expect(result).toBe(true);

			const indexes = await col.listIndexes().toArray();
			const categoryIndex = indexes.find(idx => {
				const key = idx.key as { [k: string]: number };
				return Object.keys(key).length === 1 && key.category === 1;
			});
			expect(categoryIndex).toBeDefined();
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
			await client.close();
		}
	});

	test("still creates its own index when a secondary property is only covered by a partial index", async () => {
		const collectionName = `${TEST_MONGODB_CONFIG.collection}_partial_${Date.now()}`;
		const connector = new MongoDbEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
		});
		const client = new MongoClient(buildConnectionUrl());
		try {
			await client.connect();
			const col = client.db(TEST_MONGODB_CONFIG.database).collection(collectionName);

			await col.createIndex({ category: -1 }, { partialFilterExpression: { value: { $gt: 0 } } });

			const result = await connector.bootstrap();
			expect(result).toBe(true);

			const indexes = await col.listIndexes().toArray();
			const categoryIndex = indexes.find(idx => {
				const key = idx.key as { [k: string]: number };
				return Object.keys(key).length === 1 && key.category === 1;
			});
			expect(categoryIndex).toBeDefined();
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
			await client.close();
		}
	});

	test("still creates the unique primary index when the primary property only leads a compound index", async () => {
		const collectionName = `${TEST_MONGODB_CONFIG.collection}_compound_primary_${Date.now()}`;
		const connector = new MongoDbEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
		});
		const client = new MongoClient(buildConnectionUrl());
		try {
			await client.connect();
			const col = client.db(TEST_MONGODB_CONFIG.database).collection(collectionName);

			await col.createIndex({ id: 1, value: 1 });

			const result = await connector.bootstrap();
			expect(result).toBe(true);

			const indexes = await col.listIndexes().toArray();
			const idIndex = indexes.find(idx => {
				const key = idx.key as { [k: string]: number };
				return Object.keys(key).length === 1 && key.id === 1;
			});
			expect(idIndex).toBeDefined();
			expect(idIndex?.unique).toBe(true);
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
			await client.close();
		}
	});

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"does not create a duplicate index when the column is already covered by a differently named index",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"still creates its own index when the column is only a non-leading member of another index",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"still creates its own index when a same-named table in another schema has a covering index",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"still creates its own index when the column is only covered by an invalid or invisible index",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"still creates its own index when the column is only covered by a FULLTEXT or partial index",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"does not create a duplicate index after an index naming-scheme change",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"does not create a duplicate index when the column is already covered by a descending index",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"does not create a duplicate index when the column is already covered by a compound index leading on it",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_INDEX_UPDATE)(
		"bootstrap adds an index when an existing store gains one in its schema",
		async () => {
			const collectionName = `${TEST_MONGODB_CONFIG.collection}_index_update_${Date.now()}`;
			const unindexed = new MongoDbEntityStorageConnector<UnindexedTestType>({
				entitySchema: nameof<UnindexedTestType>(),
				config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
			});
			const indexed = new MongoDbEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MONGODB_CONFIG, collection: collectionName }
			});
			const client = new MongoClient(buildConnectionUrl());

			try {
				await client.connect();
				const col = client.db(TEST_MONGODB_CONFIG.database).collection(collectionName);

				// Create the collection from a schema which does not index the category property.
				expect(await unindexed.bootstrap()).toBe(true);
				const before = await col.listIndexes().toArray();
				expect(before.some(index => "category" in (index.key as { [k: string]: number }))).toBe(
					false
				);

				// Bootstrapping the same collection from a schema which does index it must add the index.
				expect(await indexed.bootstrap()).toBe(true);
				const after = await col.listIndexes().toArray();
				const categoryIndex = after.find(index => {
					const key = index.key as { [k: string]: number };
					return Object.keys(key).length === 1 && key.category === 1;
				});
				expect(categoryIndex).toBeDefined();

				// The added index has to actually serve queries routed through it.
				await indexed.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await indexed.get("catA", "category");
				expect(storedEntity?.id).toBe("1");

				// A further bootstrap must not create the index a second time.
				expect(await indexed.bootstrap()).toBe(true);
				const afterSecond = await col.listIndexes().toArray();
				expect(afterSecond).toHaveLength(after.length);
			} finally {
				try {
					await indexed.teardown?.();
				} catch {}
				try {
					await indexed.stop?.();
				} catch {}
				try {
					await unindexed.stop?.();
				} catch {}
				await client.close();
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_COMPOSITE_INDEXING)(
		"bootstrap creates a composite index for each multi-property index group",
		async () => {
			const collection = `${TEST_MONGODB_CONFIG.collection}_group_${Date.now()}`;
			const connector = new MongoDbEntityStorageConnector<CompositeIndexedTestType>({
				entitySchema: nameof<CompositeIndexedTestType>(),
				config: { ...TEST_MONGODB_CONFIG, collection }
			});

			try {
				expect(await connector.bootstrap()).toBe(true);

				const indexFields = await indexFieldsByName(collection);

				// The group order and directions come from the index entries, not the schema order.
				expect(indexFields[compositeIndexName(collection, "categoryStatus")]).toEqual([
					"category ASC",
					"status DESC"
				]);
				expect(indexFields[compositeIndexName(collection, "statusValue")]).toEqual([
					"value DESC",
					"status ASC"
				]);
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_COMPOSITE_INDEXING)(
		"bootstrap does not create a duplicate composite index when called multiple times",
		async () => {
			const collection = `${TEST_MONGODB_CONFIG.collection}_group_idempotent_${Date.now()}`;
			const connector = new MongoDbEntityStorageConnector<CompositeIndexedTestType>({
				entitySchema: nameof<CompositeIndexedTestType>(),
				config: { ...TEST_MONGODB_CONFIG, collection }
			});

			try {
				expect(await connector.bootstrap()).toBe(true);
				expect(await connector.bootstrap()).toBe(true);

				const indexFields = await indexFieldsByName(collection);

				const groupIndexNames = Object.keys(indexFields).filter(
					indexName =>
						indexName === compositeIndexName(collection, "categoryStatus") ||
						indexName === compositeIndexName(collection, "statusValue")
				);
				expect(groupIndexNames.length).toBe(2);
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test("query filtering on every property of an index group returns only the matching entities", async () => {
		const collection = `${TEST_MONGODB_CONFIG.collection}_group_query_${Date.now()}`;
		const connector = new MongoDbEntityStorageConnector<CompositeIndexedTestType>({
			entitySchema: nameof<CompositeIndexedTestType>(),
			config: { ...TEST_MONGODB_CONFIG, collection }
		});

		try {
			expect(await connector.bootstrap()).toBe(true);

			await connector.setBatch([
				{ id: "1", category: "catA", status: "active", value: 1 },
				{ id: "2", category: "catA", status: "archived", value: 2 },
				{ id: "3", category: "catB", status: "active", value: 3 },
				{ id: "4", category: "catA", status: "active", value: 4 }
			]);

			const result = await connector.query({
				conditions: [
					{ property: "category", value: "catA", comparison: ComparisonOperator.Equals },
					{ property: "status", value: "active", comparison: ComparisonOperator.Equals }
				],
				logicalOperator: LogicalOperator.And
			});

			expect(result.entities.map(matched => matched.id).sort()).toEqual(["1", "4"]);
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
		}
	}, 60_000);
});
