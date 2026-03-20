// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { readFile, rm } from "node:fs/promises";
import { ContextIdStore } from "@twin.org/context";
import { ComponentFactory, Converter, RandomHelper } from "@twin.org/core";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	LogicalOperator,
	SortDirection,
	entity,
	property
} from "@twin.org/entity";
import { MemoryEntityStorageConnector } from "@twin.org/entity-storage-connector-memory";
import { EntityStorageConnectorFactory } from "@twin.org/entity-storage-models";
import {
	EntityStorageLoggingConnector,
	type LogEntry,
	initSchema
} from "@twin.org/logging-connector-entity-storage";
import { LoggingConnectorFactory } from "@twin.org/logging-models";
import { LoggingService } from "@twin.org/logging-service";
import { nameof } from "@twin.org/nameof";
import { FileEntityStorageConnector } from "../src/fileEntityStorageConnector.js";
import type { IFileEntityStorageConnectorConfig } from "../src/models/IFileEntityStorageConnectorConfig.js";

/**
 * Test SubType Definition.
 */
@entity()
class SubType {
	/**
	 * Field1.
	 */
	@property({ type: "string", format: "date-time" })
	public field1!: string;
}

/**
 * Test entity for optional number field (null/undefined comparison tests).
 */
@entity()
class ExpiryTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public status!: string;

	@property({ type: "number", optional: true })
	public expires?: number;
}

/**
 * Nested search entity for dot-notation tests.
 */
@entity()
class NestedSearchType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "object", optional: true })
	public consignor?: { name: string };

	@property({ type: "array", optional: true })
	public items?: { label: string }[];
}

/**
 * Test Type Definition.
 */
@entity()
class TestType {
	/**
	 * Id.
	 */
	@property({ type: "string", isPrimary: true })
	public id!: string;

	/**
	 * Value1.
	 */
	@property({ type: "string" })
	public value1!: string;

	/**
	 * Value2.
	 */
	@property({ type: "string" })
	public value2!: string;

	/**
	 * Value3.
	 */
	@property({ type: "object", itemTypeRef: "SubType", optional: true })
	public value3?: SubType;
}

let currentUser = "user";

let memoryEntityStorage: MemoryEntityStorageConnector<LogEntry>;

const TEST_DIRECTORY_ROOT = "./.tmp/";
const TEST_DIRECTORY = `${TEST_DIRECTORY_ROOT}test-data-${Converter.bytesToHex(RandomHelper.generate(8))}`;
const TEST_STORE_NAME = `${TEST_DIRECTORY}/store.json`;

