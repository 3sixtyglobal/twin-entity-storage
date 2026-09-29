// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import { Coerce, RandomHelper } from "@twin.org/core";
import {
	EntitySchemaFactory,
	EntitySchemaHelper,
	SortDirection,
	entity,
	property
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { createPool, type Pool } from "mysql2/promise";
import { TEST_MYSQL_CONFIG } from "./setupTestEnv.js";
import { MySqlEntityStorageConnector } from "../src/mysqlEntityStorageConnector.js";

/**
 * Read the declared type and character length of a column.
 * @param pool The pool to query with.
 * @param tableName The table to inspect.
 * @param columnName The column to inspect.
 * @returns The data type and the character maximum length, undefined when the column has no length.
 */
async function columnType(
	pool: Pool,
	tableName: string,
	columnName: string
): Promise<{ dataType: string; maxLength?: number }> {
	const [rows] = await pool.query(
		"SELECT data_type AS dataType, character_maximum_length AS maxLength FROM INFORMATION_SCHEMA.COLUMNS WHERE table_schema = ? AND table_name = ? AND column_name = ?",
		[TEST_MYSQL_CONFIG.database, tableName, columnName]
	);
	const row = (rows as { dataType: string; maxLength: number | null }[])[0];
	return { dataType: row.dataType, maxLength: Coerce.number(row.maxLength) };
}

/**
 * Read the index prefix length used for a column.
 * The connector leads each index with the partition key, so the column follows it.
 * @param pool The pool to query with.
 * @param tableName The table to inspect.
 * @param columnName The column that must be the second key column of the index.
 * @returns The prefix length, or undefined when the column is indexed in full.
 */
async function indexPrefixLength(
	pool: Pool,
	tableName: string,
	columnName: string
): Promise<number | undefined> {
	const [rows] = await pool.query(
		"SELECT sub_part AS subPart FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema = ? AND table_name = ? AND column_name = ? AND seq_in_index = 2 LIMIT 1",
		[TEST_MYSQL_CONFIG.database, tableName, columnName]
	);
	return Coerce.number((rows as { subPart: number | null }[])[0]?.subPart);
}

/**
 * Read the index prefix length used for a column which leads an index.
 * @param pool The pool to query with.
 * @param tableName The table to inspect.
 * @param columnName The column that must be the leading key column of the index.
 * @returns The prefix length, or undefined when the column is indexed in full.
 */
async function indexLeadingPrefixLength(
	pool: Pool,
	tableName: string,
	columnName: string
): Promise<number | undefined> {
	const [rows] = await pool.query(
		"SELECT sub_part AS subPart FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema = ? AND table_name = ? AND column_name = ? AND seq_in_index = 1 LIMIT 1",
		[TEST_MYSQL_CONFIG.database, tableName, columnName]
	);
	return Coerce.number((rows as { subPart: number | null }[])[0]?.subPart);
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
	public shortIndexed!: string;

	@property({ type: "string", isSecondary: true, maxLength: 300 })
	public longIndexed!: string;

	@property({ type: "string", isSecondary: true })
	public unboundedIndexed!: string;

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

	@property({ type: "string", maxLength: 20000 })
	public aboveVarCharLimit!: string;

	@property({ type: "string", isSecondary: true, maxLength: 255, optional: true })
	public atPrefixLimitIndexed?: string;

	@property({ type: "string", isSecondary: true, maxLength: 256, optional: true })
	public abovePrefixLimitIndexed?: string;

	@property({
		type: "string",
		format: "date-time",
		sortDirection: SortDirection.Descending,
		optional: true
	})
	public sortedDateTime?: string;

	@property({ type: "string", format: "uuid", isSecondary: true, optional: true })
	public uuidIndexed?: string;
}

describe("MySqlEntityStorageConnector - maxLength column mapping", () => {
	let pool: Pool;
	let tableName: string;
	let connector: MySqlEntityStorageConnector<MaxLengthDdlType>;

	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<MaxLengthDdlType>(), () =>
			EntitySchemaHelper.getSchema(MaxLengthDdlType)
		);

		ContextIdStore.getContextIds = vi
			.fn()
			.mockReturnValue({ node: "node", tenant: "tenant", user: "user" });

		tableName = `${TEST_MYSQL_CONFIG.tableName}_maxlength_${RandomHelper.generateUuidV7("compact")}`;

		connector = new MySqlEntityStorageConnector<MaxLengthDdlType>({
			entitySchema: nameof<MaxLengthDdlType>(),
			config: { ...TEST_MYSQL_CONFIG, tableName }
		});
		expect(await connector.bootstrap()).toBe(true);

		pool = createPool({
			host: TEST_MYSQL_CONFIG.host,
			port: TEST_MYSQL_CONFIG.port,
			user: TEST_MYSQL_CONFIG.user,
			password: TEST_MYSQL_CONFIG.password,
			database: TEST_MYSQL_CONFIG.database
		});
	});

	afterAll(async () => {
		await connector.teardown();
		await connector.stop();
		await pool.end();
	});

	test("maps a string property with a maxLength to VARCHAR of that length", async () => {
		expect(await columnType(pool, tableName, "bounded")).toEqual({
			dataType: "varchar",
			maxLength: 10
		});
	});

	test("maps a string property with no maxLength to LONGTEXT", async () => {
		const column = await columnType(pool, tableName, "unbounded");
		expect(column.dataType).toEqual("longtext");
	});

	test("maps a primary key with a maxLength to VARCHAR of that length", async () => {
		expect(await columnType(pool, tableName, "id")).toEqual({
			dataType: "varchar",
			maxLength: 64
		});
	});

	test("bounds the partition key so it can lead an index without a prefix", async () => {
		expect(await columnType(pool, tableName, "partitionId")).toEqual({
			dataType: "varchar",
			maxLength: 255
		});
		expect(await indexLeadingPrefixLength(pool, tableName, "partitionId")).toBeUndefined();
	});

	test("maxLength takes precedence over the uuid format mapping", async () => {
		expect(await columnType(pool, tableName, "uuidWithMaxLength")).toEqual({
			dataType: "varchar",
			maxLength: 64
		});
	});

	test("retains the uuid format mapping when there is no maxLength", async () => {
		expect(await columnType(pool, tableName, "uuidValue")).toEqual({
			dataType: "char",
			maxLength: EntitySchemaHelper.FORMAT_MAX_LENGTHS.uuid
		});
	});

	test("maxLength takes precedence over the date-time format mapping", async () => {
		expect(await columnType(pool, tableName, "dateTimeWithMaxLength")).toEqual({
			dataType: "varchar",
			maxLength: 32
		});
	});

	test("bounds a date-time property to the default length for its format", async () => {
		expect(await columnType(pool, tableName, "dateTimeValue")).toEqual({
			dataType: "varchar",
			maxLength: EntitySchemaHelper.FORMAT_MAX_LENGTHS["date-time"]
		});
	});

	test("bounds an email property to the default length for its format", async () => {
		expect(await columnType(pool, tableName, "emailValue")).toEqual({
			dataType: "varchar",
			maxLength: EntitySchemaHelper.FORMAT_MAX_LENGTHS.email
		});
	});

	test("bounds a uri property to the default length for its format", async () => {
		expect(await columnType(pool, tableName, "uriValue")).toEqual({
			dataType: "varchar",
			maxLength: EntitySchemaHelper.FORMAT_MAX_LENGTHS.uri
		});
	});

	test("falls back to LONGTEXT when the maxLength exceeds the VARCHAR limit", async () => {
		const column = await columnType(pool, tableName, "aboveVarCharLimit");
		expect(column.dataType).toEqual("longtext");
	});

	test("indexes a short bounded column in full with no prefix", async () => {
		expect(await indexPrefixLength(pool, tableName, "shortIndexed")).toBeUndefined();
	});

	test("indexes a long bounded column with a prefix", async () => {
		expect(await indexPrefixLength(pool, tableName, "longIndexed")).toEqual(255);
	});

	test("indexes an unbounded column with a prefix", async () => {
		expect(await indexPrefixLength(pool, tableName, "unboundedIndexed")).toEqual(255);
	});

	test("indexes a column bounded to the prefix limit in full", async () => {
		expect(await indexPrefixLength(pool, tableName, "atPrefixLimitIndexed")).toBeUndefined();
	});

	test("indexes a column bounded above the prefix limit with a prefix", async () => {
		expect(await indexPrefixLength(pool, tableName, "abovePrefixLimitIndexed")).toEqual(255);
	});

	test("indexes a sorted date-time column in full", async () => {
		expect(await indexPrefixLength(pool, tableName, "sortedDateTime")).toBeUndefined();
	});

	test("indexes a uuid column in full", async () => {
		expect(await indexPrefixLength(pool, tableName, "uuidIndexed")).toBeUndefined();
	});

	test("round-trips values written to the bounded columns", async () => {
		await connector.set({
			id: "a".repeat(64),
			bounded: "b".repeat(10),
			unbounded: "c".repeat(5000),
			shortIndexed: "d".repeat(20),
			longIndexed: "e".repeat(300),
			unboundedIndexed: "f".repeat(500),
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
		expect(item?.longIndexed).toEqual("e".repeat(300));
		expect(item?.uuidWithMaxLength).toEqual("not-a-uuid-but-within-the-max-length");
		expect(item?.aboveVarCharLimit).toEqual("g".repeat(20000));
	});
});
