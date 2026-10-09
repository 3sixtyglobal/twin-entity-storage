// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@3sixty/context";
import { Coerce, RandomHelper } from "@3sixty/core";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@3sixty/entity";
import { nameof } from "@3sixty/nameof";
import postgres from "postgres";
import { TEST_POSTGRESQL_CONFIG } from "./setupTestEnv.js";
import { PostgreSqlEntityStorageConnector } from "../src/postgreSqlEntityStorageConnector.js";

/**
 * Open a direct connection to the test database for catalog inspection.
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
 * Read the declared type and character length of a column.
 * @param sql The connection to query with.
 * @param tableName The table to inspect.
 * @param columnName The column to inspect.
 * @returns The data type and the character maximum length, undefined when the column has no length.
 */
async function columnType(
	sql: postgres.Sql,
	tableName: string,
	columnName: string
): Promise<{ dataType: string; maxLength?: number }> {
	const rows = await sql.unsafe(
		`SELECT data_type AS "dataType", character_maximum_length AS "maxLength"
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
		[tableName, columnName]
	);
	const row = (rows as unknown as { dataType: string; maxLength: number | null }[])[0];
	return { dataType: row.dataType, maxLength: Coerce.number(row.maxLength) };
}

@entity()
class MaxLengthDdlType {
	@property({ type: "string", isPrimary: true, maxLength: 64 })
	public id!: string;

	@property({ type: "string", maxLength: 10 })
	public bounded!: string;

	@property({ type: "string" })
	public unbounded!: string;

	@property({ type: "string", isSecondary: true, maxLength: 20 })
	public indexed!: string;

	@property({ type: "string", format: "uuid" })
	public uuidValue!: string;

	@property({ type: "string", format: "uuid", maxLength: 64 })
	public uuidWithMaxLength!: string;

	@property({ type: "string", format: "date-time", maxLength: 32 })
	public dateTimeWithMaxLength!: string;

	@property({ type: "string", format: "date-time" })
	public dateTimeValue!: string;

	@property({ type: "string", format: "email" })
	public emailValue!: string;

	@property({ type: "string", format: "uri" })
	public uriValue!: string;

	@property({ type: "string", maxLength: 20_000_000 })
	public aboveVarCharLimit!: string;
}

describe("PostgreSqlEntityStorageConnector - maxLength column mapping", () => {
	let sql: postgres.Sql;
	let tableName: string;
	let connector: PostgreSqlEntityStorageConnector<MaxLengthDdlType>;

	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<MaxLengthDdlType>(), () =>
			EntitySchemaHelper.getSchema(MaxLengthDdlType)
		);

		ContextIdStore.getContextIds = vi
			.fn()
			.mockReturnValue({ node: "node", tenant: "tenant", user: "user" });

		tableName = `${TEST_POSTGRESQL_CONFIG.tableName}_maxlength_${RandomHelper.generateUuidV7("compact")}`;

		connector = new PostgreSqlEntityStorageConnector<MaxLengthDdlType>({
			entitySchema: nameof<MaxLengthDdlType>(),
			config: { ...TEST_POSTGRESQL_CONFIG, tableName }
		});
		await connector.bootstrap();

		sql = openTestConnection();
	});

	afterAll(async () => {
		await connector.teardown();
		await connector.stop();
		await sql.end();
	});

	test("maps a string property with a maxLength to VARCHAR of that length", async () => {
		expect(await columnType(sql, tableName, "bounded")).toEqual({
			dataType: "character varying",
			maxLength: 10
		});
	});

	test("maps a string property with no maxLength to TEXT", async () => {
		expect(await columnType(sql, tableName, "unbounded")).toEqual({
			dataType: "text",
			maxLength: undefined
		});
	});

	test("maps a primary key with a maxLength to VARCHAR of that length", async () => {
		expect(await columnType(sql, tableName, "id")).toEqual({
			dataType: "character varying",
			maxLength: 64
		});
	});

	test("bounds the partition key which leads the primary key and every index", async () => {
		expect(await columnType(sql, tableName, "partitionId")).toEqual({
			dataType: "character varying",
			maxLength: 255
		});
	});

	test("maps a secondary index with a maxLength to VARCHAR of that length", async () => {
		expect(await columnType(sql, tableName, "indexed")).toEqual({
			dataType: "character varying",
			maxLength: 20
		});
	});

	test("maxLength takes precedence over the uuid format mapping", async () => {
		expect(await columnType(sql, tableName, "uuidWithMaxLength")).toEqual({
			dataType: "character varying",
			maxLength: 64
		});
	});

	test("retains the uuid format mapping when there is no maxLength", async () => {
		expect(await columnType(sql, tableName, "uuidValue")).toEqual({
			dataType: "uuid",
			maxLength: undefined
		});
	});

	test("maxLength takes precedence over the date-time format mapping", async () => {
		expect(await columnType(sql, tableName, "dateTimeWithMaxLength")).toEqual({
			dataType: "character varying",
			maxLength: 32
		});
	});

	test("bounds a date-time property to the default length for its format", async () => {
		expect(await columnType(sql, tableName, "dateTimeValue")).toEqual({
			dataType: "character varying",
			maxLength: EntitySchemaHelper.FORMAT_MAX_LENGTHS["date-time"]
		});
	});

	test("bounds an email property to the default length for its format", async () => {
		expect(await columnType(sql, tableName, "emailValue")).toEqual({
			dataType: "character varying",
			maxLength: EntitySchemaHelper.FORMAT_MAX_LENGTHS.email
		});
	});

	test("bounds a uri property to the default length for its format", async () => {
		expect(await columnType(sql, tableName, "uriValue")).toEqual({
			dataType: "character varying",
			maxLength: EntitySchemaHelper.FORMAT_MAX_LENGTHS.uri
		});
	});

	test("falls back to TEXT when the maxLength exceeds the VARCHAR limit", async () => {
		expect(await columnType(sql, tableName, "aboveVarCharLimit")).toEqual({
			dataType: "text",
			maxLength: undefined
		});
	});

	test("round-trips values written to the bounded columns", async () => {
		await connector.set({
			id: "a".repeat(64),
			bounded: "b".repeat(10),
			unbounded: "c".repeat(5000),
			indexed: "d".repeat(20),
			uuidValue: "0198f0a0-0000-7000-8000-000000000000",
			uuidWithMaxLength: "not-a-uuid-but-within-the-max-length",
			dateTimeWithMaxLength: new Date().toISOString(),
			dateTimeValue: new Date().toISOString(),
			emailValue: "someone@example.com",
			uriValue: "https://example.com/a/path",
			aboveVarCharLimit: "g".repeat(20000)
		});

		const item = await connector.get("a".repeat(64));
		expect(item?.bounded).toEqual("b".repeat(10));
		expect(item?.indexed).toEqual("d".repeat(20));
		expect(item?.uuidWithMaxLength).toEqual("not-a-uuid-but-within-the-max-length");
		expect(item?.aboveVarCharLimit).toEqual("g".repeat(20000));
	});
});
