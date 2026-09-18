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
import { createPool, type Pool } from "mysql2/promise";
import { TEST_MYSQL_CONFIG } from "./setupTestEnv.js";
import { MySqlEntityStorageConnector } from "../src/mysqlEntityStorageConnector.js";

// Set to false for connectors that do not maintain secondary indexes (e.g. file, memory).
const SUPPORT_SECONDARY_INDEXING = true;

// Set to false for connectors that do not create named index objects in the database.
const SUPPORT_NAMED_INDEX_OBJECTS = true;

// Set to false for connectors which create no index for a property marked isSecondary.
const SUPPORT_SECONDARY_INDEX_CREATION = true;

// Set to false for connectors which create no index for a property that only declares a
// sortDirection.
const SUPPORT_SORT_DIRECTION_INDEX_CREATION = true;

// Set to false for connectors which cannot add an index to an already created store.
const SUPPORT_INDEX_UPDATE = true;

// Set to false for connectors which cannot create a composite index over a schema index group.
const SUPPORT_COMPOSITE_INDEXING = true;

// The column the connector partitions on, which leads the primary key and every index it creates.
const PARTITION_KEY = "partitionId";

/**
 * List the names of the indexes that cover the given column for a table, meaning the partition
 * key leads the index and the column follows it.
 * @param pool The pool to query with.
 * @param tableName The table to inspect.
 * @param columnName The column that must be the second key column of the index.
 * @returns The names of the indexes which cover columnName.
 */
async function indexNamesCoveringColumn(
	pool: Pool,
	tableName: string,
	columnName: string
): Promise<string[]> {
	const [rows] = await pool.query(
		`SELECT DISTINCT partitioned.index_name AS indexName
		FROM INFORMATION_SCHEMA.STATISTICS partitioned
		JOIN INFORMATION_SCHEMA.STATISTICS covered
			ON covered.table_schema = partitioned.table_schema
			AND covered.table_name = partitioned.table_name
			AND covered.index_name = partitioned.index_name
		WHERE partitioned.table_schema = ?
			AND partitioned.table_name = ?
			AND partitioned.column_name = ?
			AND partitioned.seq_in_index = 1
			AND covered.column_name = ?
			AND covered.seq_in_index = 2`,
		[TEST_MYSQL_CONFIG.database, tableName, PARTITION_KEY, columnName]
	);
	return (rows as { indexName: string }[]).map(row => row.indexName);
}

/**
 * Count how many indexes cover the given column for a table.
 * @param pool The pool to query with.
 * @param tableName The table to inspect.
 * @param columnName The column that must be the second key column of the index.
 * @returns The number of indexes which cover columnName.
 */
async function countIndexesCoveringColumn(
	pool: Pool,
	tableName: string,
	columnName: string
): Promise<number> {
	return (await indexNamesCoveringColumn(pool, tableName, columnName)).length;
}

/**
 * List the names of the indexes that lead on the given column for a table, which is the shape an
 * operator's own index takes rather than the shape the connector creates.
 * @param pool The pool to query with.
 * @param tableName The table to inspect.
 * @param columnName The column that must be the leading (first) key column of the index.
 * @returns The names of the indexes whose leading column is columnName.
 */
async function indexNamesLeadingOnColumn(
	pool: Pool,
	tableName: string,
	columnName: string
): Promise<string[]> {
	const [rows] = await pool.query(
		"SELECT DISTINCT index_name AS indexName FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema = ? AND table_name = ? AND column_name = ? AND seq_in_index = 1",
		[TEST_MYSQL_CONFIG.database, tableName, columnName]
	);
	return (rows as { indexName: string }[]).map(row => row.indexName);
}

/**
 * Read the key columns of every index on a table, in key order.
 * @param pool The pool to query with.
 * @param tableName The table to inspect.
 * @returns The key columns and their sort order for each index, keyed by index name.
 */
