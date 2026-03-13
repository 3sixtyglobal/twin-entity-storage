// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import { ComponentFactory, ObjectHelper } from "@twin.org/core";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
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
import { TEST_DYNAMODB_CONFIG } from "./setupTestEnv.js";
import { DynamoDbEntityStorageConnector } from "../src/dynamoDbEntityStorageConnector.js";
import type { IDynamoDbEntityStorageConnectorConfig } from "../src/models/IDynamoDbEntityStorageConnectorConfig.js";

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
	public value3?: SubType;

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
 * Test entity with nested object and array properties for dot-notation query tests.
 */
@entity()
class NestedSearchType {
	/**
	 * Id.
	 */
	@property({ type: "string", isPrimary: true })
	public id!: string;

	/**
	 * Nested object property (e.g. firstConsignor.name use case).
	 */
	@property({ type: "object", optional: true })
	public consignor?: { name: string };

	/**
	 * Nested array property (e.g. commodities.information use case).
	 */
	@property({ type: "array", optional: true })
	public items?: { label: string }[];
}

let currentUser = "user";

let memoryEntityStorage: MemoryEntityStorageConnector<LogEntry>;

describe("DynamoDbEntityStorageConnector", () => {
	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
		EntitySchemaFactory.register(nameof<SubType>(), () => EntitySchemaHelper.getSchema(SubType));
		EntitySchemaFactory.register(nameof<NestedSearchType>(), () =>
			EntitySchemaHelper.getSchema(NestedSearchType)
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
		const entityStorage = new DynamoDbEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		try {
			await entityStorage.tableDelete();
		} catch {}
	});

	afterEach(async () => {
		const entityStorage = new DynamoDbEntityStorageConnector({
			entitySchema: nameof<NestedSearchType>(),
			config: { ...TEST_DYNAMODB_CONFIG, tableName: "test_nested" }
		});
		try {
			await entityStorage.tableDelete();
		} catch {}
	});

	test("can fail to construct when there are no options", async () => {
		expect(
			() =>
				new DynamoDbEntityStorageConnector(
					undefined as unknown as {
						entitySchema: string;
						config: IDynamoDbEntityStorageConnectorConfig;
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
				new DynamoDbEntityStorageConnector(
					{} as unknown as {
						entitySchema: string;
						config: IDynamoDbEntityStorageConnectorConfig;
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

	test("can construct and bootstrap", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const logs = memoryEntityStorage.getStore();
		expect(logs?.find(l => l.level === "error")).toBeUndefined();
	});

	test("can fail to set an item with no entity", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
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
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
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
		expect(result?.id).toEqual(objectSet.id);
		expect(result?.value1).toEqual(objectSet.value1);
		expect(result?.value2).toEqual(objectSet.value2);
		expect(result?.value3).toEqual(objectSet.value3);
	});

	test("can set an item with a condition", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
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
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
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

		objectSet.value2 = 99;
		await entityStorage.set(objectSet);

		const result = await entityStorage.get(entityId);
		expect(result?.id).toEqual(objectSet.id);
		expect(result?.value1).toEqual(objectSet.value1);
		expect(result?.value2).toEqual(objectSet.value2);
		expect(result?.value3).toEqual(objectSet.value3);
	});

	test("can fail to get an item with no id", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
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
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const item = await entityStorage.get("20000");

		expect(item).toBeUndefined();
	});

	test("can get an item", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "2", value1: "vvv", value2: 35, value3: undefined });
		const item = await entityStorage.get("2");

		expect(item).toBeDefined();
		expect(item?.id).toEqual("2");
		expect(item?.value1).toEqual("vvv");
		expect(item?.value2).toEqual(35);
		expect(item?.value3).toBeUndefined();
	});

	test("can get an item by secondary index", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});

		await entityStorage.bootstrap("logging");
		const secondaryValue = "zzz";
		await entityStorage.set({ id: "300", value1: secondaryValue, value2: 55, value3: undefined });
		const item = await entityStorage.get(secondaryValue, "value1");

		expect(item).toBeDefined();
		expect(item?.id).toEqual("300");
		expect(item?.value1).toEqual("zzz");
		expect(item?.value2).toEqual(55);
	});

	test("can fail to remove an item with no id", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
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
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");

		await entityStorage.set({ id: "10001", value1: "aaa", value2: 5555, value3: undefined });

		const idToRemove = "1000999";
		await entityStorage.remove(idToRemove);
		// No exception should be thrown
	});

	test("can remove an item", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const idToRemove = "65432";
		await entityStorage.set({ id: idToRemove, value1: "aaa", value2: 99, value3: undefined });
		await entityStorage.remove(idToRemove);

		const result = await entityStorage.get(idToRemove);
		expect(result).toBeUndefined();
	});

	test("can fail to remove an item with conditions", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});

		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: 99, value3: undefined });
		await entityStorage.remove("1", [{ property: "value1", value: "aaa1" }]);

		const result = await entityStorage.get("1");
		expect(result).toBeDefined();
	});

	test("can remove an item with conditions", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});

		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: 99, value3: undefined });
		await entityStorage.remove("1", [{ property: "value1", value: "aaa" }]);

		const result = await entityStorage.get("1");
		expect(result).toBeUndefined();
	});

	test("can find items with empty store", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(0);
		expect(result.cursor).toBeUndefined();
	});

	test("can find items with single entry", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: 95, value3: undefined });
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(1);
		expect(result.cursor).toBeUndefined();
	});

	test("can find items with multiple entries", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
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

	test("can find items with multiple entries and cursor", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
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

	test("can find items with multiple entries and apply conditions", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
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

	test("can find items with multiple entries and apply custom sort", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
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
						property: "value1",
						value: ["26", "20"],
						comparison: ComparisonOperator.In
					}
				]
			},
			[
				{
					property: "id",
					sortDirection: SortDirection.Ascending
				}
			]
		);
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(2);
		expect(result.entities[0].value1).toEqual("20");
		expect(result.entities[1].value1).toEqual("26");
	});

	test("can query items and get a reduced data set", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
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

	test("can query sub items in object", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 5; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 7777,
				value3: undefined,
				valueObject: {
					name: {
						value: "bob"
					}
				}
			});
		}
		for (let i = 0; i < 5; i++) {
			await entityStorage.set({
				id: (i + 10).toString(),
				value1: "aaa",
				value2: 7777,
				value3: undefined,
				valueObject: {
					name: {
						value: "fred"
					}
				}
			});
		}
		const result = await entityStorage.query({
			conditions: [
				{ property: "valueObject.name.value", value: "bob", comparison: ComparisonOperator.Equals }
			]
		});
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(5);
	});

	test("can query sub items in array", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 5; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
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
		}
		for (let i = 0; i < 5; i++) {
			await entityStorage.set({
				id: (i + 10).toString(),
				value1: "aaa",
				value2: 7777,
				value3: undefined,
				valueArray: [
					{
						field: "name",
						value: "fred"
					}
				]
			});
		}
		const result = await entityStorage.query({
			conditions: [
				{
					property: "valueArray",
					value: { field: "name", value: "bob" },
					comparison: ComparisonOperator.Includes
				}
			]
		});
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(5);
	});

	test("can set an item to update it with a condition", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
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
		objectSet.value2 = 99;
		await entityStorage.set(objectSet, [{ property: "value1", value: "aaa" }]);

		const result = await entityStorage.get(entityId);
		expect(result?.id).toEqual(objectSet.id);
		expect(result?.value1).toEqual(objectSet.value1);
		expect(result?.value2).toEqual(objectSet.value2);
		expect(result?.value3).toEqual(objectSet.value3);
	});

	test("can fail set an item to update it with an unmatched condition", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
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

		const objectUpdate = ObjectHelper.clone(objectSet);
		objectUpdate.value2 = 99;

		await entityStorage.set(objectUpdate, [{ property: "value1", value: "bbb" }]);

		const item = await entityStorage.get(entityId);
		expect(item).toEqual(objectSet);
	});

	test("can query items with undefined value comparison", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");

		await entityStorage.set({
			id: "1",
			value1: "test1",
			value2: 100,
			value3: { field1: new Date().toISOString() }
		});
		await entityStorage.set({
			id: "2",
			value1: "test2",
			value2: 200
		});

		const result = await entityStorage.query({
			property: "value3",
			value: undefined,
			comparison: ComparisonOperator.Equals
		});

		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(1);
		expect(result.entities[0].id).toEqual("2");
	});

	test("can query items with not undefined value comparison", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");

		await entityStorage.set({
			id: "1",
			value1: "test1",
			value2: 100,
			value3: { field1: new Date().toISOString() }
		});
		await entityStorage.set({
			id: "2",
			value1: "test2",
			value2: 200
		});

		const result = await entityStorage.query({
			property: "value3",
			value: null,
			comparison: ComparisonOperator.NotEquals
		});

		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(1);
		expect(result.entities[0].id).toEqual("1");
		expect(result.entities[0].value3).toBeDefined();
	});

	test("can set data with a partition key", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: TEST_DYNAMODB_CONFIG
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
				value1: "bbb",
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
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: TEST_DYNAMODB_CONFIG
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
				value1: "bbb",
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
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: TEST_DYNAMODB_CONFIG
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
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: TEST_DYNAMODB_CONFIG
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
		const entityStorage = new DynamoDbEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});

		await entityStorage.bootstrap("logging");

		await entityStorage.set({
			id: "1",
			value1: "aaa",
			value2: 7777,
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
				value2: 7777,
				value3: {
					field1: "foo"
				}
			}
		]);
	});

	test("can query items with Includes on string field", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "inc1", value1: "hello world", value2: 1 });
		await entityStorage.set({ id: "inc2", value1: "foo bar", value2: 2 });
		await entityStorage.set({ id: "inc3", value1: "worldwide", value2: 3 });

		const result = await entityStorage.query({
			conditions: [{ property: "value1", value: "world", comparison: ComparisonOperator.Includes }]
		});
		expect(result.entities.map(e => e.id).sort()).toEqual(["inc1", "inc3"]);
	});

	test("REPRODUCES ISSUE: partition key mismatch between write and read", async () => {
		// This test reproduces the identity-management onboarding issue
		// where partition keys change between write and read operations
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node"],
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap("logging");

		// Simulate write operation with raw DID format
		const originalGetContextIds = ContextIdStore.getContextIds;
		const rawDid =
			"did:iota:testnet:0x4f90da6f080e04dac1be0d13cc8bfe0097236b0c37f150f876921c3d06919a9f";

		ContextIdStore.getContextIds = vi.fn().mockResolvedValue({
			node: rawDid,
			tenant: "tenant",
			user: "user"
		});

		// Write the record (partition key will be the raw DID)
		const onboardingId = "HimX-VOmkja_zNB8YhbXGg";
		await entityStorage.set({
			id: onboardingId,
			value1: "test-user@example.com",
			value2: 100,
			value3: undefined
		});

		// Verify the record was written successfully
		const writtenRecord = await entityStorage.get(onboardingId);
		expect(writtenRecord).toBeDefined();
		expect(writtenRecord?.id).toEqual(onboardingId);

		// Simulate read operation with base64-transformed DID
		// This mimics what happens when a ContextIdHandler transforms the DID
		const base64Did = "T5DabwgOBNrBvg0TzIv-AJcjaww38VD4dpIcPQaRmp8";

		ContextIdStore.getContextIds = vi.fn().mockResolvedValue({
			node: base64Did, // Different format!
			tenant: "tenant",
			user: "user"
		});

		// Try to read the same record (should fail because partition key doesn't match)
		const readRecord = await entityStorage.get(onboardingId);

		// THIS IS THE BUG: The record exists but can't be found due to partition key mismatch
		// In production, this causes a 404 error in the onboarding complete endpoint
		expect(readRecord).toBeUndefined(); // Record not found even though it exists!

		// Restore original function
		ContextIdStore.getContextIds = originalGetContextIds;
	});

	test("can query with ComparisonOperator.Includes on nested object property (dot-notation)", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<NestedSearchType>({
			entitySchema: nameof<NestedSearchType>(),
			config: { ...TEST_DYNAMODB_CONFIG, tableName: "test_nested" }
		});
		await entityStorage.bootstrap();

		await entityStorage.set({ id: "1", consignor: { name: "alice smith" } });
		await entityStorage.set({ id: "2", consignor: { name: "bob jones" } });
		await entityStorage.set({ id: "3", consignor: { name: "alice cooper" } });

		const result = await entityStorage.query({
			property: "consignor.name",
			comparison: ComparisonOperator.Includes,
			value: "alice"
		});

		expect(result.entities.length).toBe(2);
		const names = result.entities.map(e => (e as NestedSearchType).consignor?.name);
		expect(names).toEqual(expect.arrayContaining(["alice smith", "alice cooper"]));
	});

	test("can query with ComparisonOperator.NotEquals on nested object property (dot-notation)", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<NestedSearchType>({
			entitySchema: nameof<NestedSearchType>(),
			config: { ...TEST_DYNAMODB_CONFIG, tableName: "test_nested" }
		});
		await entityStorage.bootstrap();

		await entityStorage.set({ id: "1", consignor: { name: "alice" } });
		await entityStorage.set({ id: "2", consignor: { name: "bob" } });
		await entityStorage.set({ id: "3", consignor: { name: "charlie" } });

		const result = await entityStorage.query({
			property: "consignor.name",
			comparison: ComparisonOperator.NotEquals,
			value: "alice"
		});

		expect(result.entities.length).toBe(2);
		const names = result.entities.map(e => (e as NestedSearchType).consignor?.name);
		expect(names).toEqual(expect.arrayContaining(["bob", "charlie"]));
	});

	test("can query with ComparisonOperator.Includes on string field", async () => {
		const entityStorage = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		await entityStorage.bootstrap();

		await entityStorage.set({ id: "ci-1", value1: "hello world", value2: 1 });
		await entityStorage.set({ id: "ci-2", value1: "hello again", value2: 2 });
		await entityStorage.set({ id: "ci-3", value1: "goodbye world", value2: 3 });

		const result = await entityStorage.query({
			property: "value1",
			comparison: ComparisonOperator.Includes,
			value: "hello"
		});

		expect(result.entities.length).toBe(2);
		const ids = result.entities.map(e => (e as TestType).id);
		expect(ids).toEqual(expect.arrayContaining(["ci-1", "ci-2"]));
	});
});
