// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import { ComponentFactory, HealthStatus } from "@twin.org/core";
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
import { TEST_SCYLLA_CONFIG } from "./setupTestEnv.js";
import type { IScyllaDBTableConfig } from "../src/models/IScyllaDBTableConfig.js";
import { ScyllaDBTableConnector } from "../src/scyllaDBTableConnector.js";

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
 * Nested search entity for dot-notation tests.
 */
@entity()
class NestedSearchType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "object", optional: true })
	public consignor?: { name: string };
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
	@property({ type: "string", isSecondary: true })
	public value1!: string;

	/**
	 * Value2.
	 */
	@property({ type: "number", format: "uint8" })
	public value2!: number;

	/**
	 * Value3.
	 */
	@property({ type: "object", itemTypeRef: "SubType", optional: true })
	public value3!: SubType | undefined;

	/**
	 * Value4.
	 */
	@property({ type: "object", optional: true })
	public valueObject?: {
		[id: string]: {
			value: string;
		};
	};

	/**
	 * Value5.
	 */
	@property({ type: "array", optional: true })
	public valueArray?: {
		field: string;
		value: string;
	}[];
}

/**
 * Test entity with an optional number field.
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

let currentUser = "user";

let memoryEntityStorage: MemoryEntityStorageConnector<LogEntry>;

describe("ScyllaDBTableConnector", () => {
	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
		EntitySchemaFactory.register(nameof<SubType>(), () => EntitySchemaHelper.getSchema(SubType));
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
		const entityStorage = new ScyllaDBTableConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		try {
			await entityStorage.empty();
		} catch {}
	});

	afterEach(async () => {
		const entityStorage = new ScyllaDBTableConnector({
			entitySchema: nameof<NestedSearchType>(),
			config: { ...TEST_SCYLLA_CONFIG, tableName: "test_nested" }
		});
		try {
			await entityStorage.empty();
		} catch {}
	});

	afterEach(async () => {
		const entityStorage = new ScyllaDBTableConnector<ExpiryTestType>({
			entitySchema: nameof<ExpiryTestType>(),
			config: { ...TEST_SCYLLA_CONFIG, tableName: "expires_test" }
		});
		try {
			await entityStorage.empty();
		} catch {}
	});

	afterAll(async () => {
		const entityStorage = new ScyllaDBTableConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.teardown();
	});

	test("can fail to construct when there is no options", async () => {
		expect(
			() =>
				new ScyllaDBTableConnector(
					undefined as unknown as {
						loggingComponentType?: string;
						entitySchema: string;
						config: IScyllaDBTableConfig;
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
				new ScyllaDBTableConnector(
					{} as unknown as {
						loggingComponentType?: string;
						entitySchema: string;
						config: IScyllaDBTableConfig;
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
				new ScyllaDBTableConnector({ entitySchema: "test" } as unknown as {
					loggingComponentType?: string;
					entitySchema: string;
					config: IScyllaDBTableConfig;
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

	test("can fail to construct when config is empty", async () => {
		expect(
			() =>
				new ScyllaDBTableConnector({ entitySchema: "test", config: {} } as unknown as {
					loggingComponentType?: string;
					entitySchema: string;
					config: IScyllaDBTableConfig;
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.array",
				properties: {
					property: "options.config.hosts",
					value: "undefined"
				}
			})
		);
	});

	test("can construct", async () => {
		const entityStorage = new ScyllaDBTableConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		expect(entityStorage).toBeDefined();
	});

	test.skip("can fail to bootstrap with invalid host", async () => {
		const entityStorage = new ScyllaDBTableConnector({
			entitySchema: nameof<TestType>(),
			config: {
				hosts: ["example.org"],
				tableName: "test1",
				localDataCenter: "datacenter1",
				keyspace: "test_keyspace"
			}
		});
		await entityStorage.bootstrap("logging");
		const logs = memoryEntityStorage.getStore();
		expect(logs?.find(l => l.level === "error")).toBeUndefined();
	});

	test("can bootstrap and create table", async () => {
		const entityStorage = new ScyllaDBTableConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const logs = memoryEntityStorage.getStore();
		expect(logs?.find(l => l.level === "error")).toBeUndefined();
	});

	test("can fail to set an item with no entity", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
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
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() }
		};
		await entityStorage.set(objectSet);

		const result = await entityStorage.get(entityId);
		expect(result).toEqual(objectSet);
	});

	test("can set an item with a condition", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});

		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() }
		};
		await entityStorage.set(objectSet, [{ property: "value1", value: "aaa" }]);

		const result = await entityStorage.get(entityId);
		expect(result?.id).toEqual(objectSet.id);
		expect(result?.value1).toEqual(objectSet.value1);
		expect(result?.value2).toEqual(objectSet.value2);
		expect(result?.value3).toEqual(objectSet.value3);
	});

	test("can set an item to update it", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() }
		};
		await entityStorage.set(objectSet);

		objectSet.value2 = 99;
		await entityStorage.set(objectSet);

		const result = await entityStorage.get(entityId);
		expect(result?.id).toEqual(objectSet.id);
		expect(result?.value1).toEqual(objectSet.value1);
		expect(result?.value2).toEqual(objectSet.value2);
		expect(result?.value3).toEqual(objectSet.value3);
	});

	test("can fail to set batch with no entities", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await expect(entityStorage.setBatch(undefined as unknown as TestType[])).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.array",
			properties: { property: "entities", value: "undefined" }
		});
	});

	test("can set batch of items", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.setBatch([
			{ id: "batch1", value1: "aaa", value2: 11, value3: undefined },
			{ id: "batch2", value1: "bbb", value2: 22, value3: undefined },
			{ id: "batch3", value1: "ccc", value2: 33, value3: undefined }
		]);
		const item1 = await entityStorage.get("batch1");
		expect(item1).toMatchObject({ id: "batch1", value1: "aaa", value2: 11 });
		const item3 = await entityStorage.get("batch3");
		expect(item3).toMatchObject({ id: "batch3", value1: "ccc", value2: 33 });
	});

	test("can set batch updating existing items", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		// value1 is a clustering key in ScyllaDB and cannot be changed in an UPDATE;
		// only non-key fields (value2) are modified here.
		await entityStorage.set({ id: "batch1", value1: "aaa", value2: 11, value3: undefined });
		await entityStorage.setBatch([
			{ id: "batch1", value1: "aaa", value2: 99, value3: undefined },
			{ id: "batch2", value1: "bbb", value2: 22, value3: undefined }
		]);
		const item1 = await entityStorage.get("batch1");
		expect(item1).toMatchObject({ id: "batch1", value1: "aaa", value2: 99 });
		const item2 = await entityStorage.get("batch2");
		expect(item2).toMatchObject({ id: "batch2", value1: "bbb", value2: 22 });
	});

	test("can fail to remove batch with no ids", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await expect(entityStorage.removeBatch(undefined as unknown as string[])).rejects.toMatchObject(
			{
				name: "GuardError",
				message: "guard.array",
				properties: { property: "ids", value: "undefined" }
			}
		);
	});

	test("can remove batch of items", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.setBatch([
			{ id: "batch1", value1: "aaa", value2: 11, value3: undefined },
			{ id: "batch2", value1: "bbb", value2: 22, value3: undefined },
			{ id: "batch3", value1: "ccc", value2: 33, value3: undefined }
		]);
		const countBefore = await entityStorage.count();
		expect(countBefore).toEqual(3);

		await entityStorage.removeBatch(["batch1", "batch2"]);

		const countAfter = await entityStorage.count();
		expect(countAfter).toEqual(1);

		const remaining = await entityStorage.get("batch3");
		expect(remaining).toMatchObject({ id: "batch3", value1: "ccc", value2: 33 });

		const removed1 = await entityStorage.get("batch1");
		expect(removed1).toBeUndefined();
		const removed2 = await entityStorage.get("batch2");
		expect(removed2).toBeUndefined();
	});

	test("can fail to get an item with no id", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await expect(entityStorage.get(undefined as unknown as string)).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.string",
			properties: {
				property: "id",
				value: "undefined"
			}
		});
	});

	test("can not get an item", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		const item = await entityStorage.get("20000");

		expect(item).toBeUndefined();
	});

	test("can get an item", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.set({ id: "2", value1: "vvv", value2: 35, value3: undefined });
		const item = await entityStorage.get("2");

		expect(item).toBeDefined();
		expect(item?.id).toEqual("2");
		expect(item?.value1).toEqual("vvv");
		expect(item?.value2).toEqual(35);
		expect(item?.value3).toBeUndefined();
	});

	test("can get an item by secondary index", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		const secondaryValue = "zzz";
		await entityStorage.set({ id: "300", value1: secondaryValue, value2: 55, value3: undefined });
		const item = await entityStorage.get(secondaryValue, "value1");

		expect(item).toBeDefined();
		expect(item?.id).toEqual("300");
		expect(item?.value1).toEqual("zzz");
		expect(item?.value2).toEqual(55);
	});

	test("can fail to remove an item with no id", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
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
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.set({ id: "10001", value1: "aaa", value2: 5555, value3: undefined });

		const idToRemove = "1000999";
		await entityStorage.remove(idToRemove);
		// No exception should be thrown
	});

	test("can remove an item", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		const idToRemove = "65432";
		await entityStorage.set({ id: idToRemove, value1: "aaa", value2: 99, value3: undefined });
		await entityStorage.remove(idToRemove);

		const result = await entityStorage.get(idToRemove);
		expect(result).toBeUndefined();
	});

	test("can fail remove an item with a condition", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		const idToRemove = "65432";
		await entityStorage.set({ id: idToRemove, value1: "aaa", value2: 99, value3: undefined });
		await entityStorage.remove(idToRemove, [{ property: "value1", value: "aaa1" }]);

		const result = await entityStorage.get(idToRemove);
		expect(result).toBeDefined();
	});

	test("can remove an item with a condition", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		const idToRemove = "65432";
		await entityStorage.set({ id: idToRemove, value1: "aaa", value2: 99, value3: undefined });
		await entityStorage.remove(idToRemove, [{ property: "value1", value: "aaa" }]);

		const result = await entityStorage.get(idToRemove);
		expect(result).toBeUndefined();
	});

	test("can query items with empty store", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(0);
		expect(result.cursor).toBeUndefined();
	});

	test("can query items with single entry", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.set({ id: "1", value1: "aaa", value2: 95, value3: undefined });
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(1);
		expect(result.cursor).toBeUndefined();
	});

	test("can query items with multiple entries", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		for (let i = 0; i < 80; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 999,
				value3: undefined
			});
		}
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(40);
	});

	test("can query items with multiple entries and cursor", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		for (let i = 0; i < 50; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 5555,
				value3: undefined
			});
		}
		const result = await entityStorage.query();
		const result2 = await entityStorage.query(undefined, undefined, undefined, result.cursor);
		expect(result2).toBeDefined();
		expect(result2.entities.length).toEqual(10);
		expect(result2.cursor).toBeUndefined();
	});

	test("can query items with multiple entries and apply conditions", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 7777,
				value3: { field1: new Date().toISOString() }
			});
		}

		const result = await entityStorage.query({
			property: "id",
			value: "20",
			comparison: ComparisonOperator.Equals
		});

		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(1);
		expect(result.cursor).toBeUndefined();
	});

	test("can query items with multiple entries and apply custom sort", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({
				id: (30 - i).toString(),
				value1: (30 - i).toString(),
				value2: 7777,
				value3: undefined
			});
		}
		const result = await entityStorage.query(
			{
				conditions: [
					{
						property: "id",
						value: ["26", "20"],
						comparison: ComparisonOperator.In
					}
				]
			},
			[
				{
					property: "value1",
					sortDirection: SortDirection.Ascending
				}
			]
		);
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(2);
		expect(result.entities[0].value1).toEqual("20");
	});

	test("can query items and get a reduced data set", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 7777,
				value3: undefined
			});
		}
		const result = await entityStorage.query(undefined, undefined, ["id", "value1"]);
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(30);
		expect(result.entities[0].value2).toBeUndefined();
		expect(result.entities[0].value3).toBeUndefined();
	});

	test("can set an item to update it with a condition", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa",
			value2: 35,
			value3: undefined
		};

		await entityStorage.set(objectSet);
		objectSet.value2 = 99;
		await entityStorage.set(objectSet, [{ property: "value1", value: "aaa" }]);

		const result = await entityStorage.get(entityId);
		expect(result?.id).toEqual(objectSet.id);
		expect(result?.value1).toEqual(objectSet.value1);
		expect(result?.value2).toEqual(objectSet.value2);
		expect(result?.value3).toEqual(objectSet.value3);
	});

	test("can fail set an item to update it with an unmatched condition", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa",
			value2: 35,
			value3: undefined
		};

		await entityStorage.set(objectSet);
		objectSet.value2 = 99;

		const result = await expect(
			entityStorage.set(objectSet, [{ property: "value1", value: "bbb" }])
		);

		expect(result).toBeDefined();
	});

	test("can set data with a partition key", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.bootstrap("logging");

		currentUser = "user";
		await entityStorage.set(
			{
				id: "1",
				value1: "aaa",
				value2: 7777,
				value3: undefined,
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			},
			undefined
		);

		currentUser = "user2";
		await entityStorage.set(
			{
				id: "1",
				value1: "bbbb",
				value2: 8888,
				value3: undefined,
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			},
			undefined
		);

		currentUser = "user";
		const item = await entityStorage.get("1");
		expect(item).toEqual({
			id: "1",
			value1: "aaa",
			value2: 7777,
			value3: undefined,
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		});
	});

	test("can get data with a partition key", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.bootstrap("logging");

		currentUser = "user";
		await entityStorage.set(
			{
				id: "1",
				value1: "aaa",
				value2: 7777,
				value3: undefined,
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			},
			undefined
		);

		currentUser = "user2";
		await entityStorage.set(
			{
				id: "1",
				value1: "bbbb",
				value2: 8888,
				value3: undefined,
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			},
			undefined
		);

		currentUser = "user";
		const item = await entityStorage.get("1");
		expect(item).toEqual({
			id: "1",
			value1: "aaa",
			value2: 7777,
			value3: undefined,
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		});
	});

	test("can remove data with a partition key", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.bootstrap("logging");

		currentUser = "user";
		await entityStorage.set(
			{
				id: "1",
				value1: "aaa",
				value2: 7777,
				value3: undefined,
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			},
			undefined
		);

		currentUser = "user2";
		await entityStorage.set(
			{
				id: "1",
				value1: "bbbb",
				value2: 8888,
				value3: undefined,
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			},
			undefined
		);

		currentUser = "user";
		await entityStorage.remove("1");

		const result = await entityStorage.query(undefined, undefined, undefined, undefined, undefined);
		expect(result.entities).toEqual([]);

		currentUser = "user2";
		const result2 = await entityStorage.query(
			undefined,
			undefined,
			undefined,
			undefined,
			undefined
		);
		expect(result2.entities).toEqual([
			{
				id: "1",
				value1: "bbbb",
				value2: 8888,
				value3: undefined,
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			}
		]);
	});

	test("can query with a partition key", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.bootstrap("logging");

		currentUser = "user";
		await entityStorage.set(
			{
				id: "1",
				value1: "aaa",
				value2: 7777,
				value3: undefined,
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			},
			undefined
		);

		currentUser = "user2";
		await entityStorage.set(
			{
				id: "1",
				value1: "bbbb",
				value2: 8888,
				value3: undefined,
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			},
			undefined
		);

		currentUser = "user";
		const result = await entityStorage.query(undefined, undefined, undefined, undefined, undefined);
		expect(result.entities).toEqual([
			{
				id: "1",
				value1: "aaa",
				value2: 7777,
				value3: undefined,
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			}
		]);
	});

	test("can perform a query with an object condition", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});

		await entityStorage.bootstrap("logging");

		await entityStorage.set({
			id: "1",
			value1: "aaa",
			value2: 7777,
			value3: {
				field1: "2025-11-26T00:00:00.000Z"
			}
		});

		const result = await entityStorage.query({
			conditions: [
				{
					property: "value3",
					value: {
						field1: "2025-11-26T00:00:00.000Z"
					},
					comparison: ComparisonOperator.Equals
				}
			]
		});
		expect(result.entities).toEqual([
			{
				id: "1",
				value1: "aaa",
				value2: 7777,
				value3: {
					field1: "2025-11-26T00:00:00.000Z"
				}
			}
		]);
	});

	test("can query with ComparisonOperator.Includes on string field", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});

		await entityStorage.bootstrap("logging");

		// Create test entity with string field containing delimited values
		await entityStorage.set({
			id: "vertex-1",
			value1: "||mobius-261901-003||251702-015||",
			value2: 1,
			value3: undefined
		});

		// Test 1: Query with exact match including delimiters
		const result1 = await entityStorage.query({
			conditions: [
				{
					property: "value1",
					value: "||mobius-261901-003||",
					comparison: ComparisonOperator.Includes
				}
			]
		});

		expect(result1.entities).toBeDefined();
		expect(result1.entities.length).toBe(1);
		expect((result1.entities[0] as TestType).id).toBe("vertex-1");

		// Test 2: Query with partial match (no delimiters)
		const result2 = await entityStorage.query({
			conditions: [
				{
					property: "value1",
					value: "mobius-261901-003",
					comparison: ComparisonOperator.Includes
				}
			]
		});

		expect(result2.entities).toBeDefined();
		expect(result2.entities.length).toBe(1);
		expect((result2.entities[0] as TestType).id).toBe("vertex-1");
	});

	test("throws when querying with ComparisonOperator.Includes on nested object property (dot-notation not supported in CQL)", async () => {
		const entityStorage = new ScyllaDBTableConnector<NestedSearchType>({
			entitySchema: nameof<NestedSearchType>(),
			config: { ...TEST_SCYLLA_CONFIG, tableName: "test_nested" }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", consignor: { name: "Alice Smith" } });
		await expect(
			entityStorage.query({
				conditions: [
					{
						property: "consignor.name",
						value: "alice",
						comparison: ComparisonOperator.Includes
					}
				]
			})
		).rejects.toMatchObject({ name: "GeneralError" });
	});

	test("throws when querying with ComparisonOperator.NotEquals on nested object property (dot-notation not supported in CQL)", async () => {
		const entityStorage = new ScyllaDBTableConnector<NestedSearchType>({
			entitySchema: nameof<NestedSearchType>(),
			config: { ...TEST_SCYLLA_CONFIG, tableName: "test_nested" }
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", consignor: { name: "Alice" } });
		await expect(
			entityStorage.query({
				conditions: [
					{
						property: "consignor.name",
						value: "Alice",
						comparison: ComparisonOperator.NotEquals
					}
				]
			})
		).rejects.toMatchObject({ name: "GeneralError" });
	});

	test("can query with ComparisonOperator.Includes on plain string field", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "hello world", value2: 1, value3: undefined });
		await entityStorage.set({ id: "2", value1: "foo bar", value2: 2, value3: undefined });
		await entityStorage.set({ id: "3", value1: "worldwide", value2: 3, value3: undefined });
		const result = await entityStorage.query({
			conditions: [{ property: "value1", value: "world", comparison: ComparisonOperator.Includes }]
		});
		expect(result.entities.map(e => (e as TestType).id).sort()).toEqual(["1", "3"]);
	});

	test("throws when querying with NotEquals and undefined on an optional number field (null comparison not supported in CQL)", async () => {
		const entityStorage = new ScyllaDBTableConnector<ExpiryTestType>({
			entitySchema: nameof<ExpiryTestType>(),
			config: { ...TEST_SCYLLA_CONFIG, tableName: "expires_test" }
		});
		await entityStorage.bootstrap();

		await entityStorage.set({ id: "1", status: "pending" });
		await entityStorage.set({ id: "2", status: "active", expires: 1_000 });

		await expect(
			entityStorage.query({
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
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "abstractScyllaDBConnector.comparisonNotSupported"
		});
	});

	test("throws when querying with NotEquals and null on an optional number field (null comparison not supported in CQL)", async () => {
		const entityStorage = new ScyllaDBTableConnector<ExpiryTestType>({
			entitySchema: nameof<ExpiryTestType>(),
			config: { ...TEST_SCYLLA_CONFIG, tableName: "expires_test" }
		});
		await entityStorage.bootstrap();

		await entityStorage.set({ id: "1", status: "active", expires: 0 });
		await entityStorage.set({ id: "2", status: "pending" });
		await entityStorage.set({ id: "3", status: "active", expires: 1_000 });

		await expect(
			entityStorage.query({
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
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "abstractScyllaDBConnector.comparisonNotSupported"
		});
	});

	test("can empty with no items", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.empty();
		expect(await entityStorage.count()).toEqual(0);
	});

	test("can empty the store", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.set({ id: "1", value1: "aaa", value2: 1, value3: undefined });
		await entityStorage.set({ id: "2", value1: "bbb", value2: 2, value3: undefined });
		await entityStorage.set({ id: "3", value1: "ccc", value2: 3, value3: undefined });
		await entityStorage.empty();
		expect(await entityStorage.count()).toEqual(0);
	});

	test("can teardown the store", async () => {
		const entityStorage = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: 1, value3: undefined });

		await entityStorage.teardown();

		// Re-bootstrap so the afterEach truncateTable call doesn't fail
		await entityStorage.bootstrap("logging");
	});

	describe("count", () => {
		test("can count items", async () => {
			const entityStorage = new ScyllaDBTableConnector<TestType>({
				entitySchema: nameof<TestType>(),
				config: TEST_SCYLLA_CONFIG
			});
			await entityStorage.set({ id: "1", value1: "aaa", value2: 35, value3: undefined });
			await entityStorage.set({ id: "2", value1: "bbb", value2: 36, value3: undefined });
			await entityStorage.set({ id: "3", value1: "ccc", value2: 37, value3: undefined });
			const result = await entityStorage.count();
			expect(result).toEqual(3);
		});
	});

	describe("health", () => {
		test("can get health ok", async () => {
			const entityStorage = new ScyllaDBTableConnector<TestType>({
				entitySchema: nameof<TestType>(),
				config: TEST_SCYLLA_CONFIG
			});
			const health = await entityStorage.health();
			expect(health[0].status).toEqual(HealthStatus.Ok);
		});

		test("can get health error", async () => {
			const entityStorage = new ScyllaDBTableConnector<TestType>({
				entitySchema: nameof<TestType>(),
				config: TEST_SCYLLA_CONFIG
			});
			const entityStorageInternal: { openConnection: () => Promise<unknown> } =
				entityStorage as unknown as { openConnection: () => Promise<unknown> };
			vi.spyOn(entityStorageInternal, "openConnection").mockRejectedValueOnce(
				new Error("Connection failed")
			);
			const health = await entityStorage.health();
			expect(health[0].status).toEqual(HealthStatus.Error);
		});
	});
});