async function indexColumnsByName(
	pool: Pool,
	tableName: string
): Promise<{ [indexName: string]: string[] }> {
	const [rows] = await pool.query(
		"SELECT index_name AS indexName, column_name AS columnName, collation AS sortOrder FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema = ? AND table_name = ? ORDER BY index_name, seq_in_index",
		[TEST_MYSQL_CONFIG.database, tableName]
	);
	const indexColumns: { [indexName: string]: string[] } = {};
	for (const row of rows as { indexName: string; columnName: string; sortOrder: string }[]) {
		indexColumns[row.indexName] ??= [];
		indexColumns[row.indexName].push(`${row.columnName} ${row.sortOrder === "D" ? "DESC" : "ASC"}`);
	}
	return indexColumns;
}

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

function createIndexedConnector(): MySqlEntityStorageConnector<IndexedTestType> {
	return new MySqlEntityStorageConnector<IndexedTestType>({
		entitySchema: nameof<IndexedTestType>(),
		config: {
			...TEST_MYSQL_CONFIG,
			tableName: `${TEST_MYSQL_CONFIG.tableName}_indexed_${Date.now()}`
		}
	});
}

function createUnindexedConnector(): MySqlEntityStorageConnector<UnindexedTestType> {
	return new MySqlEntityStorageConnector<UnindexedTestType>({
		entitySchema: nameof<UnindexedTestType>(),
		config: {
			...TEST_MYSQL_CONFIG,
			tableName: `${TEST_MYSQL_CONFIG.tableName}_unindexed_${Date.now()}`
		}
	});
}

