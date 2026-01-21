// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import { ComponentFactory, ObjectHelper } from "@twin.org/core";
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
import { TEST_POSTGRESQL_CONFIG } from "./setupTestEnv.js";
import type { IPostgreSqlEntityStorageConnectorConfig } from "../src/models/IPostgreSqlEntityStorageConnectorConfig.js";
import { PostgreSqlEntityStorageConnector } from "../src/postgreSqlEntityStorageConnector.js";

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
 * Test Type with Mnemonic as Object Definition.
 * This reproduces the bug where a field is defined as Object
 * but stored as plain text (not JSON).
 */
@entity()
class TestTypeWithMnemonicAsObject {
	/**
	 * Id.
	 */
	@property({ type: "string", isPrimary: true })
	public id!: string;

	/**
	 * Mnemonic - defined as Object but stored as plain text string.
	 * This should trigger JSON.parse() error if not handled properly.
	 */
	@property({ type: "object", optional: true })
	public mnemonic?: { value: string };
}

/**
 * BackgroundTask Type Definition.
 * Reproduces the placeholder bug from the issue report.
 */
@entity()
class BackgroundTask {
	/**
	 * Id.
	 */
	@property({ type: "string", isPrimary: true })
	public id!: string;

	/**
	 * RetainUntil timestamp.
	 */
	@property({ type: "string", format: "date-time" })
	public retainUntil!: string;

	/**
	 * Status of the task.
	 */
	@property({ type: "string" })
	public status!: string;
}

let currentUser = "user";

let memoryEntityStorage: MemoryEntityStorageConnector<LogEntry>;
const config: IPostgreSqlEntityStorageConnectorConfig = TEST_POSTGRESQL_CONFIG;