describe("FileEntityStorageConnector", () => {
	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
		EntitySchemaFactory.register(nameof<NestedSearchType>(), () =>
			EntitySchemaHelper.getSchema(NestedSearchType)
		);
		EntitySchemaFactory.register(nameof<ExpiryTestType>(), () =>
			EntitySchemaHelper.getSchema(ExpiryTestType)
		);
		initSchema();

		ContextIdStore.getContextIds = vi
			.fn()
			.mockImplementation(() => ({ node: "node", tenant: "tenant", user: currentUser }));
	});

	beforeEach(() => {
		memoryEntityStorage = new MemoryEntityStorageConnector<LogEntry>({
			entitySchema: nameof<LogEntry>()
		});
		EntityStorageConnectorFactory.register("log-entry", () => memoryEntityStorage);

		LoggingConnectorFactory.register("logging", () => new EntityStorageLoggingConnector());
		ComponentFactory.register("logging", () => new LoggingService());
	});

	afterEach(async () => {
		try {
			await rm(TEST_DIRECTORY_ROOT, { recursive: true });
		} catch {}
	});

	test("can fail to construct when there is no options", async () => {
		expect(
			() =>
				new FileEntityStorageConnector(
					undefined as unknown as {
						loggingComponentType?: string;
						entitySchema: string;
						config: IFileEntityStorageConnectorConfig;
					}
				)
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.objectUndefined",
				properties: {
					property: "options",
					value: "undefined"
				}
			})
		);
	});

	test("can fail to construct when there is no schema", async () => {
		expect(
			() =>
				new FileEntityStorageConnector(
					{} as unknown as {
						loggingComponentType?: string;
						entitySchema: string;
						config: IFileEntityStorageConnectorConfig;
					}
				)
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: {
					property: "options.entitySchema",
					value: "undefined"
				}
			})
		);
	});

	test("can fail to construct when there is no config", async () => {
		expect(
			() =>
				new FileEntityStorageConnector({ entitySchema: "test" } as unknown as {
					loggingComponentType?: string;
					entitySchema: string;
					config: IFileEntityStorageConnectorConfig;
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.objectUndefined",
				properties: {
					property: "options.config",
					value: "undefined"
				}
			})
		);
	});

	test("can fail to construct when there is no config directory", async () => {
		expect(
			() =>
				new FileEntityStorageConnector({ entitySchema: "test", config: {} } as unknown as {
					loggingComponentType?: string;
					entitySchema: string;
					config: IFileEntityStorageConnectorConfig;
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: {
					property: "options.config.directory",
					value: "undefined"
				}
			})
		);
	});

	test("can construct", async () => {
		const entityStorage = new FileEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: {
				directory: TEST_DIRECTORY
			}
		});
		expect(entityStorage).toBeDefined();
	});

	test("can fail to bootstrap with invalid directory", async () => {
		const entityStorage = new FileEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: {
				directory: "|\0"
			}
		});
		await entityStorage.bootstrap("logging");
		const logs = memoryEntityStorage.getStore();
		expect(logs).toBeDefined();
		expect(logs?.length).toEqual(2);
		expect(logs?.[0].message).toEqual("directoryCreating");
		expect(logs?.[1].message).toEqual("directoryCreateFailed");
	});

	test("can bootstrap and create directory", async () => {
		const entityStorage = new FileEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: {
				directory: TEST_DIRECTORY
			}
		});
		await entityStorage.bootstrap("logging");
		const logs = memoryEntityStorage.getStore();
		expect(logs).toBeDefined();
		expect(logs?.length).toEqual(2);
		expect(logs?.[0].message).toEqual("directoryCreating");
		expect(logs?.[1].message).toEqual("directoryCreated");
	});

	test("can bootstrap and skip existing directory", async () => {
		const entityStorage = new FileEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: {
				directory: TEST_DIRECTORY
			}
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.bootstrap("logging");
		const logs = memoryEntityStorage.getStore();
		expect(logs).toBeDefined();
		expect(logs?.length).toEqual(3);
		expect(logs?.[2].message).toEqual("directoryExists");
	});

	test("can fail to set an item with no entity", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await expect(entityStorage.set(undefined as unknown as TestType)).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.objectUndefined",
			properties: {
				property: "entity",
				value: "undefined"
			}
		});
	});

	test("can set an item", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: "bbb" });

		const file = await readFile(TEST_STORE_NAME, "utf8");
		const store = JSON.parse(file);
		expect(store).toBeDefined();
		expect(store.length).toEqual(1);
		expect(store[0]).toBeDefined();
		expect(store[0].id).toEqual("1");
		expect(store[0].value1).toEqual("aaa");
		expect(store[0].value2).toEqual("bbb");
	});

	test("can set an item with a condition", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");

		await entityStorage.set({ id: "1", value1: "aaa", value2: "bbb" }, [
			{ property: "value1", value: "aaa" }
		]);

		const file = await readFile(TEST_STORE_NAME, "utf8");
		const store = JSON.parse(file);
		expect(store).toBeDefined();
		expect(store.length).toEqual(1);
		expect(store[0]).toBeDefined();
		expect(store[0].id).toEqual("1");
		expect(store[0].value1).toEqual("aaa");
		expect(store[0].value2).toEqual("bbb");
	});

	test("can set an item to update it", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: "bbb" });

		await entityStorage.set({ id: "1", value1: "ccc", value2: "ddd" });

		const file = await readFile(TEST_STORE_NAME, "utf8");
		const store = JSON.parse(file);
		expect(store).toBeDefined();
		expect(store.length).toEqual(1);
		expect(store[0]).toBeDefined();
		expect(store[0].id).toEqual("1");
		expect(store[0].value1).toEqual("ccc");
		expect(store[0].value2).toEqual("ddd");
	});

	test("can fail to get an item with no id", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await expect(
			entityStorage.get(undefined as unknown as string, undefined)
		).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.string",
			properties: {
				property: "id",
				value: "undefined"
			}
		});
	});

	test("can not get an item", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: "bbb" });
		const item = await entityStorage.get("2");

		expect(item).toBeUndefined();
	});

	test("can get an item", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: "bbb" });
		const item = await entityStorage.get("1");

		expect(item).toBeDefined();
		expect(item?.id).toEqual("1");
		expect(item?.value1).toEqual("aaa");
		expect(item?.value2).toEqual("bbb");
	});

	test("can get an item by secondary index", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: "bbb" });
		const item = await entityStorage.get("aaa", "value1");

		expect(item).toBeDefined();
		expect(item?.id).toEqual("1");
		expect(item?.value1).toEqual("aaa");
		expect(item?.value2).toEqual("bbb");
	});

	test("can fail to remove an item with no id", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await expect(entityStorage.remove(undefined as unknown as string)).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.string",
			properties: {
				property: "id",
				value: "undefined"
			}
		});
	});

	test("can not remove an item", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: "bbb" });

		await entityStorage.remove("2");

		const file = await readFile(TEST_STORE_NAME, "utf8");
		const store = JSON.parse(file);
		expect(store).toBeDefined();
		expect(store.length).toEqual(1);
	});

	test("can remove an item", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: "bbb" });
		await entityStorage.remove("1");

		const file = await readFile(TEST_STORE_NAME, "utf8");
		const store = JSON.parse(file);
		expect(store).toBeDefined();
		expect(store.length).toEqual(0);
	});

	test("can fail to remove an item with condition", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: "bbb" });
		await entityStorage.remove("1", [{ property: "value1", value: "aaa1" }]);

		const file = await readFile(TEST_STORE_NAME, "utf8");
		const store = JSON.parse(file);
		expect(store).toBeDefined();
		expect(store.length).toEqual(1);
	});

	test("can remove an item with condition", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: "bbb" });
		await entityStorage.remove("1", [{ property: "value1", value: "aaa" }]);

		const file = await readFile(TEST_STORE_NAME, "utf8");
		const store = JSON.parse(file);
		expect(store).toBeDefined();
		expect(store.length).toEqual(0);
	});

	test("can query items with empty store", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(0);
		expect(result.cursor).toBeUndefined();
	});

	test("can query items with single entry", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: "bbb" });
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(1);
		expect(result.cursor).toBeUndefined();
	});

	test("can find items with single entry and single page with no resulting cursor", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: "bbb" });
		const result = await entityStorage.query(undefined, undefined, undefined, undefined, 1);
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(1);
		expect(result.cursor).toBeUndefined();
	});

	test("can query items with multiple entries", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({ id: (i + 1).toString(), value1: "aaa", value2: "bbb" });
		}
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(20);
		expect(result.cursor).toEqual("20");
	});

	test("can query items with multiple entries and cursor", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({ id: (i + 1).toString(), value1: "aaa", value2: "bbb" });
		}
		const result = await entityStorage.query();
		const result2 = await entityStorage.query(undefined, undefined, undefined, result.cursor);
		expect(result2).toBeDefined();
		expect(result2.entities.length).toEqual(10);
		expect(result2.cursor).toBeUndefined();
	});

	test("can query items with multiple entries and apply conditions", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 100; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: i % 3 === 0 ? "ccc" : "bbb"
			});
		}
		const result = await entityStorage.query({
			property: "value2",
			value: "ccc",
			comparison: ComparisonOperator.Equals
		});
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(20);
		expect(result.cursor).toEqual("58");
	});

	test("can query items with multiple entries and apply custom sort", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({ id: (30 - i).toString(), value1: "aaa", value2: "bbb" });
		}
		const result = await entityStorage.query(undefined, [
			{
				property: "id",
				sortDirection: SortDirection.Ascending
			}
		]);
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(20);
		expect(result.entities[0].id).toEqual("1");
		expect(result.cursor).toEqual("20");
	});

	test("can query items and get a reduced data set", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({ id: (i + 1).toString(), value1: "aaa", value2: "bbb" });
		}
		const result = await entityStorage.query(undefined, undefined, ["id", "value1"]);
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(20);
		expect(result.entities[0].id).toEqual("1");
		expect(result.entities[0].value1).toEqual("aaa");
		expect(result.entities[0].value2).toBeUndefined();
	});

	test("can set data with a partition key", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");

		currentUser = "user";
		await entityStorage.set(
			{
				id: "1",
				value1: "aaa",
				value2: "7777"
			},
			undefined
		);

		currentUser = "user2";
		await entityStorage.set(
			{
				id: "1",
				value1: "bbb",
				value2: "8888"
			},
			undefined
		);

		const file = await readFile(TEST_STORE_NAME, "utf8");
		const store = JSON.parse(file);
		expect(store).toEqual([
			{
				partitionId: "node/tenant/user",
				id: "1",
				value1: "aaa",
				value2: "7777"
			},
			{
				partitionId: "node/tenant/user2",
				id: "1",
				value1: "bbb",
				value2: "8888"
			}
		]);
	});

	test("can get data with a partition key", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");

		currentUser = "user";
		await entityStorage.set(
			{
				id: "1",
				value1: "aaa",
				value2: "7777"
			},
			undefined
		);

		currentUser = "user2";
		await entityStorage.set(
			{
				id: "1",
				value1: "bbb",
				value2: "8888"
			},
			undefined
		);

		currentUser = "user";
		const item = await entityStorage.get("1");
		expect(item).toEqual({
			id: "1",
			value1: "aaa",
			value2: "7777"
		});
	});

	test("can remove data with a partition key", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");

		currentUser = "user";
		await entityStorage.set(
			{
				id: "1",
				value1: "aaa",
				value2: "7777"
			},
			undefined
		);

		currentUser = "user2";
		await entityStorage.set(
			{
				id: "1",
				value1: "bbb",
				value2: "8888"
			},
			undefined
		);

		currentUser = "user";
		await entityStorage.remove("1");

		const file = await readFile(TEST_STORE_NAME, "utf8");
		const store = JSON.parse(file);
		expect(store).toEqual([
			{
				id: "1",
				partitionId: "node/tenant/user2",
				value1: "bbb",
				value2: "8888"
			}
		]);
	});

	test("can query with a partition key", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");

		currentUser = "user";
		await entityStorage.set(
			{
				id: "1",
				value1: "aaa",
				value2: "7777"
			},
			undefined
		);

		currentUser = "user2";
		await entityStorage.set(
			{
				id: "1",
				value1: "bbbb",
				value2: "8888"
			},
			undefined
		);

		currentUser = "user";
		const result = await entityStorage.query(undefined, undefined, undefined, undefined, undefined);
		expect(result.entities).toEqual([
			{
				id: "1",
				value1: "aaa",
				value2: "7777"
			}
		]);
	});

	test("can perform a query with an object condition", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});

		await entityStorage.bootstrap("logging");

		await entityStorage.set({
			id: "1",
			value1: "aaa",
			value2: "7777",
			value3: {
				field1: "foo"
			}
		});

		const result = await entityStorage.query({
			conditions: [
				{
					property: "value3",
					value: {
						field1: "foo"
					},
					comparison: ComparisonOperator.Equals
				}
			]
		});
		expect(result.entities).toEqual([
			{
				id: "1",
				value1: "aaa",
				value2: "7777",
				value3: {
					field1: "foo"
				}
			}
		]);
	});

	// Test: Includes operator on string field
	test("can query items with Includes operator on string field", async () => {
		const entityStorage = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "hello world", value2: "x" });
		await entityStorage.set({ id: "2", value1: "worldwide", value2: "y" });
		await entityStorage.set({ id: "3", value1: "foo bar", value2: "z" });
		const result = await entityStorage.query({
			conditions: [
				{
					property: "value1",
					value: "world",
					comparison: ComparisonOperator.Includes
				}
			]
		});
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(2);
		expect(result.entities.map(e => e.value1)).toEqual(
			expect.arrayContaining(["hello world", "worldwide"])
		);
	});

	test("can query with ComparisonOperator.Includes on nested object property (dot-notation)", async () => {
		const entityStorage = new FileEntityStorageConnector<NestedSearchType>({
			entitySchema: nameof<NestedSearchType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", consignor: { name: "alice smith" } });
		await entityStorage.set({ id: "2", consignor: { name: "bob jones" } });
		await entityStorage.set({ id: "3", consignor: { name: "alice cooper" } });
		const result = await entityStorage.query({
			conditions: [
				{ property: "consignor.name", value: "alice", comparison: ComparisonOperator.Includes }
			]
		});
		expect(result.entities.map(e => e.id).sort()).toEqual(["1", "3"]);
	});

	test("can query with ComparisonOperator.NotEquals on nested object property (dot-notation)", async () => {
		const entityStorage = new FileEntityStorageConnector<NestedSearchType>({
			entitySchema: nameof<NestedSearchType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", consignor: { name: "Alice" } });
		await entityStorage.set({ id: "2", consignor: { name: "Bob" } });
		await entityStorage.set({ id: "3", consignor: { name: "Charlie" } });
		const result = await entityStorage.query({
			conditions: [
				{ property: "consignor.name", value: "Alice", comparison: ComparisonOperator.NotEquals }
			]
		});
		expect(result.entities.map(e => e.id).sort()).toEqual(["2", "3"]);
	});

	test("can query with ComparisonOperator.Includes on plain string field", async () => {
		const entityStorage = new FileEntityStorageConnector<NestedSearchType>({
			entitySchema: nameof<NestedSearchType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", consignor: { name: "hello world" } });
		await entityStorage.set({ id: "2", consignor: { name: "hello world" } });
		await entityStorage.set({ id: "3", consignor: { name: "goodbye" } });
		const result = await entityStorage.query({
			conditions: [
				{ property: "consignor.name", value: "hello", comparison: ComparisonOperator.Includes }
			]
		});
		expect(result.entities.map(e => e.id).sort()).toEqual(["1", "2"]);
	});

	test("can query with NotEquals and undefined on an optional number field", async () => {
		const entityStorage = new FileEntityStorageConnector<ExpiryTestType>({
			entitySchema: nameof<ExpiryTestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");

		await entityStorage.set({ id: "1", status: "pending" });
		await entityStorage.set({ id: "2", status: "active", expires: 1_000 });

		const result = await entityStorage.query({
			conditions: [
				{
					property: "expires",
					comparison: ComparisonOperator.LessThan,
					value: 100_000
				},
				{
					property: "expires",
					comparison: ComparisonOperator.NotEquals,
					value: undefined
				}
			],
			logicalOperator: LogicalOperator.And
		});

		expect(result.entities.map(e => (e as ExpiryTestType).id)).toEqual(["2"]);
	});

	test("can query with NotEquals and null on an optional number field", async () => {
		const entityStorage = new FileEntityStorageConnector<ExpiryTestType>({
			entitySchema: nameof<ExpiryTestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await entityStorage.bootstrap("logging");

		await entityStorage.set({ id: "1", status: "active", expires: 0 });
		await entityStorage.set({ id: "2", status: "pending" });
		await entityStorage.set({ id: "3", status: "active", expires: 1_000 });

		const result = await entityStorage.query({
			conditions: [
				{
					property: "expires",
					comparison: ComparisonOperator.LessThan,
					value: 100_000
				},
				{
					property: "expires",
					comparison: ComparisonOperator.NotEquals,
					value: null as unknown as undefined
				}
			],
			logicalOperator: LogicalOperator.And
		});

		expect(result.entities.map(e => (e as ExpiryTestType).id)).toEqual(
			expect.arrayContaining(["1", "3"])
		);
		expect(result.entities.map(e => (e as ExpiryTestType).id)).not.toContain("2");
	});
});