describe("MySqlEntityStorageConnector", () => {
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
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_secondary_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				expect(await connector.bootstrap()).toBe(true);

				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});

				expect(await indexNamesCoveringColumn(pool, tableName, "category")).toEqual([
					IndexHelper.generateName(tableName, "category")
				]);

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
					await pool?.end();
				} catch {}
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
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_sortdirection_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<SortedTestType>({
				entitySchema: nameof<SortedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				expect(await connector.bootstrap()).toBe(true);

				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});

				// A sortDirection alone marks the property as sortable, which needs the same index
				// an isSecondary property gets.
				expect(await indexNamesCoveringColumn(pool, tableName, "sorted")).toEqual([
					IndexHelper.generateName(tableName, "sorted")
				]);

				// The index has to actually serve a sort on the property it covers.
				await connector.set({ id: "1", sorted: "a", value: 1 });
				await connector.set({ id: "2", sorted: "b", value: 2 });
				const result = await connector.query(undefined, [
					{ property: "sorted", sortDirection: SortDirection.Descending }
				]);
				expect(result.entities.map(e => e.id)).toEqual(["2", "1"]);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
		const tableName = `${TEST_MYSQL_CONFIG.tableName}_idempotent_${Date.now()}`;
		const connector = new MySqlEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_MYSQL_CONFIG, tableName }
		});
		let pool: Pool | undefined;

		try {
			const firstResult = await connector.bootstrap();
			const secondResult = await connector.bootstrap();

			expect(firstResult).toBe(true);
			expect(secondResult).toBe(true);

			await connector.set({ id: "1", category: "catA", value: 1 });
			const storedEntity = await connector.get("1");
			expect(storedEntity?.category).toBe("catA");

			pool = createPool({
				host: TEST_MYSQL_CONFIG.host,
				port: TEST_MYSQL_CONFIG.port,
				user: TEST_MYSQL_CONFIG.user,
				password: TEST_MYSQL_CONFIG.password,
				database: TEST_MYSQL_CONFIG.database
			});
			const indexCount = await countIndexesCoveringColumn(pool, tableName, "category");
			expect(indexCount).toBe(1);
		} finally {
			try {
				await pool?.end();
			} catch {}
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
		}
	}, 60_000);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"does not create a duplicate index when the column is already covered by a differently named index",
		async () => {
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_covered_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});

				await pool.query(
					`CREATE TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`partitionId\` VARCHAR(255) NOT NULL, \`id\` VARCHAR(255) NOT NULL, \`category\` VARCHAR(255), \`value\` INT, PRIMARY KEY (\`partitionId\`, \`id\`))`
				);
				await pool.query(
					`CREATE INDEX \`manual_cat_idx\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`partitionId\`, \`category\`(255))`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesCoveringColumn(pool, tableName, "category");
				expect(indexCount).toBe(1);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_noncovered_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});

				await pool.query(
					`CREATE TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`partitionId\` VARCHAR(255) NOT NULL, \`id\` VARCHAR(255) NOT NULL, \`category\` VARCHAR(255), \`value\` INT, PRIMARY KEY (\`partitionId\`, \`id\`))`
				);
				await pool.query(
					`CREATE INDEX \`manual_value_category_idx\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`value\`, \`category\`(255))`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesCoveringColumn(pool, tableName, "category");
				expect(indexCount).toBe(1);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
		"still creates its own index when the column is only covered by an invisible index",
		async () => {
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_invisibleidx_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});

				await pool.query(
					`CREATE TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`partitionId\` VARCHAR(255) NOT NULL, \`id\` VARCHAR(255) NOT NULL, \`category\` VARCHAR(255), \`value\` INT, PRIMARY KEY (\`partitionId\`, \`id\`))`
				);
				await pool.query(
					`CREATE INDEX \`manual_invisible_cat_idx\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`partitionId\`, \`category\`(255))`
				);
				await pool.query(
					`ALTER TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` ALTER INDEX \`manual_invisible_cat_idx\` INVISIBLE`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesCoveringColumn(pool, tableName, "category");
				expect(indexCount).toBe(2);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
		"still creates its own index when the column is only covered by a FULLTEXT index",
		async () => {
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_fulltextidx_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});

				await pool.query(
					`CREATE TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`partitionId\` VARCHAR(255) NOT NULL, \`id\` VARCHAR(255) NOT NULL, \`category\` TEXT, \`value\` INT, PRIMARY KEY (\`partitionId\`, \`id\`))`
				);
				await pool.query(
					`CREATE FULLTEXT INDEX \`manual_fulltext_cat_idx\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`category\`)`
				);

				await connector.bootstrap();

				// A FULLTEXT index serves neither the partition filter nor an equality lookup, so
				// the connector still creates its own and leaves the operator's in place.
				expect(await indexNamesCoveringColumn(pool, tableName, "category")).toEqual([
					IndexHelper.generateName(tableName, "category")
				]);
				expect(await indexNamesLeadingOnColumn(pool, tableName, "category")).toEqual([
					"manual_fulltext_cat_idx"
				]);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_oldscheme_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				await connector.bootstrap();

				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});

				const currentIndexName = IndexHelper.generateName(tableName, "category");
				await pool.query(
					`DROP INDEX \`${currentIndexName}\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\``
				);

				const oldSchemeIndexName = `idx_${tableName}_category`;
				await pool.query(
					`CREATE INDEX \`${oldSchemeIndexName}\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`category\`(255))`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesCoveringColumn(pool, tableName, "category");
				expect(indexCount).toBe(1);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
		"replaces its legacy index with one led by the partition key",
		async () => {
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_legacyrename_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});
				const currentIndexName = IndexHelper.generateName(tableName, "category");
				const legacyIndexName = IndexHelper.generateLegacyName(tableName, "category");

				await connector.bootstrap();
				await pool.query(
					`DROP INDEX \`${currentIndexName}\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\``
				);
				await pool.query(
					`CREATE INDEX \`${legacyIndexName}\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`category\`(255))`
				);

				await connector.bootstrap();
				expect(await indexNamesCoveringColumn(pool, tableName, "category")).toEqual([
					currentIndexName
				]);
				expect(await indexNamesLeadingOnColumn(pool, tableName, "category")).toEqual([]);

				await connector.bootstrap();
				expect(await indexNamesCoveringColumn(pool, tableName, "category")).toEqual([
					currentIndexName
				]);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
		"drops its legacy index when the current index already exists",
		async () => {
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_legacydrop_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});
				const currentIndexName = IndexHelper.generateName(tableName, "category");
				const legacyIndexName = IndexHelper.generateLegacyName(tableName, "category");

				await connector.bootstrap();
				await pool.query(
					`CREATE INDEX \`${legacyIndexName}\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`category\`(255))`
				);
				expect(await indexNamesLeadingOnColumn(pool, tableName, "category")).toEqual([
					legacyIndexName
				]);

				await connector.bootstrap();
				expect(await indexNamesCoveringColumn(pool, tableName, "category")).toEqual([
					currentIndexName
				]);
				expect(await indexNamesLeadingOnColumn(pool, tableName, "category")).toEqual([]);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
		"never drops a manually created index",
		async () => {
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_legacymanual_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});
				await pool.query(
					`CREATE TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`partitionId\` VARCHAR(255) NOT NULL, \`id\` VARCHAR(255) NOT NULL, \`category\` VARCHAR(255), \`value\` INT, PRIMARY KEY (\`partitionId\`, \`id\`))`
				);
				await pool.query(
					`CREATE INDEX \`manual_cat_idx\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`category\`(255))`
				);

				await connector.bootstrap();
				// The operator's index does not lead with the partition key, so the connector adds
				// its own alongside it rather than treating the column as already covered.
				expect(await indexNamesLeadingOnColumn(pool, tableName, "category")).toEqual([
					"manual_cat_idx"
				]);
				expect(await indexNamesCoveringColumn(pool, tableName, "category")).toEqual([
					IndexHelper.generateName(tableName, "category")
				]);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
		"never drops an operator unique index that reuses the legacy name",
		async () => {
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_legacyunique_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});
				const currentIndexName = IndexHelper.generateName(tableName, "category");
				const legacyIndexName = IndexHelper.generateLegacyName(tableName, "category");

				await connector.bootstrap();
				await pool.query(
					`CREATE UNIQUE INDEX \`${legacyIndexName}\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`category\`(255))`
				);

				await connector.bootstrap();
				expect(await indexNamesCoveringColumn(pool, tableName, "category")).toEqual([
					currentIndexName
				]);
				expect(await indexNamesLeadingOnColumn(pool, tableName, "category")).toEqual([
					legacyIndexName
				]);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
		"never drops an operator composite index that reuses the legacy name",
		async () => {
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_legacycomposite_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});
				const currentIndexName = IndexHelper.generateName(tableName, "category");
				const legacyIndexName = IndexHelper.generateLegacyName(tableName, "category");

				await connector.bootstrap();
				await pool.query(
					`CREATE INDEX \`${legacyIndexName}\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`category\`(255), \`value\`)`
				);

				await connector.bootstrap();
				expect(await indexNamesCoveringColumn(pool, tableName, "category")).toEqual([
					currentIndexName
				]);
				expect(await indexNamesLeadingOnColumn(pool, tableName, "category")).toEqual([
					legacyIndexName
				]);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_desc_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});

				await pool.query(
					`CREATE TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`partitionId\` VARCHAR(255) NOT NULL, \`id\` VARCHAR(255) NOT NULL, \`category\` VARCHAR(255), \`value\` INT, PRIMARY KEY (\`partitionId\`, \`id\`))`
				);
				await pool.query(
					`CREATE INDEX \`manual_desc_cat_idx\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`partitionId\`, \`category\`(255) DESC)`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesCoveringColumn(pool, tableName, "category");
				expect(indexCount).toBe(1);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_compound_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});

				await pool.query(
					`CREATE TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`partitionId\` VARCHAR(255) NOT NULL, \`id\` VARCHAR(255) NOT NULL, \`category\` VARCHAR(255), \`value\` INT, PRIMARY KEY (\`partitionId\`, \`id\`))`
				);
				await pool.query(
					`CREATE INDEX \`manual_cat_value_idx\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`partitionId\`, \`category\`(255), \`value\`)`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesCoveringColumn(pool, tableName, "category");
				expect(indexCount).toBe(1);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_index_update_${Date.now()}`;
			const unindexed = new MySqlEntityStorageConnector<UnindexedTestType>({
				entitySchema: nameof<UnindexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			const indexed = new MySqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});

				// Create the table from a schema which does not index the category column.
				expect(await unindexed.bootstrap()).toBe(true);
				expect(await countIndexesCoveringColumn(pool, tableName, "category")).toBe(0);

				// Bootstrapping the same table from a schema which does index it must add the index.
				expect(await indexed.bootstrap()).toBe(true);
				expect(await indexNamesCoveringColumn(pool, tableName, "category")).toContain(
					IndexHelper.generateName(tableName, "category")
				);

				// The added index has to actually serve queries routed through it.
				await indexed.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await indexed.get("catA", "category");
				expect(storedEntity?.id).toBe("1");

				// A further bootstrap must not create the index a second time.
				expect(await indexed.bootstrap()).toBe(true);
				expect(await countIndexesCoveringColumn(pool, tableName, "category")).toBe(1);
			} finally {
				try {
					await pool?.end();
				} catch {}
				try {
					await indexed.teardown?.();
				} catch {}
				try {
					await indexed.stop?.();
				} catch {}
				try {
					await unindexed.stop?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_COMPOSITE_INDEXING)(
		"bootstrap creates a composite index for each multi-property index group",
		async () => {
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_group_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<CompositeIndexedTestType>({
				entitySchema: nameof<CompositeIndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				expect(await connector.bootstrap()).toBe(true);

				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});
				const indexColumns = await indexColumnsByName(pool, tableName);

				// The partition key leads the index, then the group order and directions come from
				// the index entries, not the schema order.
				expect(indexColumns[compositeIndexName(tableName, "categoryStatus")]).toEqual([
					`${PARTITION_KEY} ASC`,
					"category ASC",
					"status DESC"
				]);
				expect(indexColumns[compositeIndexName(tableName, "statusValue")]).toEqual([
					`${PARTITION_KEY} ASC`,
					"value DESC",
					"status ASC"
				]);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
			const tableName = `${TEST_MYSQL_CONFIG.tableName}_group_idempotent_${Date.now()}`;
			const connector = new MySqlEntityStorageConnector<CompositeIndexedTestType>({
				entitySchema: nameof<CompositeIndexedTestType>(),
				config: { ...TEST_MYSQL_CONFIG, tableName }
			});
			let pool: Pool | undefined;

			try {
				expect(await connector.bootstrap()).toBe(true);
				expect(await connector.bootstrap()).toBe(true);

				pool = createPool({
					host: TEST_MYSQL_CONFIG.host,
					port: TEST_MYSQL_CONFIG.port,
					user: TEST_MYSQL_CONFIG.user,
					password: TEST_MYSQL_CONFIG.password,
					database: TEST_MYSQL_CONFIG.database
				});
				const indexColumns = await indexColumnsByName(pool, tableName);

				const groupIndexNames = Object.keys(indexColumns).filter(
					indexName =>
						indexName === compositeIndexName(tableName, "categoryStatus") ||
						indexName === compositeIndexName(tableName, "statusValue")
				);
				expect(groupIndexNames.length).toBe(2);
			} finally {
				try {
					await pool?.end();
				} catch {}
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
		const tableName = `${TEST_MYSQL_CONFIG.tableName}_group_query_${Date.now()}`;
		const connector = new MySqlEntityStorageConnector<CompositeIndexedTestType>({
			entitySchema: nameof<CompositeIndexedTestType>(),
			config: { ...TEST_MYSQL_CONFIG, tableName }
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
