// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

// DynamoDB GSIs are required by the connector's query routing; deleting a GSI causes
// the connector to throw rather than fall back to a scan.
import { ContextIdStore } from "@3sixty/context";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	LogicalOperator,
	SortDirection,
	entity,
	property
} from "@3sixty/entity";
import { IndexHelper } from "@3sixty/entity-storage-models";
import { nameof } from "@3sixty/nameof";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { TEST_DYNAMODB_CONFIG } from "./setupTestEnv.js";
import { DynamoDbEntityStorageConnector } from "../src/dynamoDbEntityStorageConnector.js";

// DynamoDB query routing requires GSIs to be present in the live table; the drop/recreate
// pattern used by other connectors is not supported here.
const SUPPORT_SECONDARY_INDEXING = false;

// Set to false for connectors that do not create named index objects in the database.
const SUPPORT_NAMED_INDEX_OBJECTS = false;

// Set to false for connectors which create no index for a property marked isSecondary.
const SUPPORT_SECONDARY_INDEX_CREATION = true;

// Set to false for connectors which create no index for a property that only declares a
// sortDirection.
const SUPPORT_SORT_DIRECTION_INDEX_CREATION = true;

// Set to false for connectors which cannot add an index to an already created store.
const SUPPORT_INDEX_UPDATE = true;

// DynamoDB expresses a group as a global secondary index with a multi-attribute sort key, which
// orders left to right; it applies one direction to the whole sort key, so the per-property
// directions cannot be honoured.
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

function createIndexedConnector(): DynamoDbEntityStorageConnector<IndexedTestType> {
	return new DynamoDbEntityStorageConnector<IndexedTestType>({
		entitySchema: nameof<IndexedTestType>(),
		config: { ...TEST_DYNAMODB_CONFIG, tableName: `${TEST_DYNAMODB_CONFIG.tableName}_indexed` }
	});
}

function createUnindexedConnector(): DynamoDbEntityStorageConnector<UnindexedTestType> {
	return new DynamoDbEntityStorageConnector<UnindexedTestType>({
		entitySchema: nameof<UnindexedTestType>(),
		config: { ...TEST_DYNAMODB_CONFIG, tableName: `${TEST_DYNAMODB_CONFIG.tableName}_unindexed` }
	});
}

/**
 * Open a direct client to the test table for describing its indexes.
 * @returns A new DynamoDB client.
 */
function openTestClient(): DynamoDB {
	return new DynamoDB({
		region: TEST_DYNAMODB_CONFIG.region,
		endpoint: TEST_DYNAMODB_CONFIG.endpoint,
		credentials: {
			accessKeyId: TEST_DYNAMODB_CONFIG.accessKeyId as string,
			secretAccessKey: TEST_DYNAMODB_CONFIG.secretAccessKey as string
		}
	});
}

/**
 * List the names of the global secondary indexes on a table.
 * @param client The client to describe the table with.
 * @param tableName The table to inspect.
 * @returns The index names.
 */
async function globalSecondaryIndexNames(client: DynamoDB, tableName: string): Promise<string[]> {
	const description = await client.describeTable({ TableName: tableName });
	return (description.Table?.GlobalSecondaryIndexes ?? []).map(index => index.IndexName as string);
}

function createCompositeConnector(
	tableName: string = `${TEST_DYNAMODB_CONFIG.tableName}_composite`
): DynamoDbEntityStorageConnector<CompositeIndexedTestType> {
	return new DynamoDbEntityStorageConnector<CompositeIndexedTestType>({
		entitySchema: nameof<CompositeIndexedTestType>(),
		config: { ...TEST_DYNAMODB_CONFIG, tableName }
	});
}

/**
 * Resolve the index name a connector generates for one of the schema's index groups.
 * @param tableName The table the index belongs to.
 * @param groupName The name of the index group.
 * @returns The generated index name.
 */
function compositeIndexName(tableName: string, groupName: string): string {
	const indexGroups = EntitySchemaHelper.getIndexGroups(
		EntitySchemaHelper.getSchema(CompositeIndexedTestType)
	);
	return IndexHelper.generateCompositeName(tableName, indexGroups[groupName]);
}

