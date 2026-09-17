// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import { Coerce } from "@twin.org/core";
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
import postgres from "postgres";
import { TEST_POSTGRESQL_CONFIG } from "./setupTestEnv.js";
import { PostgreSqlEntityStorageConnector } from "../src/postgreSqlEntityStorageConnector.js";

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

/**
 * Open a direct connection to the test database for catalog inspection and manual DDL.
 * @returns A new postgres.js connection.
 */
function openTestConnection(): postgres.Sql {
	return postgres({
		host: TEST_POSTGRESQL_CONFIG.host,
		port: TEST_POSTGRESQL_CONFIG.port,
		user: TEST_POSTGRESQL_CONFIG.user,
		password: TEST_POSTGRESQL_CONFIG.password,
		database: TEST_POSTGRESQL_CONFIG.database
	});
}

/**
 * Count how many indexes lead on the given column for a table.
 * @param sql The connection to query with.
 * @param tableName The table to inspect.
 * @param columnName The column that must be the leading (first) key column of the index.
 * @returns The number of indexes whose leading column is columnName.
 */
async function countIndexesLeadingOnColumn(
	sql: postgres.Sql,
	tableName: string,
	columnName: string
): Promise<number> {
	const rows = await sql.unsafe(
		`SELECT COUNT(DISTINCT i.relname) AS "indexCount"
		FROM pg_index ix
		JOIN pg_class t ON t.oid = ix.indrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		JOIN pg_class i ON i.oid = ix.indexrelid
		JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
		WHERE n.nspname = 'public' AND t.relname = $1 AND a.attname = $2`,
		[tableName, columnName]
	);
	return Coerce.number((rows as unknown as { indexCount: string }[])[0].indexCount) ?? 0;
}

/**
 * List the names of the indexes that lead on the given column for a table.
 * @param sql The connection to query with.
 * @param tableName The table to inspect.
 * @param columnName The column that must be the leading (first) key column of the index.
 * @returns The names of the indexes whose leading column is columnName.
 */
async function indexNamesLeadingOnColumn(
	sql: postgres.Sql,
	tableName: string,
	columnName: string
): Promise<string[]> {
	const rows = await sql.unsafe(
		`SELECT DISTINCT i.relname AS "indexName"
		FROM pg_index ix
		JOIN pg_class t ON t.oid = ix.indrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		JOIN pg_class i ON i.oid = ix.indexrelid
		JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
		WHERE n.nspname = 'public' AND t.relname = $1 AND a.attname = $2`,
		[tableName, columnName]
	);
	return (rows as unknown as { indexName: string }[]).map(row => row.indexName);
}

/**
 * Read the key columns of every index on a table, in key order.
 * @param sql The connection to query with.
 * @param tableName The table to inspect.
 * @returns The key columns and their sort order for each index, keyed by index name.
 */