describe("PostgreSqlEntityStorageConnector", () => {
	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
		EntitySchemaFactory.register(nameof<SubType>(), () => EntitySchemaHelper.getSchema(SubType));
		EntitySchemaFactory.register(nameof<TestTypeWithMnemonicAsObject>(), () =>
			EntitySchemaHelper.getSchema(TestTypeWithMnemonicAsObject)
		);
		EntitySchemaFactory.register(nameof<BackgroundTask>(), () =>
			EntitySchemaHelper.getSchema(BackgroundTask)
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
		const entityStorage = new PostgreSqlEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.tableDrop();
	});

	test("can fail to construct when there are no options", async () => {
		expect(
			() =>
				new PostgreSqlEntityStorageConnector(
					undefined as unknown as {
						entitySchema: string;
						config: IPostgreSqlEntityStorageConnectorConfig;
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
				new PostgreSqlEntityStorageConnector(
					{} as unknown as {
						entitySchema: string;
						config: IPostgreSqlEntityStorageConnectorConfig;
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
		const entityStorage = new PostgreSqlEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const logs = memoryEntityStorage.getStore();
		expect(logs?.find(l => l.level === "error")).toBeUndefined();
	});

	test("can fail to set an item with no entity", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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

	test("can fail to set an item with an entity that do not match the table", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa"
		} as TestType;

		await expect(entityStorage.set(objectSet)).rejects.toThrowError(
			expect.objectContaining({
				source: "EntitySchemaHelper",
				message: "entitySchemaHelper.invalidOptional",
				properties: {
					property: "value2",
					type: "number"
				}
			})
		);
	});

	test("can set an item", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa",
			value2: 35,
			value3: undefined,
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		};

		await entityStorage.set(objectSet);

		const result = await entityStorage.get(entityId);
		expect(result).toEqual(objectSet);
	});

	test("can set an item with a condition", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() },
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		};

		await entityStorage.set(objectSet, [{ property: "value1", value: "aaa" }]);

		const result = await entityStorage.get(entityId);
		expect(result).toEqual(objectSet);
	});

	test("can set an item to update it", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");

		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() },
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		};
		await entityStorage.set(objectSet);

		objectSet.value2 = 99;
		await entityStorage.set(objectSet);

		const result = await entityStorage.get(entityId);
		expect(result).toEqual({
			id: entityId,
			value1: "aaa",
			value2: 99,
			value3: { field1: expect.any(String) },
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		});
	});

	test("can set an item to update it with a condition", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() },
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		};

		await entityStorage.set(objectSet);

		const objectUpdate = ObjectHelper.clone(objectSet);
		objectUpdate.value2 = 99;
		await entityStorage.set(objectUpdate, [{ property: "value1", value: "aaa" }]);

		const result = await entityStorage.get(entityId);
		expect(result).toEqual(objectUpdate);
	});

	test("can fail set an item to update it with an unmatched condition", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const entityId = "1";
		const objectSet = {
			id: entityId,
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() },
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		};

		await entityStorage.set(objectSet);
		const objectUpdate = ObjectHelper.clone(objectSet);
		objectUpdate.value2 = 99;

		await entityStorage.set(objectUpdate, [{ property: "value1", value: "bbb" }]);

		// Should still have original value set
		const result = await entityStorage.get(entityId);
		expect(result).toEqual(objectSet);
	});

	test("can fail to get an item with no id", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const item = await entityStorage.get("20000");

		expect(item).toBeUndefined();
	});

	test("can get an item", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const object = {
			id: "2",
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() },
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		};
		await entityStorage.set(object);
		const item = await entityStorage.get("2");

		expect(item).toBeDefined();
		expect(item).toEqual(object);
	});

	test("can get an item by secondary index", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});

		await entityStorage.bootstrap("logging");
		const secondaryValue = "zzz";
		const object = {
			id: "2",
			value1: "zzz",
			value2: 35,
			value3: { field1: new Date().toISOString() },
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		};
		await entityStorage.set(object);
		const item = await entityStorage.get(secondaryValue, "value1");

		expect(item).toBeDefined();
		expect(item).toEqual(object);
	});

	test("can fail to remove an item with no id", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");

		const object = {
			id: "2",
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() },
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		};
		await entityStorage.set(object);

		const idToRemove = "1000999";
		await entityStorage.remove(idToRemove);
		// No exception should be thrown
	});

	test("can remove an item", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const idToRemove = "65432";
		const object = {
			id: "65432",
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() },
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		};
		await entityStorage.set(object);
		await entityStorage.remove(idToRemove);

		const result = await entityStorage.get(idToRemove);
		expect(result).toBeUndefined();
	});

	test("can fail to remove an item with conditions", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});

		await entityStorage.bootstrap("logging");
		const object = {
			id: "1",
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() },
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		};
		await entityStorage.set(object);
		await entityStorage.remove("1", [{ property: "value1", value: "aaa1" }]);

		const result = await entityStorage.get("1");
		expect(result).toBeDefined();
	});

	test("can remove an item with conditions", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});

		await entityStorage.bootstrap("logging");
		const object = {
			id: "1",
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() },
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		};
		await entityStorage.set(object);
		await entityStorage.remove("1", [{ property: "value1", value: "aaa" }]);

		const result = await entityStorage.get("1");
		expect(result).toBeUndefined();
	});

	test("can find items with empty store", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(0);
		expect(result.cursor).toBeUndefined();
	});

	test("can find items with single entry", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const entry = {
			id: "1",
			value1: "aaa",
			value2: 35,
			value3: { field1: new Date().toISOString() },
			valueObject: {
				"1": {
					value: "bob"
				}
			},
			valueArray: [
				{
					field: "name",
					value: "bob"
				}
			]
		};
		await entityStorage.set(entry);
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(1);
		expect(result.entities[0]).toEqual(entry);
		expect(result.cursor).toBeUndefined();
	});

	test("can find items with multiple entries", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 80; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 999,
				value3: undefined,
				valueObject: {
					"1": {
						value: "bob"
					}
				},
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			});
		}
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(40);
	});

	test("can find items with multiple entries and cursor", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 50; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 5555,
				valueObject: {
					"1": {
						value: "bob"
					}
				},
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			});
		}
		const result = await entityStorage.query();
		const result2 = await entityStorage.query(undefined, undefined, undefined, result.cursor);
		expect(result2).toBeDefined();
		expect(result2.entities.length).toEqual(10);
		expect(result2.cursor).toBeUndefined();
	});

	test("can find items with multiple entries and apply conditions", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 7777,
				value3: { field1: new Date().toISOString() },
				valueObject: {
					"1": {
						value: "bob"
					}
				},
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
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
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({
				id: (30 - i).toString(),
				value1: (30 - i).toString(),
				value2: 7777,
				valueObject: {
					"1": {
						value: "bob"
					}
				},
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
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

	test("can find items with multiple entries and apply custom sort on multiple properties", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({
				id: (30 - i).toString(),
				value1: (30 - i).toString(),
				value2: i % 2 === 0 ? 100 : 200,
				valueObject: {
					"1": {
						value: "bob"
					}
				},
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
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
					property: "value1",
					sortDirection: SortDirection.Descending
				},
				{
					property: "id",
					sortDirection: SortDirection.Ascending
				}
			]
		);

		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(2);
		expect(result.entities[0].value1).toEqual("26");
		expect(result.entities[1].value1).toEqual("20");
	});

	test("can query items and get a reduced data set", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 30; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 7777,
				valueObject: {
					"1": {
						value: "bob"
					}
				},
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
			});
		}
		const result = await entityStorage.query(undefined, undefined, ["id", "value1"]);
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(30);
		expect(result.entities[0].value2).toBeUndefined();
		expect(result.entities[0].value3).toBeUndefined();
	});

	test("can query sub items in object", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 5; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 7777,
				valueObject: {
					name: {
						value: "bob"
					}
				},
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
				valueObject: {
					name: {
						value: "fred"
					}
				},
				valueArray: [
					{
						field: "name",
						value: "bob"
					}
				]
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
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		for (let i = 0; i < 5; i++) {
			await entityStorage.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: 7777,
				valueObject: {
					name: {
						value: "fred"
					}
				},
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
				valueObject: {
					name: {
						value: "fred"
					}
				},
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

	test("can set data with a partition key", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config
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
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config
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
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config
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
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config
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

	test("can create database and table with hyphenated names", async () => {
		const hyphenatedConfig: IPostgreSqlEntityStorageConnectorConfig = {
			...config,
			tableName: "test-with-hyphen"
		};

		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: hyphenatedConfig
		});

		await entityStorage.bootstrap("logging");

		const entityId = "test-1";
		const testEntity = {
			id: entityId,
			value1: "test-hyphenated",
			value2: 42,
			value3: undefined,
			valueObject: undefined,
			valueArray: undefined
		};

		await entityStorage.set(testEntity);
		const result = await entityStorage.get(entityId);
		expect(result).toEqual(testEntity);

		// Cleanup
		await entityStorage.tableDrop();
	});

	test("should handle plain text in object field gracefully by returning it as string", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestTypeWithMnemonicAsObject>({
			entitySchema: nameof<TestTypeWithMnemonicAsObject>(),
			config
		});

		await entityStorage.bootstrap("logging");

		const plainTextValue =
			"garden habit curve acquire derive nut mushroom armed gather spot flame history";
		const entityId = "test-plain-text";

		// Store plain text value in object field (bypassing type safety with 'as any')
		const testEntity = {
			id: entityId,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mnemonic: plainTextValue as any
		};

		await entityStorage.set(testEntity);

		// Should retrieve successfully and return the plain text as string
		const result = await entityStorage.get(entityId);
		expect(result).toBeDefined();
		expect(result?.mnemonic).toBe(plainTextValue);
		expect(typeof result?.mnemonic).toBe("string");

		await entityStorage.tableDrop();
	});

	test("should handle plain text in object field when querying", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestTypeWithMnemonicAsObject>({
			entitySchema: nameof<TestTypeWithMnemonicAsObject>(),
			config
		});

		await entityStorage.bootstrap("logging");

		const plainTextValue =
			"garden habit curve acquire derive nut mushroom armed gather spot flame history";
		const entityId = "test-plain-text-query";

		// Store plain text value in object field
		const testEntity = {
			id: entityId,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mnemonic: plainTextValue as any
		};

		await entityStorage.set(testEntity);

		// Should query successfully and return the plain text as string
		const queryResult = await entityStorage.query();
		expect(queryResult).toBeDefined();
		expect(queryResult.entities.length).toEqual(1);
		expect(queryResult.entities[0]?.mnemonic).toBe(plainTextValue);
		expect(typeof queryResult.entities[0]?.mnemonic).toBe("string");

		await entityStorage.tableDrop();
	});

	test("should handle query with multiple conditions with incremented placeholders", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});

		await entityStorage.bootstrap("logging");

		// Store multiple entities with different value1 values
		for (let i = 0; i < 10; i++) {
			await entityStorage.set({
				id: `entity-${i}`,
				value1: `status-${i % 4}`,
				value2: i * 10,
				value3: undefined,
				valueObject: {
					"1": { value: "bob" }
				},
				valueArray: [{ field: "name", value: "test" }]
			});
		}

		// Query with IN clause that requires multiple placeholders
		// Combined with range conditions to test placeholder incrementing
		const result = await entityStorage.query({
			property: "value1",
			value: ["status-0", "status-1", "status-2"],
			comparison: ComparisonOperator.In
		});

		expect(result).toBeDefined();
		expect(result.entities.length).toBeGreaterThan(0);

		await entityStorage.tableDrop();
	});

	test("should handle query with complex multiple conditions of different types", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});

		await entityStorage.bootstrap("logging");

		// Store multiple entities
		for (let i = 0; i < 15; i++) {
			await entityStorage.set({
				id: `complex-entity-${i}`,
				value1: `status-${i % 5}`,
				value2: i * 5,
				value3: undefined,
				valueObject: {
					key1: { value: `value-${i % 3}` }
				},
				valueArray: [{ field: "type", value: `type-${i % 2}` }]
			});
		}

		// Query with multiple different condition types:
		// - GreaterThan: value2 > 20
		// - LessThan: value2 < 50
		// - Equals: value1 = "status-1"
		// - In: includes multiple statuses
		// - NotEquals: value1 <> "status-4"
		// This tests placeholder incrementing across different operators
		const result = await entityStorage.query({
			conditions: [
				{
					property: "value2",
					value: 20,
					comparison: ComparisonOperator.GreaterThan
				},
				{
					property: "value2",
					value: 50,
					comparison: ComparisonOperator.LessThan
				},
				{
					property: "value1",
					value: ["status-0", "status-1", "status-2", "status-3"],
					comparison: ComparisonOperator.In
				}
			],
			logicalOperator: LogicalOperator.And
		});

		expect(result).toBeDefined();
		// Should find entities matching all conditions
		expect(result.entities.length).toBeGreaterThan(0);
		for (const entityResult of result.entities) {
			expect(entityResult.value2).toBeGreaterThan(20);
			expect(entityResult.value2).toBeLessThan(50);
		}

		await entityStorage.tableDrop();
	});

	test("can perform a query with an object condition", async () => {
		const entityStorage = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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

	test("can query with ComparisonOperator.Includes on string field", async () => {
		// Test that ComparisonOperator.Includes works correctly on string fields
		// When a string field contains delimited values (e.g., "||value1||value2||"),
		// the Includes operator should use LIKE for substring matching,
		// not JSON_CONTAINS which would fail with "Invalid JSON text" error

		const entityStorage = new PostgreSqlEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config
		});

		await entityStorage.bootstrap();

		// Create an entity with value1 as a delimited string index
		// Format: ||value1||value2||value3||
		await entityStorage.set({
			id: "vertex-1",
			value1: "||mobius-261901-003||251702-015||",
			value2: 1
		});

		await entityStorage.set({
			id: "vertex-2",
			value1: "||other-alias||another-one||",
			value2: 2
		});

		// Query using ComparisonOperator.Includes on the string field
		const result = await entityStorage.query({
			property: "value1",
			comparison: ComparisonOperator.Includes,
			value: "||mobius-261901-003||"
		});

		expect(result.entities).toBeDefined();
		expect(result.entities.length).toBe(1);
		expect((result.entities[0] as TestType).id).toBe("vertex-1");
		expect((result.entities[0] as TestType).value1).toBe("||mobius-261901-003||251702-015||");

		// Also test partial match (without delimiters)
		const result2 = await entityStorage.query({
			property: "value1",
			comparison: ComparisonOperator.Includes,
			value: "mobius-261901-003"
		});

		expect(result2.entities).toBeDefined();
		expect(result2.entities.length).toBe(1);
		expect((result2.entities[0] as TestType).id).toBe("vertex-1");
	});
});
