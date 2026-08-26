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
import postgres from "postgres";
import { TEST_POSTGRESQL_CONFIG } from "./setupTestEnv.js";
import { PostgreSqlEntityStorageConnector } from "../src/postgreSqlEntityStorageConnector.js";

// Set to false for connectors that do not maintain secondary indexes (e.g. file, memory).
const SUPPORT_SECONDARY_INDEXING = true;

// Set to false for connectors that do not create named index objects in the database.
const SUPPORT_NAMED_INDEX_OBJECTS = true;

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
});
