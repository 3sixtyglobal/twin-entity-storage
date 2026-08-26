// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	entity,
	property
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { MongoClient } from "mongodb";
import { TEST_MONGODB_CONFIG } from "./setupTestEnv.js";
import { MongoDbEntityStorageConnector } from "../src/mongoDbEntityStorageConnector.js";

// Set to false for connectors that do not maintain secondary indexes (e.g. file, memory).
const SUPPORT_SECONDARY_INDEXING = true;

// Set to false for connectors that do not create named index objects in the database.
const SUPPORT_NAMED_INDEX_OBJECTS = false;

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
class UnindexedTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public category!: string;

	@property({ type: "number", format: "uint32" })
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

function buildConnectionUrl(): string {
	const port = TEST_MONGODB_CONFIG.port ?? 27017;
	return `mongodb://${TEST_MONGODB_CONFIG.host}:${port}/${TEST_MONGODB_CONFIG.database}`;
}

describe("MongoDbEntityStorageConnector", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<IndexedTestType>(), () =>
			EntitySchemaHelper.getSchema(IndexedTestType)
		);
		EntitySchemaFactory.register(nameof<UnindexedTestType>(), () =>
			EntitySchemaHelper.getSchema(UnindexedTestType)
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
});