/**
 * Read the key schema of every global secondary index on a table, in key order.
 * @param tableName The table to inspect.
 * @returns The key attributes and their key types for each index, keyed by index name.
 */
async function indexKeySchemaByName(tableName: string): Promise<{ [indexName: string]: string[] }> {
	const client = openTestClient();
	try {
		const description = await client.describeTable({ TableName: tableName });
		const keySchemas: { [indexName: string]: string[] } = {};
		for (const index of description.Table?.GlobalSecondaryIndexes ?? []) {
			keySchemas[index.IndexName as string] = (index.KeySchema ?? []).map(
				key => `${key.AttributeName} ${key.KeyType}`
			);
		}
		return keySchemas;
	} finally {
		client.destroy();
	}
}

describe("DynamoDbEntityStorageConnector", () => {
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

				// Warm up both connectors so connection and plan setup is not timed
				await indexed.query({
					property: "category",
					value: queryCategories[0],
					comparison: ComparisonOperator.Equals
				});
				await unindexed.query({
					property: "category",
					value: queryCategories[0],
					comparison: ComparisonOperator.Equals
				});

				// Interleave the queries and compare medians so load spikes affect both equally
				const indexedTimes: number[] = [];
				const unindexedTimes: number[] = [];
				for (const cat of queryCategories) {
					let start = performance.now();
					await indexed.query({
						property: "category",
						value: cat,
						comparison: ComparisonOperator.Equals
					});
					indexedTimes.push(performance.now() - start);

					start = performance.now();
					await unindexed.query({
						property: "category",
						value: cat,
						comparison: ComparisonOperator.Equals
					});
					unindexedTimes.push(performance.now() - start);
				}

				const median = (times: number[]): number =>
					times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
				const indexedMs = median(indexedTimes);
				const unindexedMs = median(unindexedTimes);

				console.debug(
					`median indexed: ${indexedMs.toFixed(2)}ms, unindexed: ${unindexedMs.toFixed(2)}ms`
				);
				expect(indexedMs).toBeLessThan(unindexedMs);
			} finally {
				try {
					await indexed.teardown?.();
				} catch {}
				try {
					await unindexed.teardown?.();
				} catch {}
			}
		},
		300_000
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_CREATION)(
		"bootstrap creates an index for a property marked isSecondary",
		async () => {
			const tableName = `${TEST_DYNAMODB_CONFIG.tableName}_secondary_${Date.now()}`;
			const connector = new DynamoDbEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_DYNAMODB_CONFIG, tableName }
			});
			const client = openTestClient();

			try {
				expect(await connector.bootstrap()).toBe(true);

				expect(await globalSecondaryIndexNames(client, tableName)).toContain("categoryIndex");

				const description = await client.describeTable({ TableName: tableName });
				const categoryIndex = (description.Table?.GlobalSecondaryIndexes ?? []).find(
					index => index.IndexName === "categoryIndex"
				);
				expect(categoryIndex?.KeySchema?.find(key => key.KeyType === "RANGE")?.AttributeName).toBe(
					"category"
				);

				// The index has to actually serve a lookup routed through it.
				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("catA", "category");
				expect(storedEntity?.id).toBe("1");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				client.destroy();
			}
		},
		120_000
	);

	test.skipIf(!SUPPORT_SORT_DIRECTION_INDEX_CREATION)(
		"bootstrap creates an index for a property which only declares a sortDirection",
		async () => {
			const tableName = `${TEST_DYNAMODB_CONFIG.tableName}_sortdirection_${Date.now()}`;
			const connector = new DynamoDbEntityStorageConnector<SortedTestType>({
				entitySchema: nameof<SortedTestType>(),
				config: { ...TEST_DYNAMODB_CONFIG, tableName }
			});
			const client = openTestClient();

			try {
				expect(await connector.bootstrap()).toBe(true);

				// A sortDirection alone marks the property as sortable, which needs the same index
				// an isSecondary property gets.
				expect(await globalSecondaryIndexNames(client, tableName)).toContain("sortedIndex");

				const description = await client.describeTable({ TableName: tableName });
				const sortedIndex = (description.Table?.GlobalSecondaryIndexes ?? []).find(
					index => index.IndexName === "sortedIndex"
				);
				expect(sortedIndex?.KeySchema?.find(key => key.KeyType === "RANGE")?.AttributeName).toBe(
					"sorted"
				);

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
				client.destroy();
			}
		},
		120_000
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
		}
	}, 60_000);

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
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_INDEX_UPDATE)(
		"bootstrap adds an index when an existing store gains one in its schema",
		async () => {
			const tableName = `${TEST_DYNAMODB_CONFIG.tableName}_index_update_${Date.now()}`;
			const unindexed = new DynamoDbEntityStorageConnector<UnindexedTestType>({
				entitySchema: nameof<UnindexedTestType>(),
				config: { ...TEST_DYNAMODB_CONFIG, tableName }
			});
			const indexed = new DynamoDbEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_DYNAMODB_CONFIG, tableName }
			});
			const client = openTestClient();

			try {
				// Create the table from a schema which does not index the category property.
				expect(await unindexed.bootstrap()).toBe(true);
				expect(await globalSecondaryIndexNames(client, tableName)).not.toContain("categoryIndex");

				// Bootstrapping the same table from a schema which does index it must add the index.
				expect(await indexed.bootstrap()).toBe(true);

				const description = await client.describeTable({ TableName: tableName });
				const categoryIndex = (description.Table?.GlobalSecondaryIndexes ?? []).find(
					index => index.IndexName === "categoryIndex"
				);
				expect(categoryIndex).toBeDefined();
				expect(categoryIndex?.KeySchema?.find(key => key.KeyType === "RANGE")?.AttributeName).toBe(
					"category"
				);

				// The added index has to actually serve queries routed through it.
				await indexed.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await indexed.get("catA", "category");
				expect(storedEntity?.id).toBe("1");

				// A further bootstrap must not attempt to add the index again.
				expect(await indexed.bootstrap()).toBe(true);
				const indexNames = await globalSecondaryIndexNames(client, tableName);
				expect(indexNames.filter(name => name === "categoryIndex")).toHaveLength(1);
			} finally {
				try {
					await indexed.teardown?.();
				} catch {}
				client.destroy();
			}
		},
		120_000
	);

	test.skipIf(!SUPPORT_COMPOSITE_INDEXING)(
		"bootstrap creates a composite index for each multi-property index group",
		async () => {
			const tableName = `${TEST_DYNAMODB_CONFIG.tableName}_group_${Date.now()}`;
			const connector = createCompositeConnector(tableName);

			try {
				expect(await connector.bootstrap()).toBe(true);

				const keySchemas = await indexKeySchemaByName(tableName);

				// The sort key attributes follow the index positions, not the schema order; DynamoDB
				// has no per-attribute direction so only the order can be asserted.
				expect(keySchemas[compositeIndexName(tableName, "categoryStatus")]).toEqual([
					"partitionId HASH",
					"category RANGE",
					"status RANGE"
				]);
				expect(keySchemas[compositeIndexName(tableName, "statusValue")]).toEqual([
					"partitionId HASH",
					"value RANGE",
					"status RANGE"
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
			const tableName = `${TEST_DYNAMODB_CONFIG.tableName}_group_idem_${Date.now()}`;
			const connector = createCompositeConnector(tableName);

			try {
				expect(await connector.bootstrap()).toBe(true);
				expect(await connector.bootstrap()).toBe(true);

				const keySchemas = await indexKeySchemaByName(tableName);

				const groupIndexNames = Object.keys(keySchemas).filter(
					indexName =>
						indexName === compositeIndexName(tableName, "categoryStatus") ||
						indexName === compositeIndexName(tableName, "statusValue")
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
		const tableName = `${TEST_DYNAMODB_CONFIG.tableName}_group_query_${Date.now()}`;
		const connector = createCompositeConnector(tableName);

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
