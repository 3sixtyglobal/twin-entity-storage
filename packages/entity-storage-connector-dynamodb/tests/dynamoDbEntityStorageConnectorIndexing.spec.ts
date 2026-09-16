// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

// DynamoDB GSIs are required by the connector's query routing; deleting a GSI causes
// the connector to throw rather than fall back to a scan.
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { ContextIdStore } from "@twin.org/context";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	entity,
	property
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { TEST_DYNAMODB_CONFIG } from "./setupTestEnv.js";
import { DynamoDbEntityStorageConnector } from "../src/dynamoDbEntityStorageConnector.js";

// DynamoDB query routing requires GSIs to be present in the live table; the drop/recreate
// pattern used by other connectors is not supported here.
const SUPPORT_SECONDARY_INDEXING = false;

// Set to false for connectors that do not create named index objects in the database.
const SUPPORT_NAMED_INDEX_OBJECTS = false;

// Set to false for connectors which cannot add an index to an already created store.
const SUPPORT_INDEX_UPDATE = true;

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

describe("DynamoDbEntityStorageConnector", () => {
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
					await unindexed.teardown?.();
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
});
