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
import { TEST_COSMOS_CONFIG } from "./setupTestEnv.js";
import { CosmosDbEntityStorageConnector } from "../src/cosmosDbEntityStorageConnector.js";
import type { ICosmosDbEntityStorageConnectorConfig } from "../src/models/ICosmosDbEntityStorageConnectorConfig.js";

/**
 * Clears all items from the Cosmos DB container used for testing.
 * @param entityStorage The CosmosDbEntityStorageConnector instance to use for clearing the container.
 */
async function clearContainerItems<TEntity extends { id: string }>(
	entityStorage: CosmosDbEntityStorageConnector<TEntity>
): Promise<void> {
	const internalConnector = entityStorage as unknown as {
		_container: {
			items: {
				query: <T>(query: string) => {
					fetchAll: () => Promise<{ resources: T[] }>;
				};
			};
			item: (
				id: string,
				partitionKey: string
			) => {
				delete: () => Promise<void>;
			};
		};
	};

	const { resources } = await internalConnector._container.items
		.query<{ id: string; partitionId: string }>("SELECT c.id, c.partitionId FROM c")
		.fetchAll();

	for (const resource of resources) {
		await internalConnector._container.item(resource.id, resource.partitionId).delete();
	}
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

let currentUser = "user";

let memoryEntityStorage: MemoryEntityStorageConnector<LogEntry>;
const config: ICosmosDbEntityStorageConnectorConfig = {
	...TEST_COSMOS_CONFIG,
	containerId: `${TEST_COSMOS_CONFIG.containerId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
};
const nestedConfig: ICosmosDbEntityStorageConnectorConfig = {
	...TEST_COSMOS_CONFIG,
	containerId: `${TEST_COSMOS_CONFIG.containerId}-nested-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
};

describe("CosmosDbEntityStorageConnector", () => {
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

	beforeEach(async () => {
		currentUser = "user";
		memoryEntityStorage = new MemoryEntityStorageConnector<LogEntry>({
			entitySchema: nameof<LogEntry>()
		});
		EntityStorageConnectorFactory.register("log-entry", () => memoryEntityStorage);
		LoggingConnectorFactory.register("logging", () => new EntityStorageLoggingConnector());
		ComponentFactory.register("logging", () => new LoggingService());
	});

	afterEach(async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});

		try {
			await entityStorage.bootstrap("logging");
			await clearContainerItems(entityStorage);
		} catch {}
	});

	afterEach(async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<NestedSearchType>({
			entitySchema: nameof<NestedSearchType>(),
			config: nestedConfig
		});
		try {
			await entityStorage.bootstrap("logging");
			await clearContainerItems(entityStorage);
		} catch {}
	});

	afterAll(async () => {
		const entityStorage = new CosmosDbEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.containerDelete();
	});

	test("can fail to construct when there are no options", async () => {
		expect(
			() =>
				new CosmosDbEntityStorageConnector(
					undefined as unknown as {
						entitySchema: string;
						config: ICosmosDbEntityStorageConnectorConfig;
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
				new CosmosDbEntityStorageConnector(
					{} as unknown as {
						entitySchema: string;
						config: ICosmosDbEntityStorageConnectorConfig;
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
		const entityStorage = new CosmosDbEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const logs = memoryEntityStorage.getStore();
		expect(logs?.find(l => l.level === "error")).toBeUndefined();
	});

	test("can fail to set an item with no entity", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		expect(result).toEqual(objectSet);
	});

	test("can set an item to update it", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		expect(result).toEqual(objectSet);
	});

	test("can set an item to update it with a condition", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		await entityStorage.set(objectUpdate, [{ property: "value1", value: "aaa" }]);

		const result = await entityStorage.get(entityId);
		expect(result).toEqual(objectUpdate);
	});

	test("can fail set an item to update it with an unmatched condition", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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

		// Should still have original value set
		const result = await entityStorage.get(entityId);
		expect(result).toEqual(objectSet);
	});

	test("can fail to get an item with no id", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const item = await entityStorage.get("20000");

		expect(item).toBeUndefined();
	});

	test("can get an item", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const object = { id: "2", value1: "vvv", value2: 35, value3: undefined };
		await entityStorage.set(object);
		const item = await entityStorage.get("2");

		expect(item).toBeDefined();
		expect(item).toEqual(object);
	});

	test("can get an item by secondary index", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});

		await entityStorage.bootstrap("logging");
		const secondaryValue = "zzz";
		const object = { id: "300", value1: secondaryValue, value2: 55, value3: undefined };
		await entityStorage.set(object);
		const item = await entityStorage.get(secondaryValue, "value1");

		expect(item).toBeDefined();
		expect(item).toEqual(object);
	});

	test("can fail to remove an item with no id", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");

		await entityStorage.set({ id: "10001", value1: "aaa", value2: 5555, value3: undefined });

		const idToRemove = "1000999";
		await entityStorage.remove(idToRemove);
		// No exception should be thrown
	});

	test("can remove an item", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const idToRemove = "65432";
		await entityStorage.set({ id: idToRemove, value1: "aaa", value2: 99, value3: undefined });
		await entityStorage.remove(idToRemove);

		const result = await entityStorage.get(idToRemove);
		expect(result).toBeUndefined();
	});

	test("can fail to remove an item with conditions", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});

		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: 99, value3: undefined });
		await entityStorage.remove("1", [{ property: "value1", value: "aaa1" }]);

		const result = await entityStorage.get("1");
		expect(result).toBeDefined();
	});

	test("can remove an item with conditions", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});

		await entityStorage.bootstrap("logging");
		await entityStorage.set({ id: "1", value1: "aaa", value2: 99, value3: undefined });
		await entityStorage.remove("1", [{ property: "value1", value: "aaa" }]);

		const result = await entityStorage.get("1");
		expect(result).toBeUndefined();
	});

	test("can find items with empty store", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
		});
		await entityStorage.bootstrap("logging");
		const entry = { id: "1", value1: "aaa", value2: 95, value3: undefined };
		await entityStorage.set(entry);
		const result = await entityStorage.query();
		expect(result).toBeDefined();
		expect(result.entities.length).toEqual(1);
		expect(result.entities[0]).toEqual(entry);
		expect(result.cursor).toBeUndefined();
	});

	test("can find items with multiple entries", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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

	test("can set data with a partition key", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node", "tenant", "user"],
			config
		});

		currentUser = "user";

		await entityStorage.bootstrap("logging");
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
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
				value1: "bbb",
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
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
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

	test("can perform a query with an object condition", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
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

	test("can query items with Includes on string field", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config
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

	test("can query with ComparisonOperator.Includes on nested object property (dot-notation)", async () => {
		const entityStorage = new CosmosDbEntityStorageConnector<NestedSearchType>({
			entitySchema: nameof<NestedSearchType>(),
			config: nestedConfig
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
		const entityStorage = new CosmosDbEntityStorageConnector<NestedSearchType>({
			entitySchema: nameof<NestedSearchType>(),
			config: nestedConfig
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
		const entityStorage = new CosmosDbEntityStorageConnector<NestedSearchType>({
			entitySchema: nameof<NestedSearchType>(),
			config: nestedConfig
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
		const entityStorage = new CosmosDbEntityStorageConnector<ExpiryTestType>({
			entitySchema: nameof<ExpiryTestType>(),
			config
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
		const entityStorage = new CosmosDbEntityStorageConnector<ExpiryTestType>({
			entitySchema: nameof<ExpiryTestType>(),
			config
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