async function indexColumnsByName(
	sql: postgres.Sql,
	tableName: string
): Promise<{ [indexName: string]: string[] }> {
	const rows = await sql.unsafe(
		`SELECT i.relname AS "indexName", a.attname AS "columnName",
			(ix.indoption[k.ordinality - 1] & 1) = 1 AS "isDescending"
		FROM pg_index ix
		JOIN pg_class t ON t.oid = ix.indrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		JOIN pg_class i ON i.oid = ix.indexrelid
		JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
		JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
		WHERE n.nspname = 'public' AND t.relname = $1
		ORDER BY i.relname, k.ordinality`,
		[tableName]
	);
	const indexColumns: { [indexName: string]: string[] } = {};
	for (const row of rows as unknown as {
		indexName: string;
		columnName: string;
		isDescending: boolean;
	}[]) {
		indexColumns[row.indexName] ??= [];
		indexColumns[row.indexName].push(`${row.columnName} ${row.isDescending ? "DESC" : "ASC"}`);
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

function createIndexedConnector(): PostgreSqlEntityStorageConnector<IndexedTestType> {
	return new PostgreSqlEntityStorageConnector<IndexedTestType>({
		entitySchema: nameof<IndexedTestType>(),
		config: {
			...TEST_POSTGRESQL_CONFIG,
			tableName: `${TEST_POSTGRESQL_CONFIG.tableName}_indexed_${Date.now()}`
		}
	});
}

function createUnindexedConnector(): PostgreSqlEntityStorageConnector<UnindexedTestType> {
	return new PostgreSqlEntityStorageConnector<UnindexedTestType>({
		entitySchema: nameof<UnindexedTestType>(),
		config: {
			...TEST_POSTGRESQL_CONFIG,
			tableName: `${TEST_POSTGRESQL_CONFIG.tableName}_unindexed_${Date.now()}`
		}
	});
}

describe("PostgreSqlEntityStorageConnector", () => {
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_secondary_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				expect(await connector.bootstrap()).toBe(true);

				sql = openTestConnection();
				expect(await indexNamesLeadingOnColumn(sql, tableName, "category")).toEqual([
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
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_sortdirection_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<SortedTestType>({
				entitySchema: nameof<SortedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				expect(await connector.bootstrap()).toBe(true);

				sql = openTestConnection();

				// A sortDirection alone marks the property as sortable, which needs the same index
				// an isSecondary property gets.
				expect(await indexNamesLeadingOnColumn(sql, tableName, "sorted")).toEqual([
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
					await sql?.end();
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
		const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_idempotent_${Date.now()}`;
		const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
			entitySchema: nameof<IndexedTestType>(),
			config: { ...TEST_POSTGRESQL_CONFIG, tableName }
		});
		let sql: postgres.Sql | undefined;

		try {
			const firstResult = await connector.bootstrap();
			const secondResult = await connector.bootstrap();

			expect(firstResult).toBe(true);
			expect(secondResult).toBe(true);

			await connector.set({ id: "1", category: "catA", value: 1 });
			const storedEntity = await connector.get("1");
			expect(storedEntity?.category).toBe("catA");

			sql = openTestConnection();
			const indexCount = await countIndexesLeadingOnColumn(sql, tableName, "category");
			expect(indexCount).toBe(1);
		} finally {
			try {
				await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_covered_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();

				await sql.unsafe(
					`CREATE TABLE "${tableName}" ("id" VARCHAR(255) PRIMARY KEY, "category" VARCHAR(255), "value" INT)`
				);
				await sql.unsafe(`CREATE INDEX "manual_cat_idx" ON "${tableName}" ("category")`);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(sql, tableName, "category");
				expect(indexCount).toBe(1);
			} finally {
				try {
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_noncovered_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();

				await sql.unsafe(
					`CREATE TABLE "${tableName}" ("id" VARCHAR(255) PRIMARY KEY, "category" VARCHAR(255), "value" INT)`
				);
				await sql.unsafe(
					`CREATE INDEX "manual_value_category_idx" ON "${tableName}" ("value", "category")`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(sql, tableName, "category");
				expect(indexCount).toBe(1);
			} finally {
				try {
					await sql?.end();
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
		"still creates its own index when a same-named table in another schema has a covering index",
		async () => {
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_schemacol_${Date.now()}`;
			const otherSchema = `other_schema_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();

				// A same-named table in a different schema, with a covering index on "category",
				// must NOT count as coverage for the connector's own "public" table.
				await sql.unsafe(`CREATE SCHEMA "${otherSchema}"`);
				await sql.unsafe(
					`CREATE TABLE "${otherSchema}"."${tableName}" ("id" VARCHAR(255) PRIMARY KEY, "category" VARCHAR(255), "value" INT)`
				);
				await sql.unsafe(
					`CREATE INDEX "other_schema_cat_idx" ON "${otherSchema}"."${tableName}" ("category")`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(sql, tableName, "category");
				expect(indexCount).toBe(1);
			} finally {
				try {
					await sql?.unsafe(`DROP SCHEMA "${otherSchema}" CASCADE`);
				} catch {}
				try {
					await sql?.end();
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
		"still creates its own index when the column is only covered by an invalid index",
		async () => {
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_invalididx_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();

				await sql.unsafe(
					`CREATE TABLE "${tableName}" ("id" VARCHAR(255) PRIMARY KEY, "category" VARCHAR(255), "value" INT)`
				);
				// Force an invalid index: a unique index that a duplicate-violating concurrent
				// build would leave behind. Simulated directly via catalog update since forcing a
				// genuine failed CONCURRENTLY build deterministically in a test is impractical.
				await sql.unsafe(`CREATE INDEX "manual_invalid_cat_idx" ON "${tableName}" ("category")`);
				await sql.unsafe(
					`UPDATE pg_index SET indisvalid = false
					WHERE indexrelid = '"manual_invalid_cat_idx"'::regclass`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(sql, tableName, "category");
				expect(indexCount).toBe(2);
			} finally {
				try {
					await sql?.end();
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
		"still creates its own index when the column is only covered by a partial index",
		async () => {
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_partialidx_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();

				await sql.unsafe(
					`CREATE TABLE "${tableName}" ("id" VARCHAR(255) PRIMARY KEY, "category" VARCHAR(255), "value" INT)`
				);
				await sql.unsafe(
					`CREATE INDEX "manual_partial_cat_idx" ON "${tableName}" ("category") WHERE "category" IS NOT NULL`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(sql, tableName, "category");
				expect(indexCount).toBe(2);
			} finally {
				try {
					await sql?.end();
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
		"still creates its own index when the column is only covered by a non-btree index",
		async () => {
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_brinidx_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();

				await sql.unsafe(
					`CREATE TABLE "${tableName}" ("id" VARCHAR(255) PRIMARY KEY, "category" VARCHAR(255), "value" INT)`
				);
				await sql.unsafe(
					`CREATE INDEX "manual_brin_cat_idx" ON "${tableName}" USING brin ("category")`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(sql, tableName, "category");
				expect(indexCount).toBe(2);
			} finally {
				try {
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_oldscheme_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				await connector.bootstrap();

				sql = openTestConnection();

				const currentIndexName = IndexHelper.generateName(tableName, "category");
				await sql.unsafe(`DROP INDEX "${currentIndexName}"`);

				const oldSchemeIndexName = `idx_${tableName}_category`;
				await sql.unsafe(`CREATE INDEX "${oldSchemeIndexName}" ON "${tableName}" ("category")`);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(sql, tableName, "category");
				expect(indexCount).toBe(1);
			} finally {
				try {
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_legacyrename_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();
				const currentIndexName = IndexHelper.generateName(tableName, "category");
				const legacyIndexName = IndexHelper.generateLegacyName(
					tableName,
					"category",
					IndexHelper.DEFAULT_MAX_IDENTIFIER_LENGTH
				);

				await connector.bootstrap();
				await sql.unsafe(`DROP INDEX "${currentIndexName}"`);
				await sql.unsafe(`CREATE INDEX "${legacyIndexName}" ON "${tableName}" ("category")`);

				await connector.bootstrap();
				expect(await indexNamesLeadingOnColumn(sql, tableName, "category")).toEqual([
					currentIndexName
				]);

				await connector.bootstrap();
				expect(await indexNamesLeadingOnColumn(sql, tableName, "category")).toEqual([
					currentIndexName
				]);
			} finally {
				try {
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_legacydrop_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();
				const currentIndexName = IndexHelper.generateName(tableName, "category");
				const legacyIndexName = IndexHelper.generateLegacyName(
					tableName,
					"category",
					IndexHelper.DEFAULT_MAX_IDENTIFIER_LENGTH
				);

				await connector.bootstrap();
				await sql.unsafe(`CREATE INDEX "${legacyIndexName}" ON "${tableName}" ("category")`);
				expect(await countIndexesLeadingOnColumn(sql, tableName, "category")).toBe(2);

				await connector.bootstrap();
				expect(await indexNamesLeadingOnColumn(sql, tableName, "category")).toEqual([
					currentIndexName
				]);
			} finally {
				try {
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_legacymanual_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();
				await sql.unsafe(
					`CREATE TABLE "${tableName}" ("id" VARCHAR(255) PRIMARY KEY, "category" VARCHAR(255), "value" INT)`
				);
				await sql.unsafe(`CREATE INDEX "manual_cat_idx" ON "${tableName}" ("category")`);

				await connector.bootstrap();
				expect(await indexNamesLeadingOnColumn(sql, tableName, "category")).toEqual([
					"manual_cat_idx"
				]);
			} finally {
				try {
					await sql?.end();
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
		"renames a legacy index whose name was truncated to the identifier limit",
		async () => {
			const tableName = `legacytrunc_${Date.now()}_${"x".repeat(60)}`.slice(0, 58);
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();
				const currentIndexName = IndexHelper.generateName(tableName, "category");
				const legacyIndexName = IndexHelper.generateLegacyName(
					tableName,
					"category",
					IndexHelper.DEFAULT_MAX_IDENTIFIER_LENGTH
				);

				await connector.bootstrap();
				await sql.unsafe(`DROP INDEX "${currentIndexName}"`);
				await sql.unsafe(`CREATE INDEX "idx_${tableName}_category" ON "${tableName}" ("category")`);
				expect(await indexNamesLeadingOnColumn(sql, tableName, "category")).toEqual([
					legacyIndexName
				]);

				await connector.bootstrap();
				expect(await indexNamesLeadingOnColumn(sql, tableName, "category")).toEqual([
					currentIndexName
				]);
			} finally {
				try {
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_legacyunique_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();
				const currentIndexName = IndexHelper.generateName(tableName, "category");
				const legacyIndexName = IndexHelper.generateLegacyName(
					tableName,
					"category",
					IndexHelper.DEFAULT_MAX_IDENTIFIER_LENGTH
				);

				await connector.bootstrap();
				await sql.unsafe(`CREATE UNIQUE INDEX "${legacyIndexName}" ON "${tableName}" ("category")`);

				await connector.bootstrap();
				expect((await indexNamesLeadingOnColumn(sql, tableName, "category")).sort()).toEqual(
					[currentIndexName, legacyIndexName].sort()
				);
			} finally {
				try {
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_legacycomposite_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();
				const currentIndexName = IndexHelper.generateName(tableName, "category");
				const legacyIndexName = IndexHelper.generateLegacyName(
					tableName,
					"category",
					IndexHelper.DEFAULT_MAX_IDENTIFIER_LENGTH
				);

				await connector.bootstrap();
				await sql.unsafe(
					`CREATE INDEX "${legacyIndexName}" ON "${tableName}" ("category", "value")`
				);

				await connector.bootstrap();
				expect((await indexNamesLeadingOnColumn(sql, tableName, "category")).sort()).toEqual(
					[currentIndexName, legacyIndexName].sort()
				);
			} finally {
				try {
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_desc_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();

				await sql.unsafe(
					`CREATE TABLE "${tableName}" ("id" VARCHAR(255) PRIMARY KEY, "category" VARCHAR(255), "value" INT)`
				);
				await sql.unsafe(`CREATE INDEX "manual_desc_cat_idx" ON "${tableName}" ("category" DESC)`);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(sql, tableName, "category");
				expect(indexCount).toBe(1);
			} finally {
				try {
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_compound_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();

				await sql.unsafe(
					`CREATE TABLE "${tableName}" ("id" VARCHAR(255) PRIMARY KEY, "category" VARCHAR(255), "value" INT)`
				);
				await sql.unsafe(
					`CREATE INDEX "manual_cat_value_idx" ON "${tableName}" ("category", "value")`
				);

				await connector.bootstrap();

				const indexCount = await countIndexesLeadingOnColumn(sql, tableName, "category");
				expect(indexCount).toBe(1);
			} finally {
				try {
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_index_update_${Date.now()}`;
			const unindexed = new PostgreSqlEntityStorageConnector<UnindexedTestType>({
				entitySchema: nameof<UnindexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			const indexed = new PostgreSqlEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				sql = openTestConnection();

				// Create the table from a schema which does not index the category column.
				expect(await unindexed.bootstrap()).toBe(true);
				expect(await countIndexesLeadingOnColumn(sql, tableName, "category")).toBe(0);

				// Bootstrapping the same table from a schema which does index it must add the index.
				expect(await indexed.bootstrap()).toBe(true);
				expect(await indexNamesLeadingOnColumn(sql, tableName, "category")).toContain(
					IndexHelper.generateName(tableName, "category")
				);

				// The added index has to actually serve queries routed through it.
				await indexed.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await indexed.get("catA", "category");
				expect(storedEntity?.id).toBe("1");

				// A further bootstrap must not create the index a second time.
				expect(await indexed.bootstrap()).toBe(true);
				expect(await countIndexesLeadingOnColumn(sql, tableName, "category")).toBe(1);
			} finally {
				try {
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_group_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<CompositeIndexedTestType>({
				entitySchema: nameof<CompositeIndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				expect(await connector.bootstrap()).toBe(true);

				sql = openTestConnection();
				const indexColumns = await indexColumnsByName(sql, tableName);

				// The group order and directions come from the index entries, not the schema order.
				expect(indexColumns[compositeIndexName(tableName, "categoryStatus")]).toEqual([
					"category ASC",
					"status DESC"
				]);
				expect(indexColumns[compositeIndexName(tableName, "statusValue")]).toEqual([
					"value DESC",
					"status ASC"
				]);
			} finally {
				try {
					await sql?.end();
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
			const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_group_idempotent_${Date.now()}`;
			const connector = new PostgreSqlEntityStorageConnector<CompositeIndexedTestType>({
				entitySchema: nameof<CompositeIndexedTestType>(),
				config: { ...TEST_POSTGRESQL_CONFIG, tableName }
			});
			let sql: postgres.Sql | undefined;

			try {
				expect(await connector.bootstrap()).toBe(true);
				expect(await connector.bootstrap()).toBe(true);

				sql = openTestConnection();
				const indexColumns = await indexColumnsByName(sql, tableName);

				const groupIndexNames = Object.keys(indexColumns).filter(
					indexName =>
						indexName === compositeIndexName(tableName, "categoryStatus") ||
						indexName === compositeIndexName(tableName, "statusValue")
				);
				expect(groupIndexNames.length).toBe(2);
			} finally {
				try {
					await sql?.end();
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
		const tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_group_query_${Date.now()}`;
		const connector = new PostgreSqlEntityStorageConnector<CompositeIndexedTestType>({
			entitySchema: nameof<CompositeIndexedTestType>(),
			config: { ...TEST_POSTGRESQL_CONFIG, tableName }
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
