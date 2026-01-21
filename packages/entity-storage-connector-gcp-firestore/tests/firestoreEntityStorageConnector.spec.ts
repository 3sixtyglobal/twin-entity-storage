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
import { TEST_FIRESTORE_CONFIG } from "./setupTestEnv.js";
import { FirestoreEntityStorageConnector } from "../src/firestoreEntityStorageConnector.js";
import type { IFirestoreEntityStorageConnectorConfig } from "../src/models/IFirestoreEntityStorageConnectorConfig.js";

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
 * Value Type Definition.
 */
@entity()
class ValueType {
	@property({ type: "string" })
	public field!: string;

	@property({ type: "string" })
	public value!: string;
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
	 * Array of strings that will store the indexed values extracted from valueArray.
	 */
	@property({ type: "array", itemType: "string", optional: true })
	public valueArrayFields?: string[];

	/**
	 * Value6.
	 */
	@property({ type: "array", itemTypeRef: "ValueType", optional: true })
	public valueArray?: ValueType[];
}

let currentUser = "user";

let memoryEntityStorage: MemoryEntityStorageConnector<LogEntry>;

describe("FirestoreEntityStorageConnector", () => {
	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
		EntitySchemaFactory.register(nameof<SubType>(), () => EntitySchemaHelper.getSchema(SubType));
		EntitySchemaFactory.register(nameof<ValueType>(), () =>
			EntitySchemaHelper.getSchema(ValueType)
		);

		initSchema();

		ContextIdStore.getContextIds = vi
			.fn()
			.mockImplementation(() => ({ node: "node", tenant: "tenant", user: currentUser }));
	});

	beforeEach(async () => {
		memoryEntityStorage = new MemoryEntityStorageConnector<LogEntry>({
			entitySchema: nameof<LogEntry>()
		});
		EntityStorageConnectorFactory.register("log-entry", () => memoryEntityStorage);
		LoggingConnectorFactory.register("logging", () => new EntityStorageLoggingConnector());
		ComponentFactory.register("logging", () => new LoggingService());
	});

	afterEach(async () => {
		try {
			const entityStorage = new FirestoreEntityStorageConnector<TestType>({
				entitySchema: nameof<TestType>(),
				config: TEST_FIRESTORE_CONFIG
			});
			await entityStorage.bootstrap("logging");
			await entityStorage.collectionDelete();
		} catch {}
	});

	test("can fail to construct when there are no options", async () => {
		expect(
			() =>
				new FirestoreEntityStorageConnector<TestType>(
					undefined as unknown as {
						entitySchema: string;
						config: IFirestoreEntityStorageConnectorConfig;
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
				new FirestoreEntityStorageConnector<TestType>(
					{} as unknown as {
						entitySchema: string;
						config: IFirestoreEntityStorageConnectorConfig;
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
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		expect(entityStorage).toBeDefined();
		const logs = memoryEntityStorage.getStore();
		expect(logs).toBeDefined();
		expect(logs?.find(l => l.level === "error")).toBeUndefined();
	});

	test("can fail to set an item with no entity", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");

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
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
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

	test("can set an item to update it with a condition", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");

		const entityId = "1";
		const objectSet: TestType = {
			id: entityId,
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() }
		};

		await entityStorage.set(objectSet);

		const updateSet = ObjectHelper.clone(objectSet);
		updateSet.value2 = 99;
		await entityStorage.set(updateSet, [{ property: "value1", value: "aaa" }]);

		const result = await entityStorage.get(entityId);
		expect(result).toEqual(updateSet);
	});

	test("can fail to set an item with conditions not met", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");

		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa",
			value2: 35
		};

		await entityStorage.set(objectSet);

		const updateSet = ObjectHelper.clone(objectSet);
		updateSet.value2 = 99;
		await entityStorage.set(updateSet, [{ property: "value1", value: "bbb" }]);

		const result = await entityStorage.get(entityId);
		expect(result).toEqual(objectSet);
	});

	test("can set an item with conditions met", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");

		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa",
			value2: 35
		};
		await entityStorage.set(objectSet);

		const updateSet = ObjectHelper.clone(objectSet);
		updateSet.value2 = 99;
		await entityStorage.set(updateSet, [{ property: "value1", value: "aaa" }]);

		const result = await entityStorage.get(entityId);
		expect(result).toEqual(updateSet);
	});

	test("can set an item to update it", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
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

		const updateSet = ObjectHelper.clone(objectSet);
		updateSet.value2 = 99;
		await entityStorage.set(updateSet);

		const result = await entityStorage.get(entityId);
		expect(result).toEqual(updateSet);
	});

	test("can fail to update an item with a condition", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const entityId = "1";
		const objectSet: TestType = {
			id: entityId,
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() }
		};

		await entityStorage.set(objectSet);

		const updateSet = ObjectHelper.clone(objectSet);
		updateSet.value2 = 99;
		await entityStorage.set(updateSet, [{ property: "value1", value: "bbb" }]);

		const result = await entityStorage.get(entityId);
		expect(result).toEqual(objectSet);
	});

	test("can fail to get an item with no id", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
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
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const item = await entityStorage.get("20000");

		expect(item).toBeUndefined();
	});

	test("can get an item", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const objectSet = { id: "2", value1: "vvv", value2: 35 };
		await entityStorage.set(objectSet);
		const item = await entityStorage.get("2");

		expect(item).toBeDefined();
		expect(item).toEqual(objectSet);
	});

	test("can get an item using secondary index", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const objectSet = { id: "2", value1: "vvv", value2: 35 };
		await entityStorage.set(objectSet);

		const item = await entityStorage.get("vvv", "value1");

		expect(item).toBeDefined();
		expect(item).toEqual(objectSet);
	});

	test("can get an item with conditions met", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const objectSet = { id: "1", value1: "aaa", value2: 35 };
		await entityStorage.set(objectSet);

		const result = await entityStorage.get(objectSet.id, undefined, [
			{ property: "value1", value: "aaa" }
		]);
		expect(result).toBeDefined();
		expect(result).toEqual(objectSet);
	});

	test("can fail to get an item with conditions not met", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const objectSet = { id: "1", value1: "aaa", value2: 35 };
		await entityStorage.set(objectSet);

		const result = await entityStorage.get(objectSet.id, "value1", [
			{ property: "value1", value: "bbb" }
		]);
		expect(result).toBeUndefined();
	});

	test("can fail to remove an item with no id", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
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
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "10001", value1: "aaa", value2: 5555 });

		const idToRemove = "1000999";
		await entityStorage.remove(idToRemove);
		// No exception should be thrown
	});

	test("can remove an item", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const idToRemove = "65432";
		await entityStorage.set({ id: idToRemove, value1: "aaa", value2: 99 });
		await entityStorage.remove(idToRemove);

		const result = await entityStorage.get(idToRemove);
		expect(result).toBeUndefined();
	});

	test("can fail to remove an item with conditions not met", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const entityId = "1";
		await entityStorage.set({ id: entityId, value1: "aaa", value2: 35 });

		// Try to remove with a condition that value1 is "bbb" (which is not true)
		await entityStorage.remove(entityId, [{ property: "value1", value: "bbb" }]);

		// The document should still exist
		const result = await entityStorage.get(entityId);
		expect(result).toBeDefined();
	});

	test("can remove an item with conditions met", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const entityId = "1";
		await entityStorage.set({ id: entityId, value1: "aaa", value2: 35 });

		// Remove with a condition that value1 is "aaa" (which is true)
		await entityStorage.remove(entityId, [{ property: "value1", value: "aaa" }]);

		// The document should no longer exist
		const result = await entityStorage.get(entityId);
		expect(result).toBeUndefined();
	});

	test("can find items with empty store", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(0);
		expect(result.cursor).toBeUndefined();
	});

	test("can find items with single entry", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		const objectSet = { id: "1", value1: "aaa", value2: 95 };
		await entityStorage.set(objectSet);
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(1);
		expect(result.entities[0]).toEqual(objectSet);
		expect(result.cursor).toBeUndefined();
	});

	test("can find items with multiple entries", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 80; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 999
			});
		}
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(40);
	});

	test("can find items with multiple entries and cursor", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 50; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 5555
			});
		}
		const result = await entityStorage.query();
		const result2 = await entityStorage.query(undefined, undefined, undefined, result.cursor);
		expect(result2).toBeDefined();
		expect(result2.entities.length).toEqual(10);
		expect(result2.cursor).toBeUndefined();
	});

	test("can find items with multiple entries and apply conditions", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
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
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({
				id: (30 - i).toString(),
				value1: (30 - i).toString(),
				value2: 7777
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
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 7777
			});
		}
		const result = await entityStorage.query(undefined, undefined, ["id", "value1"]);
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(30);
		expect(result.entities[0].value2).toBeUndefined();
		expect(result.entities[0].value3).toBeUndefined();
	});

	test("can query sub items in object", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 5; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 7777,
				valueObject: { name: { value: "bob" } }
			});
		}
		for (let i = 0; i < 5; i++) {
			await entityStorage.set({
				id: (i + 10).toString(),
				value1: "aaa",
				value2: 7777,
				valueObject: { name: { value: "fred" } }
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

	test("can set data with a partition key", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");

		currentUser = "user";
		await entityStorage.set(
			{
				id: "1",
				value1: "aaa",
				value2: 7777,
				value3: { field1: new Date().toISOString() },
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
				value3: { field1: new Date().toISOString() },
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
			value3: { field1: expect.any(String) },
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		});
	});

	test("can get data with a partition key", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");

		currentUser = "user";
		await entityStorage.set(
			{
				id: "1",
				value1: "aaa",
				value2: 7777,
				value3: { field1: new Date().toISOString() },
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
				value3: { field1: new Date().toISOString() },
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
			value3: { field1: expect.any(String) },
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		});
	});

	test("can remove data with a partition key", async () => {
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");

		currentUser = "user";
		await entityStorage.set(
			{
				id: "1",
				value1: "aaa",
				value2: 7777,
				value3: { field1: new Date().toISOString() },
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
				value3: { field1: new Date().toISOString() },
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
				value3: { field1: expect.any(String) },
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
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config: TEST_FIRESTORE_CONFIG
		});
		await entityStorage.bootstrap("logging");

		currentUser = "user";
		await entityStorage.set(
			{
				id: "1",
				value1: "aaa",
				value2: 7777,
				value3: { field1: new Date().toISOString() },
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
				value3: { field1: new Date().toISOString() },
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
				value3: { field1: expect.any(String) },
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
		const entityStorage = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
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

	test.skip("can query items with Includes on array field (Firestore only supports array-contains, not string substrings)", async () => {
		// Skipped: Firestore does not support substring search in string fields, only array-contains for arrays.
	});
});
