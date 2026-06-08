// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	LogicalOperator,
	SortDirection,
	entity,
	property
} from "@twin.org/entity";
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";
import { TEST_MONGODB_CONFIG } from "./setupTestEnv.js";
import { MongoDbEntityStorageConnector } from "../src/mongoDbEntityStorageConnector.js";

// These tests are duplicated across all connectors. If you modify anything here make sure to
// apply the same change to all other connectors to keep them in sync.
// The createConnector factory is the only code that should differ between files.

// Does the connector support dot-notation property paths.
const SUPPORT_DOT_NOTATION = true;
// Does the connector support null/undefined comparisons.
const SUPPORT_NULL_UNDEFINED_COMPARISON = true;
// Does the connector support OR logical operators in conditions.
const SUPPORT_OR_CONDITIONS = true;
// Does the connector support NotEquals (!=) comparisons.
const SUPPORT_NOT_EQUALS = true;
// Does the connector support NotIncludes (NOT LIKE) comparisons.
const SUPPORT_NOT_INCLUDES = true;
// Does the connector support optional secondary index fields being null or undefined.
const SUPPORT_NULLABLE_SECONDARY_INDEX = true;

@entity()
class SubType {
	@property({ type: "string", format: "date-time" })
	public field1!: string;
}

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", isSecondary: true })
	public value1!: string;

	@property({ type: "number", format: "uint8" })
	public value2!: number;

	@property({ type: "object", itemTypeRef: "SubType", optional: true })
	public value3?: SubType;

	@property({ type: "object", optional: true })
	public valueObject?: {
		[id: string]: {
			value: string;
		};
	};

	@property({ type: "array", optional: true })
	public valueArray?: {
		field: string;
		value: string;
	}[];

	@property({ type: "boolean", optional: true })
	public isActive?: boolean;

	@property({ type: "integer", format: "int32", optional: true })
	public counter?: number;
}

@entity()
class ExpiryTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public status!: string;

	@property({ type: "number", optional: true })
	public expires?: number;
}

@entity()
class NestedSearchType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "object", optional: true })
	public consignor?: { name: string };

	@property({ type: "array", optional: true })
	public items?: { label: string }[];
}

@entity()
class NullableIndexType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", isSecondary: true, optional: true })
	public indexedField?: string;

	@property({ type: "string" })
	public otherField!: string;
}

let currentUser = "user";
let currentConnector: IEntityStorageConnector | undefined;

// Swap this factory to run these tests against a different connector implementation.
// It receives the entity schema name and optional partition context ids and must return
// a fresh, bootstrapped IEntityStorageConnector configured for those settings.
let createConnector: <T>(
	entitySchema: string,
	partitionContextIds?: string[]
) => Promise<IEntityStorageConnector<T>>;

