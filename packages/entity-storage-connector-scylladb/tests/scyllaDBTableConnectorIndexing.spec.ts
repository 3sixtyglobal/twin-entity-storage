// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

// ScyllaDB expresses secondary indexes as clustering columns in the compound PRIMARY KEY;
// clustering columns cannot be dropped without dropping and recreating the table, making
// the drop/recreate pattern unsuitable for this connector.
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
import { nameof } from "@3sixty/nameof";
import { Client } from "cassandra-driver";
import { TEST_SCYLLA_CONFIG } from "./setupTestEnv.js";
import { ScyllaDBTableConnector } from "../src/scyllaDBTableConnector.js";

// ScyllaDB secondary indexes are implemented as clustering columns; they cannot be removed
// without a full table drop, so the two-table pattern is not viable here.
const SUPPORT_SECONDARY_INDEXING = false;

// Set to false for connectors that do not create named index objects in the database.
const SUPPORT_NAMED_INDEX_OBJECTS = false;

// Set to false for connectors which create no index for a property marked isSecondary.
const SUPPORT_SECONDARY_INDEX_CREATION = true;

// ScyllaDB derives its clustering key from the primary and secondary properties only, and CQL
// restricts ORDER BY to the primary key, so a sortDirection alone produces no index.
const SUPPORT_SORT_DIRECTION_INDEX_CREATION = false;

// ScyllaDB expresses a secondary index as a clustering column in the compound PRIMARY KEY,
// and CQL cannot add a clustering column to a table that already exists, so bootstrap
// cannot reconcile a schema which gains one.
const SUPPORT_INDEX_UPDATE = false;

// CQL secondary indexes cover a single column, and the one composite index a table has is its
// clustering key, which is already derived from the primary and secondary properties.
const SUPPORT_COMPOSITE_INDEXING = false;

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

/**
 * Read the clustering columns of a table in key order.
 * ScyllaDB expresses a secondary index as a clustering column of the compound PRIMARY KEY,
 * so the clustering key is where an indexed property shows up.
 * @param tableName The configured table name; the connector strips any character which is not
 * alphanumeric before creating the table, so the same is applied here.
 * @returns The clustering column names, ordered by their position in the key.
 */
async function clusteringColumns(tableName: string): Promise<string[]> {
	const safeTableName = tableName.replace(/[^\dA-Za-z]/g, "");
	const client = new Client({
		contactPoints: TEST_SCYLLA_CONFIG.hosts,
		localDataCenter: TEST_SCYLLA_CONFIG.localDataCenter,
		keyspace: TEST_SCYLLA_CONFIG.keyspace,
		protocolOptions: { port: TEST_SCYLLA_CONFIG.port }
	});
	try {
		await client.connect();
		const result = await client.execute(
			"SELECT column_name, kind, position FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?",
			[TEST_SCYLLA_CONFIG.keyspace, safeTableName],
			{ prepare: true }
		);
		return result.rows
			.filter(row => row.kind === "clustering")
			.sort((a, b) => Number(a.position) - Number(b.position))
			.map(row => String(row.column_name));
	} finally {
		await client.shutdown();
	}
}

function createIndexedConnector(): ScyllaDBTableConnector<IndexedTestType> {
	return new ScyllaDBTableConnector<IndexedTestType>({
		entitySchema: nameof<IndexedTestType>(),
		config: { ...TEST_SCYLLA_CONFIG, tableName: `${TEST_SCYLLA_CONFIG.tableName}_indexed` }
	});
}

function createSortedConnector(): ScyllaDBTableConnector<SortedTestType> {
	return new ScyllaDBTableConnector<SortedTestType>({
		entitySchema: nameof<SortedTestType>(),
		config: { ...TEST_SCYLLA_CONFIG, tableName: `${TEST_SCYLLA_CONFIG.tableName}_sorted` }
	});
}

function createUnindexedConnector(): ScyllaDBTableConnector<UnindexedTestType> {
	return new ScyllaDBTableConnector<UnindexedTestType>({
		entitySchema: nameof<UnindexedTestType>(),
		config: { ...TEST_SCYLLA_CONFIG, tableName: `${TEST_SCYLLA_CONFIG.tableName}_unindexed` }
	});
}

function createCompositeConnector(): ScyllaDBTableConnector<CompositeIndexedTestType> {
	return new ScyllaDBTableConnector<CompositeIndexedTestType>({
		entitySchema: nameof<CompositeIndexedTestType>(),
		config: { ...TEST_SCYLLA_CONFIG, tableName: `${TEST_SCYLLA_CONFIG.tableName}_composite` }
	});
}

describe("ScyllaDBTableConnector", () => {
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
			const tableName = `${TEST_SCYLLA_CONFIG.tableName}_secondary_${Date.now()}`;
			const connector = new ScyllaDBTableConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_SCYLLA_CONFIG, tableName }
			});

			try {
				expect(await connector.bootstrap()).toBe(true);

				// The primary property leads the clustering key and the secondary property follows it.
				expect(await clusteringColumns(tableName)).toEqual(["id", "category"]);

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
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_SORT_DIRECTION_INDEX_CREATION)(
		"bootstrap creates an index for a property which only declares a sortDirection",
		async () => {
			const connector = createSortedConnector();

			try {
				expect(await connector.bootstrap()).toBe(true);

				// A sort on the property has to return the entities in the requested order.
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
			const tableName = `${TEST_SCYLLA_CONFIG.tableName}_index_update_${Date.now()}`;
			const unindexed = new ScyllaDBTableConnector<UnindexedTestType>({
				entitySchema: nameof<UnindexedTestType>(),
				config: { ...TEST_SCYLLA_CONFIG, tableName }
			});
			const indexed = new ScyllaDBTableConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_SCYLLA_CONFIG, tableName }
			});

			try {
				// Create the table from a schema which does not index the category column.
				expect(await unindexed.bootstrap()).toBe(true);

				// Bootstrapping the same table from a schema which does index it must add the index.
				expect(await indexed.bootstrap()).toBe(true);

				// The added index has to actually serve queries routed through it.
				await indexed.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await indexed.get("catA", "category");
				expect(storedEntity?.id).toBe("1");
			} finally {
				try {
					await indexed.teardown?.();
				} catch {}
			}
		},
		60_000
	);
	test.skipIf(!SUPPORT_COMPOSITE_INDEXING)(
		"bootstrap creates a composite index for each multi-property index group",
		async () => {
			const connector = createCompositeConnector();

			try {
				expect(await connector.bootstrap()).toBe(true);
				expect(await connector.bootstrap()).toBe(true);

				await connector.set({
					id: "1",
					category: "catA",
					status: "active",
					value: 1
				});
				const storedEntity = await connector.get("1");
				expect(storedEntity?.status).toBe("active");
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
			const connector = createCompositeConnector();

			try {
				expect(await connector.bootstrap()).toBe(true);
				expect(await connector.bootstrap()).toBe(true);

				await connector.set({
					id: "1",
					category: "catA",
					status: "active",
					value: 1
				});
				const storedEntity = await connector.get("1");
				expect(storedEntity?.status).toBe("active");
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
		const connector = createCompositeConnector();

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
