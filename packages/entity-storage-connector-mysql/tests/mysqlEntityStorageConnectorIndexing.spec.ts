// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import { Coerce } from "@twin.org/core";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
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

/**
 * Count how many indexes lead on the given column for a table.
 * @param pool The pool to query with.
 * @param tableName The table to inspect.
 * @param columnName The column that must be the leading (first) key column of the index.
 * @returns The number of indexes whose leading column is columnName.
 */
async function countIndexesLeadingOnColumn(
	pool: Pool,
	tableName: string,
	columnName: string
): Promise<number> {
	const [rows] = await pool.query(
		"SELECT COUNT(DISTINCT index_name) AS indexCount FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema = ? AND table_name = ? AND column_name = ? AND seq_in_index = 1",
		[TEST_MYSQL_CONFIG.database, tableName, columnName]
	);
	return Coerce.number((rows as { indexCount: number }[])[0].indexCount) ?? 0;
}

/**
 * List the names of the indexes that lead on the given column for a table.
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
			const indexCount = await countIndexesLeadingOnColumn(pool, tableName, "category");
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
					`CREATE TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`id\` VARCHAR(255) PRIMARY KEY, \`category\` VARCHAR(255), \`value\` INT)`
				);
				await pool.query(
					`CREATE INDEX \`manual_cat_idx\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`category\`(255))`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(pool, tableName, "category");
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
					`CREATE TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`id\` VARCHAR(255) PRIMARY KEY, \`category\` VARCHAR(255), \`value\` INT)`
				);
				await pool.query(
					`CREATE INDEX \`manual_value_category_idx\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`value\`, \`category\`(255))`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(pool, tableName, "category");
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
					`CREATE TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`id\` VARCHAR(255) PRIMARY KEY, \`category\` VARCHAR(255), \`value\` INT)`
				);
				await pool.query(
					`CREATE INDEX \`manual_invisible_cat_idx\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`category\`(255))`
				);
				await pool.query(
					`ALTER TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` ALTER INDEX \`manual_invisible_cat_idx\` INVISIBLE`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(pool, tableName, "category");
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
					`CREATE TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`id\` VARCHAR(255) PRIMARY KEY, \`category\` TEXT, \`value\` INT)`
				);
				await pool.query(
					`CREATE FULLTEXT INDEX \`manual_fulltext_cat_idx\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`category\`)`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(pool, tableName, "category");
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

				const indexCount = await countIndexesLeadingOnColumn(pool, tableName, "category");
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
		"renames its legacy index to the current name",
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
				expect(await indexNamesLeadingOnColumn(pool, tableName, "category")).toEqual([
					currentIndexName
				]);

				await connector.bootstrap();
				expect(await indexNamesLeadingOnColumn(pool, tableName, "category")).toEqual([
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
				expect(await countIndexesLeadingOnColumn(pool, tableName, "category")).toBe(2);

				await connector.bootstrap();
				expect(await indexNamesLeadingOnColumn(pool, tableName, "category")).toEqual([
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
					`CREATE TABLE \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`id\` VARCHAR(255) PRIMARY KEY, \`category\` VARCHAR(255), \`value\` INT)`
				);
				await pool.query(
					`CREATE INDEX \`manual_cat_idx\` ON \`${TEST_MYSQL_CONFIG.database}\`.\`${tableName}\` (\`category\`(255))`
				);

				await connector.bootstrap();
				expect(await indexNamesLeadingOnColumn(pool, tableName, "category")).toEqual([
					"manual_cat_idx"
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
				expect((await indexNamesLeadingOnColumn(pool, tableName, "category")).sort()).toEqual(
					[currentIndexName, legacyIndexName].sort()
				);
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
				expect((await indexNamesLeadingOnColumn(pool, tableName, "category")).sort()).toEqual(
					[currentIndexName, legacyIndexName].sort()
				);
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
});