describe("MongoDbEntityStorageConnector", () => {
	let tableCounter = 0;

	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<SubType>(), () => EntitySchemaHelper.getSchema(SubType));
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
		EntitySchemaFactory.register(nameof<ExpiryTestType>(), () =>
			EntitySchemaHelper.getSchema(ExpiryTestType)
		);
		EntitySchemaFactory.register(nameof<NestedSearchType>(), () =>
			EntitySchemaHelper.getSchema(NestedSearchType)
		);
		EntitySchemaFactory.register(nameof<NullableIndexType>(), () =>
			EntitySchemaHelper.getSchema(NullableIndexType)
		);

		createConnector = async <T>(entitySchema: string, partitionContextIds?: string[]) => {
			tableCounter++;
			currentConnector = new MongoDbEntityStorageConnector<T>({
				entitySchema,
				partitionContextIds,
				config: {
					...TEST_MONGODB_CONFIG,
					collection: `${TEST_MONGODB_CONFIG.collection}_${tableCounter}`
				}
			});
			await currentConnector?.bootstrap?.();
			return currentConnector as IEntityStorageConnector<T>;
		};

		ContextIdStore.getContextIds = vi
			.fn()
			.mockImplementation(() => ({ node: "node", tenant: "tenant", user: currentUser }));
	});

	afterEach(async () => {
		currentUser = "user";
		try {
			await currentConnector?.teardown?.();
		} catch {}
		try {
			await currentConnector?.stop?.();
		} catch {}
		currentConnector = undefined;
	});

	test("can fail to set an item with no entity", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await expect(connector.set(undefined as unknown as TestType)).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.objectUndefined",
			properties: { property: "entity", value: "undefined" }
		});
	});

	test("can set an item", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 35 });
		const item = await connector.get("1");
		expect(item).toBeDefined();
		expect(item?.id).toEqual("1");
		expect(item?.value1).toEqual("aaa");
		expect(item?.value2).toEqual(35);
	});

	test("can set an item with a condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set(
			{ id: "1", value1: "aaa", value2: 35, value3: { field1: new Date().toISOString() } },
			[{ property: "value1", value: "aaa" }]
		);
		const item = await connector.get("1");
		expect(item?.id).toEqual("1");
		expect(item?.value1).toEqual("aaa");
		expect(item?.value2).toEqual(35);
	});

	test("can set an item to update it", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 35 });
		await connector.set({ id: "1", value1: "aaa", value2: 99 });
		const item = await connector.get("1");
		expect(item?.value2).toEqual(99);
	});

	test("can set an item to update it with a matched condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 35 });
		await connector.set({ id: "1", value1: "aaa", value2: 99 }, [
			{ property: "value1", value: "aaa" }
		]);
		const item = await connector.get("1");
		expect(item?.value2).toEqual(99);
	});

	test("can fail to set an item to update it with an unmatched condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 35 });
		await connector.set({ id: "1", value1: "aaa", value2: 99 }, [
			{ property: "value1", value: "bbb" }
		]);
		const item = await connector.get("1");
		expect(item?.value2).toEqual(35);
	});

	test("can fail to set batch with no entities", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await expect(connector.setBatch(undefined as unknown as TestType[])).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.array",
			properties: { property: "entities", value: "undefined" }
		});
	});

	test("can set batch of items", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.setBatch([
			{ id: "1", value1: "aaa", value2: 10 },
			{ id: "2", value1: "bbb", value2: 20 },
			{ id: "3", value1: "ccc", value2: 30 }
		]);
		const item1 = await connector.get("1");
		expect(item1?.value1).toEqual("aaa");
		const item3 = await connector.get("3");
		expect(item3?.value2).toEqual(30);
		expect(await connector.count()).toEqual(3);
	});

	test("can set batch updating existing items", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 10 });
		await connector.setBatch([
			{ id: "1", value1: "aaa-updated", value2: 99 },
			{ id: "2", value1: "bbb", value2: 20 }
		]);
		const item1 = await connector.get("1");
		expect(item1?.value1).toEqual("aaa-updated");
		expect(item1?.value2).toEqual(99);
		expect(await connector.count()).toEqual(2);
	});

	test("can fail to get an item with no id", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await expect(connector.get(undefined as unknown as string)).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.string",
			properties: { property: "id", value: "undefined" }
		});
	});

	test("can not get an item", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 35 });
		const item = await connector.get("2");
		expect(item).toBeUndefined();
	});

	test("can get an item", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "2", value1: "vvv", value2: 35, value3: undefined });
		const item = await connector.get("2");
		expect(item).toBeDefined();
		expect(item?.id).toEqual("2");
		expect(item?.value1).toEqual("vvv");
		expect(item?.value2).toEqual(35);
		expect(item?.value3).toBeUndefined();
	});

	test("treats null and undefined optional property values the same", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 35, value3: null as unknown as SubType });
		await connector.set({ id: "2", value1: "bbb", value2: 35, value3: undefined });
		const item1 = await connector.get("1");
		const item2 = await connector.get("2");
		expect(item1?.value3).toBeUndefined();
		expect(item2?.value3).toBeUndefined();
	});

	test("treats null and undefined optional property values the same in setBatch", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.setBatch([
			{ id: "1", value1: "aaa", value2: 35, value3: null as unknown as SubType },
			{ id: "2", value1: "bbb", value2: 35, value3: undefined }
		]);
		const item1 = await connector.get("1");
		const item2 = await connector.get("2");
		expect(item1?.value3).toBeUndefined();
		expect(item2?.value3).toBeUndefined();
	});

	test("can get an item by secondary index", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "300", value1: "zzz", value2: 55 });
		const item = await connector.get("zzz", "value1");
		expect(item).toBeDefined();
		expect(item?.id).toEqual("300");
		expect(item?.value1).toEqual("zzz");
		expect(item?.value2).toEqual(55);
	});

	test("can get an item by secondary index with condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "300", value1: "zzz", value2: 55 });
		const item = await connector.get("zzz", "value1", [{ property: "value2", value: 55 }]);
		expect(item).toBeDefined();
		expect(item?.id).toEqual("300");
		expect(item?.value1).toEqual("zzz");
		expect(item?.value2).toEqual(55);
	});

	test("can fail to get an item by secondary index with unmatched condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "300", value1: "zzz", value2: 55 });
		const item = await connector.get("zzz", "value1", [{ property: "value2", value: 99 }]);
		expect(item).toBeUndefined();
	});

	test.skipIf(!SUPPORT_NULLABLE_SECONDARY_INDEX)(
		"can set and get an item when the secondary index field is null or undefined",
		async () => {
			const connector = await createConnector<NullableIndexType>(nameof<NullableIndexType>());
			await connector.set({ id: "1", indexedField: undefined, otherField: "test" });
			const item = await connector.get("1");
			expect(item?.id).toEqual("1");
			expect(item?.indexedField).toBeUndefined();
			expect(item?.otherField).toEqual("test");
		}
	);

	test("get does not return additional internal keys", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>(), [
			"node",
			"tenant",
			"user"
		]);
		await connector.set({ id: "1", value1: "aaa", value2: 35 });
		const item = await connector.get("1");
		expect(item).toBeDefined();
		const schema = EntitySchemaFactory.get(nameof<TestType>());
		const allowedKeys = new Set<string>(schema.properties?.map(p => p.property) ?? []);
		const unexpectedKeys = Object.keys(item ?? {}).filter(k => !allowedKeys.has(k));
		expect(unexpectedKeys).toEqual([]);
	});

	test("can fail to get an item with unmatched condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 99 });
		const item = await connector.get("1", undefined, [{ property: "value1", value: "bbb" }]);
		expect(item).toBeUndefined();
	});

	test("can get an item with condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 99 });
		const item = await connector.get("1", undefined, [{ property: "value1", value: "aaa" }]);
		expect(item).toBeDefined();
		expect(item?.id).toEqual("1");
		expect(item?.value1).toEqual("aaa");
		expect(item?.value2).toEqual(99);
	});

	test("can fail to remove an item with no id", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await expect(connector.remove(undefined as unknown as string)).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.string",
			properties: { property: "id", value: "undefined" }
		});
	});

	test("can not remove an item", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 5555 });
		await connector.remove("99999");
		expect(await connector.count()).toEqual(1);
	});

	test("can remove an item", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 99 });
		await connector.remove("1");
		expect(await connector.get("1")).toBeUndefined();
	});

	test("can fail to remove an item with condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 99 });
		await connector.remove("1", [{ property: "value1", value: "aaa1" }]);
		expect(await connector.get("1")).toBeDefined();
	});

	test("can remove an item with condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 99 });
		await connector.remove("1", [{ property: "value1", value: "aaa" }]);
		expect(await connector.get("1")).toBeUndefined();
	});

	test("can fail to remove batch with no ids", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await expect(connector.removeBatch(undefined as unknown as string[])).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.array",
			properties: { property: "ids", value: "undefined" }
		});
	});

	test("can remove batch of items", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 35 });
		await connector.set({ id: "2", value1: "bbb", value2: 36 });
		await connector.set({ id: "3", value1: "ccc", value2: 37 });
		await connector.removeBatch(["1", "2"]);
		expect(await connector.count()).toEqual(1);
		expect(await connector.get("3")).toBeDefined();
	});

	test("can query with empty store", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		const result = await connector.query();
		expect(result.entities.length).toEqual(0);
		expect(result.cursor).toBeUndefined();
	});

	test("can query with single entry", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 95 });
		const result = await connector.query();
		expect(result.entities.length).toEqual(1);
		expect(result.cursor).toBeUndefined();
	});

	test("can query with single entry and explicit page limit", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 95 });
		const result = await connector.query(undefined, undefined, undefined, undefined, 1);
		expect(result.entities.length).toEqual(1);
		expect(result.cursor).toBeUndefined();
	});

	test("query does not return additional internal keys", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>(), [
			"node",
			"tenant",
			"user"
		]);
		await connector.set({ id: "1", value1: "aaa", value2: 35 });
		const result = await connector.query();
		expect(result.entities.length).toEqual(1);
		const schema = EntitySchemaFactory.get(nameof<TestType>());
		const allowedKeys = new Set<string>(schema.properties?.map(p => p.property) ?? []);
		const unexpectedKeys = Object.keys(result.entities[0]).filter(k => !allowedKeys.has(k));
		expect(unexpectedKeys).toEqual([]);
	});

	test("can query with multiple entries returning first page", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 25; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i });
		}
		const result = await connector.query(undefined, undefined, undefined, undefined, 10);
		expect(result.entities.length).toEqual(10);
		expect(result.cursor).toBeDefined();
	});

	test("can query with multiple entries and cursor", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 15; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i });
		}
		const result = await connector.query(undefined, undefined, undefined, undefined, 10);
		const result2 = await connector.query(undefined, undefined, undefined, result.cursor, 10);
		expect(result2.entities.length).toEqual(5);
		expect(result2.cursor).toBeUndefined();
	});

	test("can query with Equals condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 20; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i });
		}
		const result = await connector.query({
			property: "id",
			value: "10",
			comparison: ComparisonOperator.Equals
		});
		expect(result.entities.length).toEqual(1);
		expect(result.cursor).toBeUndefined();
	});

	test.skipIf(!SUPPORT_NOT_EQUALS)("can query with NotEquals condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({
				id: (i + 1).toString(),
				value1: i % 2 === 0 ? "even" : "odd",
				value2: i
			});
		}
		const result = await connector.query({
			property: "value1",
			value: "odd",
			comparison: ComparisonOperator.NotEquals
		});
		expect(result.entities.length).toEqual(3);
		expect(result.entities.every((e: Partial<TestType>) => e.value1 === "even")).toBe(true);
	});

	test("can query with GreaterThan condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i * 10 });
		}
		const result = await connector.query({
			property: "value2",
			value: 20,
			comparison: ComparisonOperator.GreaterThan
		});
		expect(result.entities.length).toEqual(2);
		expect(result.entities.every((e: Partial<TestType>) => (e.value2 ?? 0) > 20)).toBe(true);
	});

	test("can query with LessThan condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i * 10 });
		}
		const result = await connector.query({
			property: "value2",
			value: 20,
			comparison: ComparisonOperator.LessThan
		});
		expect(result.entities.length).toEqual(2);
		expect(result.entities.every((e: Partial<TestType>) => (e.value2 ?? 0) < 20)).toBe(true);
	});

	test("can query with GreaterThanOrEqual condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i * 10 });
		}
		const result = await connector.query({
			property: "value2",
			value: 20,
			comparison: ComparisonOperator.GreaterThanOrEqual
		});
		expect(result.entities.length).toEqual(3);
		expect(result.entities.every((e: Partial<TestType>) => (e.value2 ?? 0) >= 20)).toBe(true);
	});

	test("can query with LessThanOrEqual condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i * 10 });
		}
		const result = await connector.query({
			property: "value2",
			value: 20,
			comparison: ComparisonOperator.LessThanOrEqual
		});
		expect(result.entities.length).toEqual(3);
		expect(result.entities.every((e: Partial<TestType>) => (e.value2 ?? 0) <= 20)).toBe(true);
	});

	test("can query with In operator", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 10; i++) {
			await connector.set({ id: (i + 1).toString(), value1: (i + 1).toString(), value2: i });
		}
		const result = await connector.query(
			{
				conditions: [
					{
						property: "value1",
						value: ["3", "7"],
						comparison: ComparisonOperator.In
					}
				]
			},
			[{ property: "id", sortDirection: SortDirection.Ascending }]
		);
		expect(result.entities.length).toEqual(2);
		expect((result.entities[0] as TestType).value1).toEqual("3");
		expect((result.entities[1] as TestType).value1).toEqual("7");
	});

	test("can query with empty In list returns no results without error", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i });
		}
		const result = await connector.query({
			conditions: [
				{
					property: "id",
					value: [],
					comparison: ComparisonOperator.In
				}
			]
		});
		expect(result.entities.length).toEqual(0);
		expect(result.cursor).toBeUndefined();
	});

	test.skipIf(!SUPPORT_OR_CONDITIONS)(
		"can query with empty In list in OR condition returns other matching entities",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			for (let i = 0; i < 5; i++) {
				await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i });
			}
			const result = await connector.query({
				conditions: [
					{ property: "id", value: "1", comparison: ComparisonOperator.Equals },
					{ property: "id", value: [], comparison: ComparisonOperator.In }
				],
				logicalOperator: LogicalOperator.Or
			});
			expect(result.entities.length).toEqual(1);
			expect((result.entities[0] as TestType).id).toEqual("1");
		}
	);

	test.skipIf(!SUPPORT_OR_CONDITIONS)(
		"can query with all empty In lists in OR condition returns no results",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			for (let i = 0; i < 5; i++) {
				await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i });
			}
			const result = await connector.query({
				conditions: [
					{ property: "id", value: [], comparison: ComparisonOperator.In },
					{ property: "value1", value: [], comparison: ComparisonOperator.In }
				],
				logicalOperator: LogicalOperator.Or
			});
			expect(result.entities.length).toEqual(0);
			expect(result.cursor).toBeUndefined();
		}
	);

	test.skipIf(!SUPPORT_OR_CONDITIONS)(
		"can query with empty In list in nested AND inside OR returns only matching OR branch",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			for (let i = 0; i < 5; i++) {
				await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i });
			}
			// (id IN [] AND value1=="aaa") OR id=="999"
			// The AND branch is dead — In [] is always false.
			// No entity has id=="999", so the result must be empty.
			// Without the fix, the dead AND branch incorrectly promotes value1=="aaa"
			// into the OR and returns 5 rows (#141).
			const result = await connector.query({
				logicalOperator: LogicalOperator.Or,
				conditions: [
					{
						logicalOperator: LogicalOperator.And,
						conditions: [
							{ property: "id", value: [], comparison: ComparisonOperator.In },
							{ property: "value1", value: "aaa", comparison: ComparisonOperator.Equals }
						]
					},
					{ property: "id", value: "999", comparison: ComparisonOperator.Equals }
				]
			});
			expect(result.entities.length).toEqual(0);
			expect(result.cursor).toBeUndefined();
		}
	);

	test("can query with multiple AND conditions", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({
				id: (i + 1).toString(),
				value1: i % 2 === 0 ? "even" : "odd",
				value2: i * 10
			});
		}
		const result = await connector.query({
			conditions: [
				{ property: "value1", value: "even", comparison: ComparisonOperator.Equals },
				{ property: "value2", value: 10, comparison: ComparisonOperator.GreaterThan }
			],
			logicalOperator: LogicalOperator.And
		});
		expect(result.entities.length).toEqual(2);
		expect(result.entities.every((e: Partial<TestType>) => e.value1 === "even")).toBe(true);
		expect(result.entities.every((e: Partial<TestType>) => (e.value2 ?? 0) > 10)).toBe(true);
	});

	test.skipIf(!SUPPORT_OR_CONDITIONS)("can query with multiple OR conditions", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (i + 1).toString(), value1: (i + 1).toString(), value2: i });
		}
		const result = await connector.query({
			conditions: [
				{ property: "id", value: "1", comparison: ComparisonOperator.Equals },
				{ property: "id", value: "3", comparison: ComparisonOperator.Equals }
			],
			logicalOperator: LogicalOperator.Or
		});
		expect(result.entities.length).toEqual(2);
		expect(result.entities.map((e: Partial<TestType>) => e.id)).toEqual(
			expect.arrayContaining(["1", "3"])
		);
	});

	test("can query with custom sort", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (5 - i).toString(), value1: (5 - i).toString(), value2: i });
		}
		const result = await connector.query(undefined, [
			{ property: "id", sortDirection: SortDirection.Ascending }
		]);
		expect(result.entities.length).toEqual(5);
		expect((result.entities[0] as TestType).id).toEqual("1");
		expect((result.entities[4] as TestType).id).toEqual("5");
	});

	test("can query with descending sort", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (i + 1).toString(), value1: (i + 1).toString(), value2: i });
		}
		const result = await connector.query(undefined, [
			{ property: "id", sortDirection: SortDirection.Descending }
		]);
		expect(result.entities.length).toEqual(5);
		expect((result.entities[0] as TestType).id).toEqual("5");
		expect((result.entities[4] as TestType).id).toEqual("1");
	});

	test("can query with property projection", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i });
		}
		const result = await connector.query(undefined, undefined, ["id", "value1"]);
		expect(result.entities.length).toEqual(5);
		expect(result.entities[0].id).toBeDefined();
		expect(result.entities[0].value1).toBeDefined();
		expect(result.entities[0].value2).toBeUndefined();
	});

	test("can query with object condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({
			id: "1",
			value1: "aaa",
			value2: 7777,
			value3: { field1: "2024-01-01T00:00:00.000Z" }
		});
		const result = await connector.query({
			conditions: [
				{
					property: "value3",
					value: { field1: "2024-01-01T00:00:00.000Z" },
					comparison: ComparisonOperator.Equals
				}
			]
		});
		expect(result.entities.length).toEqual(1);
		expect((result.entities[0] as TestType).value3).toEqual({ field1: "2024-01-01T00:00:00.000Z" });
	});

	test("can query with Includes on string field", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "hello world", value2: 1 });
		await connector.set({ id: "2", value1: "worldwide", value2: 2 });
		await connector.set({ id: "3", value1: "foo bar", value2: 3 });
		const result = await connector.query({
			conditions: [{ property: "value1", value: "world", comparison: ComparisonOperator.Includes }]
		});
		expect(result.entities.length).toEqual(2);
		expect(result.entities.map(e => (e as TestType).value1)).toEqual(
			expect.arrayContaining(["hello world", "worldwide"])
		);
	});

	test.skipIf(!SUPPORT_NOT_INCLUDES)("can query with NotIncludes on string field", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "hello world", value2: 1 });
		await connector.set({ id: "2", value1: "worldwide", value2: 2 });
		await connector.set({ id: "3", value1: "foo bar", value2: 3 });
		const result = await connector.query({
			conditions: [
				{ property: "value1", value: "world", comparison: ComparisonOperator.NotIncludes }
			]
		});
		expect(result.entities.length).toEqual(1);
		expect((result.entities[0] as TestType).value1).toEqual("foo bar");
	});

	test.skipIf(!SUPPORT_DOT_NOTATION)(
		"can query with Includes on nested object property (dot-notation)",
		async () => {
			const connector = await createConnector<NestedSearchType>(nameof<NestedSearchType>());
			await connector.set({ id: "1", consignor: { name: "alice smith" } });
			await connector.set({ id: "2", consignor: { name: "bob jones" } });
			await connector.set({ id: "3", consignor: { name: "alice cooper" } });
			const result = await connector.query({
				conditions: [
					{ property: "consignor.name", value: "alice", comparison: ComparisonOperator.Includes }
				]
			});
			expect(result.entities.map(e => (e as NestedSearchType).id).sort()).toEqual(["1", "3"]);
		}
	);

	test.skipIf(!SUPPORT_DOT_NOTATION)(
		"can query with NotEquals on nested object property (dot-notation)",
		async () => {
			const connector = await createConnector<NestedSearchType>(nameof<NestedSearchType>());
			await connector.set({ id: "1", consignor: { name: "Alice" } });
			await connector.set({ id: "2", consignor: { name: "Bob" } });
			await connector.set({ id: "3", consignor: { name: "Charlie" } });
			const result = await connector.query({
				conditions: [
					{
						property: "consignor.name",
						value: "Alice",
						comparison: ComparisonOperator.NotEquals
					}
				]
			});
			expect(result.entities.map(e => (e as NestedSearchType).id).sort()).toEqual(["2", "3"]);
		}
	);

	test("can query sub items in array", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: i,
				valueArray: [{ field: "name", value: "bob" }]
			});
		}
		for (let i = 0; i < 5; i++) {
			await connector.set({
				id: (i + 10).toString(),
				value1: "aaa",
				value2: i,
				valueArray: [{ field: "name", value: "fred" }]
			});
		}
		const result = await connector.query({
			conditions: [
				{
					property: "valueArray",
					value: { field: "name", value: "bob" },
					comparison: ComparisonOperator.Includes
				}
			]
		});
		expect(result.entities.length).toEqual(5);
	});

	test.skipIf(!SUPPORT_DOT_NOTATION)("can query sub items in object", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({
				id: (i + 1).toString(),
				value1: "aaa",
				value2: i,
				valueObject: { name: { value: "bob" } }
			});
		}
		for (let i = 0; i < 5; i++) {
			await connector.set({
				id: (i + 10).toString(),
				value1: "aaa",
				value2: i,
				valueObject: { name: { value: "fred" } }
			});
		}
		const result = await connector.query({
			conditions: [
				{
					property: "valueObject.name.value",
					value: "bob",
					comparison: ComparisonOperator.Equals
				}
			]
		});
		expect(result.entities.length).toEqual(5);
	});

	test.skipIf(!SUPPORT_NULL_UNDEFINED_COMPARISON)(
		"can query with undefined value comparison",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.set({
				id: "1",
				value1: "aaa",
				value2: 100,
				value3: { field1: new Date().toISOString() }
			});
			await connector.set({ id: "2", value1: "bbb", value2: 200 });
			const result = await connector.query({
				property: "value3",
				value: undefined,
				comparison: ComparisonOperator.Equals
			});
			expect(result.entities.length).toEqual(1);
			expect((result.entities[0] as TestType).id).toEqual("2");
		}
	);

	test.skipIf(!SUPPORT_NULL_UNDEFINED_COMPARISON)(
		"can query with null value comparison",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.set({
				id: "1",
				value1: "aaa",
				value2: 100,
				value3: { field1: new Date().toISOString() }
			});
			await connector.set({ id: "2", value1: "bbb", value2: 200 });
			const result = await connector.query({
				property: "value3",
				value: null,
				comparison: ComparisonOperator.NotEquals
			});
			expect(result.entities.length).toEqual(1);
			expect((result.entities[0] as TestType).id).toEqual("1");
			expect((result.entities[0] as TestType).value3).toBeDefined();
		}
	);

	test.skipIf(!SUPPORT_NULL_UNDEFINED_COMPARISON)(
		"can query with undefined value comparison using NotEquals",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.set({
				id: "1",
				value1: "aaa",
				value2: 100,
				value3: { field1: new Date().toISOString() }
			});
			await connector.set({ id: "2", value1: "bbb", value2: 200 });
			const result = await connector.query({
				property: "value3",
				value: undefined,
				comparison: ComparisonOperator.NotEquals
			});
			expect(result.entities.length).toEqual(1);
			expect((result.entities[0] as TestType).id).toEqual("1");
			expect((result.entities[0] as TestType).value3).toBeDefined();
		}
	);

	test.skipIf(!SUPPORT_NULL_UNDEFINED_COMPARISON)(
		"can query with null value comparison using Equals",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.set({
				id: "1",
				value1: "aaa",
				value2: 100,
				value3: { field1: new Date().toISOString() }
			});
			await connector.set({ id: "2", value1: "bbb", value2: 200 });
			const result = await connector.query({
				property: "value3",
				value: null,
				comparison: ComparisonOperator.Equals
			});
			expect(result.entities.length).toEqual(1);
			expect((result.entities[0] as TestType).id).toEqual("2");
		}
	);

	test.skipIf(!SUPPORT_NULL_UNDEFINED_COMPARISON)(
		"can query with NotEquals and undefined on optional number field",
		async () => {
			const connector = await createConnector<ExpiryTestType>(nameof<ExpiryTestType>());
			await connector.set({ id: "1", status: "pending" });
			await connector.set({ id: "2", status: "active", expires: 1_000 });
			const result = await connector.query({
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
		}
	);

	test.skipIf(!SUPPORT_NULL_UNDEFINED_COMPARISON)(
		"can query with NotEquals and null on optional number field",
		async () => {
			const connector = await createConnector<ExpiryTestType>(nameof<ExpiryTestType>());
			await connector.set({ id: "1", status: "active", expires: 0 });
			await connector.set({ id: "2", status: "pending" });
			await connector.set({ id: "3", status: "active", expires: 1_000 });
			const result = await connector.query({
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
		}
	);

	test("can set and get item with boolean property", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 10, isActive: true });
		await connector.set({ id: "2", value1: "bbb", value2: 20, isActive: false });
		const item1 = await connector.get("1");
		const item2 = await connector.get("2");
		expect(item1?.isActive).toBe(true);
		expect(item2?.isActive).toBe(false);
	});

	test("can query by boolean property", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 10, isActive: true });
		await connector.set({ id: "2", value1: "bbb", value2: 20, isActive: false });
		await connector.set({ id: "3", value1: "ccc", value2: 30, isActive: true });
		const result = await connector.query({
			property: "isActive",
			value: true,
			comparison: ComparisonOperator.Equals
		});
		expect(result.entities.length).toEqual(2);
		expect(result.entities.every((e: Partial<TestType>) => e.isActive === true)).toBe(true);
	});

	test("can set and get item with integer property", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 10, counter: 42 });
		const item = await connector.get("1");
		expect(item?.counter).toEqual(42);
	});

	test("can query by integer property", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i, counter: i * 100 });
		}
		const result = await connector.query({
			property: "counter",
			value: 200,
			comparison: ComparisonOperator.GreaterThan
		});
		expect(result.entities.length).toEqual(2);
		expect(result.entities.every((e: Partial<TestType>) => (e.counter ?? 0) > 200)).toBe(true);
	});

	test("can set data with a partition key", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>(), [
			"node",
			"tenant",
			"user"
		]);
		currentUser = "user1";
		await connector.set({ id: "1", value1: "aaa", value2: 7777 }, undefined);
		currentUser = "user2";
		await connector.set({ id: "1", value1: "bbb", value2: 8888 }, undefined);
		currentUser = "user1";
		const item = await connector.get("1");
		expect(item).toMatchObject({ id: "1", value1: "aaa", value2: 7777 });
	});

	test("can get data with a partition key", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>(), [
			"node",
			"tenant",
			"user"
		]);
		currentUser = "user1";
		await connector.set({ id: "1", value1: "aaa", value2: 7777 }, undefined);
		currentUser = "user2";
		await connector.set({ id: "1", value1: "bbb", value2: 8888 }, undefined);
		currentUser = "user1";
		const item1 = await connector.get("1");
		expect(item1).toMatchObject({ id: "1", value1: "aaa", value2: 7777 });
		currentUser = "user2";
		const item2 = await connector.get("1");
		expect(item2).toMatchObject({ id: "1", value1: "bbb", value2: 8888 });
	});

	test("can remove data with a partition key", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>(), [
			"node",
			"tenant",
			"user"
		]);
		currentUser = "user1";
		await connector.set({ id: "1", value1: "aaa", value2: 7777 }, undefined);
		currentUser = "user2";
		await connector.set({ id: "1", value1: "bbb", value2: 8888 }, undefined);
		currentUser = "user1";
		await connector.remove("1");
		expect((await connector.query()).entities).toEqual([]);
		currentUser = "user2";
		const result = await connector.query();
		expect(result.entities.length).toEqual(1);
		expect((result.entities[0] as TestType).value1).toEqual("bbb");
	});

	test("can query with a partition key", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>(), [
			"node",
			"tenant",
			"user"
		]);
		currentUser = "user1";
		await connector.set({ id: "1", value1: "aaa", value2: 7777 }, undefined);
		currentUser = "user2";
		await connector.set({ id: "1", value1: "bbb", value2: 8888 }, undefined);
		currentUser = "user1";
		const result = await connector.query();
		expect(result.entities.length).toEqual(1);
		expect((result.entities[0] as TestType).value1).toEqual("aaa");
	});

	describe("count", () => {
		test("can count items", async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.set({ id: "1", value1: "aaa", value2: 35 });
			await connector.set({ id: "2", value1: "bbb", value2: 36 });
			await connector.set({ id: "3", value1: "ccc", value2: 37 });
			expect(await connector.count()).toEqual(3);
		});

		test("can count items with a partition key", async () => {
			const connector = await createConnector<TestType>(nameof<TestType>(), [
				"node",
				"tenant",
				"user"
			]);
			currentUser = "user1";
			await connector.set({ id: "1", value1: "aaa", value2: 35 });
			await connector.set({ id: "2", value1: "bbb", value2: 36 });
			currentUser = "user2";
			await connector.set({ id: "3", value1: "ccc", value2: 37 });
			currentUser = "user1";
			expect(await connector.count()).toEqual(2);
		});

		test("can count items with a condition and a partition key", async () => {
			const connector = await createConnector<TestType>(nameof<TestType>(), [
				"node",
				"tenant",
				"user"
			]);
			currentUser = "user1";
			await connector.set({ id: "1", value1: "aaa", value2: 35 });
			await connector.set({ id: "2", value1: "bbb", value2: 36 });
			await connector.set({ id: "3", value1: "aaa", value2: 37 });
			currentUser = "user2";
			await connector.set({ id: "4", value1: "aaa", value2: 38 });
			currentUser = "user1";
			expect(
				await connector.count({
					conditions: [{ property: "value1", comparison: ComparisonOperator.Equals, value: "aaa" }],
					logicalOperator: LogicalOperator.And
				})
			).toEqual(2);
		});

		test("can count items with a condition", async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.set({ id: "1", value1: "aaa", value2: 35 });
			await connector.set({ id: "2", value1: "bbb", value2: 36 });
			await connector.set({ id: "3", value1: "ccc", value2: 37 });
			expect(
				await connector.count({
					conditions: [{ property: "value1", comparison: ComparisonOperator.Equals, value: "aaa" }],
					logicalOperator: LogicalOperator.And
				})
			).toEqual(1);
		});

		test("can count items with an unmatched condition", async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.set({ id: "1", value1: "aaa", value2: 35 });
			await connector.set({ id: "2", value1: "bbb", value2: 36 });
			await connector.set({ id: "3", value1: "ccc", value2: 37 });
			expect(
				await connector.count({
					conditions: [{ property: "value1", comparison: ComparisonOperator.Equals, value: "zzz" }],
					logicalOperator: LogicalOperator.And
				})
			).toEqual(0);
		});

		test("can count more items than the default page limit", async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.setBatch(
				Array.from({ length: 45 }, (element, i) => ({
					id: String(i + 1),
					value1: i < 20 ? "aaa" : "bbb",
					value2: i + 1
				}))
			);
			expect(await connector.count()).toEqual(45);
		});

		test("can count more items than the default page limit with a condition", async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.setBatch(
				Array.from({ length: 45 }, (element, i) => ({
					id: String(i + 1),
					value1: i < 20 ? "aaa" : "bbb",
					value2: i + 1
				}))
			);
			expect(
				await connector.count({
					conditions: [{ property: "value1", comparison: ComparisonOperator.Equals, value: "aaa" }],
					logicalOperator: LogicalOperator.And
				})
			).toEqual(20);
		});
	});

	test("can empty with no items", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.empty();
		expect(await connector.count()).toEqual(0);
	});

	test("can empty the store", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 35 });
		await connector.set({ id: "2", value1: "bbb", value2: 36 });
		await connector.set({ id: "3", value1: "ccc", value2: 37 });
		await connector.empty();
		expect(await connector.count()).toEqual(0);
	});

	test("can teardown the store", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 35 });
		await connector.set({ id: "2", value1: "bbb", value2: 36 });
		await connector?.teardown?.();
		await connector?.bootstrap?.();
		expect(await connector.count()).toEqual(0);
	});
});
