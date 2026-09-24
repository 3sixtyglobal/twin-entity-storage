// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import { Is, RandomHelper } from "@twin.org/core";
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
import { TEST_SCYLLA_CONFIG } from "./setupTestEnv.js";
import { ScyllaDBTableConnector } from "../src/scyllaDBTableConnector.js";

// These tests are duplicated across all connectors. If you modify anything here make sure to
// apply the same change to all other connectors to keep them in sync.
// The createConnector factory is the only code that should differ between files.

// Does the connector support dot-notation property paths.
const SUPPORT_DOT_NOTATION = false;
// Does the connector support null/undefined comparisons.
const SUPPORT_NULL_UNDEFINED_COMPARISON = true;
// Does the connector support OR logical operators in conditions.
const SUPPORT_OR_CONDITIONS = false;
// Does the connector support NotEquals (!=) comparisons.
const SUPPORT_NOT_EQUALS = true;
// Does the connector support NotIncludes (NOT LIKE) comparisons.
const SUPPORT_NOT_INCLUDES = false;
// Does the connector support optional secondary index fields (clustering keys) being null.
const SUPPORT_NULLABLE_SECONDARY_INDEX = false;
// Does the connector support sorting by secondary index properties.
const SUPPORT_SECONDARY_INDEX_SORT = false;
// Does the connector support sorting by a nullable property.
const SUPPORT_NULLABLE_SORT_PROPERTY = false;
// Does the connector honour trailing tiebreaker sort properties within ties of the
// first sort property.
const SUPPORT_MULTI_SORT_TIEBREAKER_ORDER = false;
// Does the connector support sorting on more than one non primary-key property.
const SUPPORT_MULTI_SORT_ARBITRARY = false;

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

	@property({ type: "string", optional: true })
	public role?: string;

	@property({ type: "string", isSecondary: SUPPORT_NULLABLE_SECONDARY_INDEX, optional: true })
	public value4?: string;
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

@entity()
class ScalarArrayTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "array", optional: true })
	public tags?: string[];

	@property({ type: "array", optional: true })
	public scores?: number[];
}

@entity()
class ObjectJsonArrayTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "object", optional: true })
	public keywords?: string[];
}

@entity()
class AnnotationTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "object", optional: true })
	public annotationObject?: { globalId: string };

	@property({ type: "string", optional: true })
	public label?: string;
}

@entity()
class MaxLengthTestType {
	@property({ type: "string", isPrimary: true, maxLength: 64 })
	public id!: string;

	@property({ type: "string", maxLength: 10 })
	public shortValue!: string;

	@property({ type: "string", isSecondary: true, maxLength: 20 })
	public indexedValue!: string;

	@property({ type: "string", isSecondary: true, maxLength: 300 })
	public longIndexedValue!: string;

	@property({ type: "string", optional: true })
	public unboundedValue?: string;

	@property({ type: "string", format: "uri", optional: true })
	public uriValue?: string;
}

@entity()
class BigIntTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "integer", format: "int64" })
	public signedValue!: number;

	@property({ type: "integer", format: "uint64", optional: true })
	public unsignedValue?: number;
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

describe("ScyllaDBTableConnector", () => {
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
		EntitySchemaFactory.register(nameof<ScalarArrayTestType>(), () =>
			EntitySchemaHelper.getSchema(ScalarArrayTestType)
		);
		EntitySchemaFactory.register(nameof<ObjectJsonArrayTestType>(), () =>
			EntitySchemaHelper.getSchema(ObjectJsonArrayTestType)
		);
		EntitySchemaFactory.register(nameof<AnnotationTestType>(), () =>
			EntitySchemaHelper.getSchema(AnnotationTestType)
		);
		EntitySchemaFactory.register(nameof<MaxLengthTestType>(), () =>
			EntitySchemaHelper.getSchema(MaxLengthTestType)
		);
		EntitySchemaFactory.register(nameof<BigIntTestType>(), () =>
			EntitySchemaHelper.getSchema(BigIntTestType)
		);

		createConnector = async <T>(entitySchema: string, partitionContextIds?: string[]) => {
			currentConnector = new ScyllaDBTableConnector<T>({
				entitySchema,
				partitionContextIds,
				config: {
					...TEST_SCYLLA_CONFIG,
					tableName: `${TEST_SCYLLA_CONFIG.tableName}_${RandomHelper.generateUuidV7("compact")}`
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

	test("can set only the targeted item when conditions match multiple records", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "shared", value2: 10 });
		await connector.set({ id: "2", value1: "shared", value2: 20 });
		await connector.set({ id: "2", value1: "shared", value2: 99 }, [
			{ property: "value1", value: "shared" }
		]);
		expect((await connector.get("2"))?.value2).toEqual(99);
		expect((await connector.get("1"))?.value2).toEqual(10);
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

	test("can get the correct item by secondary index when conditions match multiple records", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "300", value1: "shared", value2: 10 });
		await connector.set({ id: "301", value1: "shared", value2: 20 });
		const item = await connector.get("shared", "value1", [{ property: "value2", value: 20 }]);
		expect(item).toBeDefined();
		expect(item?.id).toEqual("301");
		expect(item?.value2).toEqual(20);
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

	test("can get the correct item by id when conditions match multiple records", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "shared", value2: 10 });
		await connector.set({ id: "2", value1: "shared", value2: 20 });
		const item = await connector.get("2", undefined, [{ property: "value1", value: "shared" }]);
		expect(item).toBeDefined();
		expect(item?.id).toEqual("2");
		expect(item?.value2).toEqual(20);
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

	test("can remove only the targeted item when conditions match multiple records", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "shared", value2: 10 });
		await connector.set({ id: "2", value1: "shared", value2: 20 });
		await connector.remove("2", [{ property: "value1", value: "shared" }]);
		expect(await connector.get("2")).toBeUndefined();
		expect(await connector.get("1")).toBeDefined();
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

	test("full unsorted cursor walk returns all items exactly once", async () => {
		const BATCH = 50;
		const PAGE = 7;
		const connector = await createConnector<TestType>(nameof<TestType>());
		const seeded = [...new Array(BATCH).keys()].map(i => ({
			id: String(i + 1).padStart(4, "0"),
			value1: "walk",
			value2: i
		}));
		await connector.setBatch(seeded);

		const seen = new Set<string>();
		let cursor: string | undefined;
		let pages = 0;
		do {
			const page = await connector.query(undefined, undefined, undefined, cursor, PAGE);
			for (const e of page.entities) {
				expect(seen.has(e.id as string), `duplicate id ${e.id}`).toBe(false);
				seen.add(e.id as string);
			}
			cursor = page.cursor;
			expect(++pages).toBeLessThan(100);
		} while (cursor !== undefined);

		for (const item of seeded) {
			expect(seen.has(item.id), `id ${item.id} missing from full walk`).toBe(true);
		}
		expect(seen.size).toBe(BATCH);
	});

	test("full cursor walk with condition returns matching items exactly once", async () => {
		const BATCH = 30;
		const PAGE = 4;
		const THRESHOLD = 15;
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < BATCH; i++) {
			await connector.set({
				id: String(i + 1).padStart(4, "0"),
				value1: "walk",
				value2: i
			});
		}

		const condition = {
			property: "id" as keyof TestType,
			comparison: ComparisonOperator.GreaterThanOrEqual,
			value: String(THRESHOLD + 1).padStart(4, "0")
		};

		const seen = new Set<string>();
		let cursor: string | undefined;
		let pages = 0;
		do {
			const page = await connector.query(condition, undefined, undefined, cursor, PAGE);
			for (const e of page.entities) {
				expect(seen.has(e.id as string), `duplicate id ${e.id}`).toBe(false);
				expect((e.id as string) >= String(THRESHOLD + 1).padStart(4, "0")).toBe(true);
				seen.add(e.id as string);
			}
			cursor = page.cursor;
			expect(++pages).toBeLessThan(100);
		} while (cursor !== undefined);

		expect(seen.size).toBe(BATCH - THRESHOLD);
	});

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can paginate with cursor when sorted by an indexed property",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			for (let i = 0; i < 15; i++) {
				await connector.set({
					id: (i + 1).toString(),
					value1: `val${String(i).padStart(3, "0")}`,
					value2: i
				});
			}
			const sort = [
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Ascending }
			];
			const result = await connector.query(undefined, sort, undefined, undefined, 10);
			expect(result.entities.length).toEqual(10);
			expect(result.cursor).toBeDefined();
			const result2 = await connector.query(undefined, sort, undefined, result.cursor, 10);
			expect(result2.entities.length).toEqual(5);
			expect(result2.cursor).toBeUndefined();
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"paginated cursor walk sorted by the primary key before another property has no skips or duplicates",
		async () => {
			const PAGE = 2;
			const connector = await createConnector<TestType>(nameof<TestType>());
			const seeded = [...new Array(6).keys()].map(i => ({
				id: String(i + 1).padStart(3, "0"),
				value1: `val${String(i + 1).padStart(3, "0")}`,
				value2: i
			}));
			await connector.setBatch(seeded);

			// The primary key is unique, so naming it first makes every later sort property
			// redundant, but it must not corrupt the cursor.
			const sort = [
				{ property: "id" as keyof TestType, sortDirection: SortDirection.Ascending },
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Ascending }
			];

			const seen = new Set<string>();
			let cursor: string | undefined;
			let pages = 0;
			do {
				const page = await connector.query(undefined, sort, undefined, cursor, PAGE);
				for (const e of page.entities) {
					expect(seen.has(e.id as string), `duplicate id ${e.id}`).toBe(false);
					seen.add(e.id as string);
				}
				cursor = page.cursor;
				expect(++pages).toBeLessThan(100);
			} while (cursor !== undefined);

			for (const item of seeded) {
				expect(seen.has(item.id), `id ${item.id} missing from cursor walk`).toBe(true);
			}
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"paginated cursor walk over a secondary index sorted query has no skips or duplicates",
		async () => {
			const BATCH = 20;
			const PAGE = 5;
			const connector = await createConnector<TestType>(nameof<TestType>());
			const seeded = [...new Array(BATCH).keys()].map(i => ({
				id: String(i + 1).padStart(3, "0"),
				value1: `val${String(i).padStart(3, "0")}`,
				value2: i
			}));
			await connector.setBatch(seeded);

			const sort = [
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Ascending }
			];
			const seen = new Set<string>();
			let cursor: string | undefined;
			let pages = 0;
			do {
				const page = await connector.query(undefined, sort, undefined, cursor, PAGE);
				for (const e of page.entities) {
					expect(seen.has(e.id as string), `duplicate id ${e.id}`).toBe(false);
					seen.add(e.id as string);
				}
				cursor = page.cursor;
				expect(++pages).toBeLessThan(100);
			} while (cursor !== undefined);

			for (const item of seeded) {
				expect(seen.has(item.id), `id ${item.id} missing from cursor walk`).toBe(true);
			}
			expect(seen.size).toBe(BATCH);
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT || !SUPPORT_NULLABLE_SORT_PROPERTY)(
		"paginated cursor walk over a nullable sort property has no skips or duplicates",
		async () => {
			const PAGE = 2;
			const connector = await createConnector<TestType>(nameof<TestType>());
			const seeded = [
				{ id: "001", value1: "val001", value2: 0, value4: "sort001" },
				{ id: "002", value1: "val002", value2: 1 },
				{ id: "003", value1: "val003", value2: 2, value4: "sort003" },
				{ id: "004", value1: "val004", value2: 3 },
				{ id: "005", value1: "val005", value2: 4, value4: "sort005" },
				{ id: "006", value1: "val006", value2: 5 }
			];
			await connector.setBatch(seeded);

			for (const sortDirection of [SortDirection.Ascending, SortDirection.Descending]) {
				const sort = [{ property: "value4" as keyof TestType, sortDirection }];
				const seen = new Set<string>();
				let cursor: string | undefined;
				let pages = 0;
				do {
					const page = await connector.query(undefined, sort, undefined, cursor, PAGE);
					for (const e of page.entities) {
						expect(seen.has(e.id as string), `duplicate id ${e.id}`).toBe(false);
						seen.add(e.id as string);
					}
					cursor = page.cursor;
					expect(++pages).toBeLessThan(100);
				} while (cursor !== undefined);

				for (const item of seeded) {
					expect(seen.has(item.id), `id ${item.id} missing from cursor walk`).toBe(true);
				}
			}
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can filter on secondary index property when also sorting by it",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			for (let i = 0; i < 10; i++) {
				await connector.set({
					id: String(i + 1).padStart(3, "0"),
					value1: `val${String(i).padStart(3, "0")}`,
					value2: i
				});
			}
			const sort = [
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Ascending }
			];
			const condition = {
				property: "value1" as keyof TestType,
				comparison: ComparisonOperator.GreaterThanOrEqual,
				value: "val003"
			};
			const result = await connector.query(condition, sort);
			expect(result.entities.length).toBe(7);
			expect(result.entities.every(e => (e.value1 as string) >= "val003")).toBe(true);
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"paginated cursor walk over a filtered and sorted secondary index query returns items in sort order",
		async () => {
			const BATCH = 20;
			const PAGE = 4;
			const connector = await createConnector<TestType>(nameof<TestType>());
			for (let i = 0; i < BATCH; i++) {
				await connector.set({
					id: String(i + 1).padStart(3, "0"),
					value1: `val${String(i).padStart(3, "0")}`,
					value2: i
				});
			}

			const sort = [
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Ascending }
			];
			const condition = {
				property: "value1" as keyof TestType,
				comparison: ComparisonOperator.GreaterThanOrEqual,
				value: "val005"
			};

			const all: Partial<TestType>[] = [];
			let cursor: string | undefined;
			let pages = 0;
			do {
				const page = await connector.query(condition, sort, undefined, cursor, PAGE);
				all.push(...page.entities);
				cursor = page.cursor;
				expect(++pages).toBeLessThan(100);
			} while (cursor !== undefined);

			expect(all.length).toBe(15);
			expect(all.every(e => (e.value1 as string) >= "val005")).toBe(true);
			for (let i = 1; i < all.length; i++) {
				expect((all[i].value1 as string) >= (all[i - 1].value1 as string)).toBe(true);
			}
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"regression: cursor walk over sorted secondary index with non-key filter should not stop early",
		async () => {
			const BATCH = 40;
			const PAGE = 5;
			const connector = await createConnector<TestType>(nameof<TestType>());

			for (let i = 0; i < BATCH; i++) {
				await connector.set({
					id: String(i + 1).padStart(3, "0"),
					value1: `val${String(i).padStart(3, "0")}`,
					value2: i
				});
			}

			const sort = [
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Ascending }
			];
			const condition = {
				property: "value2" as keyof TestType,
				comparison: ComparisonOperator.GreaterThanOrEqual,
				value: 30
			};

			const all: Partial<TestType>[] = [];
			let cursor: string | undefined;
			let pages = 0;
			do {
				const page = await connector.query(condition, sort, undefined, cursor, PAGE);
				all.push(...page.entities);
				cursor = page.cursor;
				expect(++pages).toBeLessThan(100);
			} while (cursor !== undefined);

			expect(all.length).toBe(10);
			expect(all.every(e => (e.value2 as number) >= 30)).toBe(true);
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"regression: paginating sorted secondary index query with projection should not produce invalid ExclusiveStartKey",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			for (let i = 0; i < 15; i++) {
				await connector.set({
					id: String(i + 1).padStart(3, "0"),
					value1: `val${String(i).padStart(3, "0")}`,
					value2: i
				});
			}

			const sort = [
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Ascending }
			];
			const firstPage = await connector.query(undefined, sort, ["value2"], undefined, 10);

			expect(firstPage.entities.length).toBe(10);
			expect(firstPage.cursor).toBeDefined();

			const secondPage = await connector.query(undefined, sort, ["value2"], firstPage.cursor, 10);

			expect(secondPage.entities.length).toBe(5);
			expect(secondPage.cursor).toBeUndefined();
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can paginate filtered secondary-index query with descending sort",
		async () => {
			const BATCH = 20;
			const PAGE = 4;
			const connector = await createConnector<TestType>(nameof<TestType>());

			for (let i = 0; i < BATCH; i++) {
				await connector.set({
					id: String(i + 1).padStart(3, "0"),
					value1: `val${String(i).padStart(3, "0")}`,
					value2: i
				});
			}

			const sort = [
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Descending }
			];
			const condition = {
				property: "value1" as keyof TestType,
				comparison: ComparisonOperator.GreaterThanOrEqual,
				value: "val005"
			};

			const all: Partial<TestType>[] = [];
			let cursor: string | undefined;
			let pages = 0;
			do {
				const page = await connector.query(condition, sort, undefined, cursor, PAGE);
				all.push(...page.entities);
				cursor = page.cursor;
				expect(++pages).toBeLessThan(100);
			} while (cursor !== undefined);

			expect(all.length).toBe(15);
			expect(all.every(e => (e.value1 as string) >= "val005")).toBe(true);
			for (let i = 1; i < all.length; i++) {
				expect((all[i].value1 as string) <= (all[i - 1].value1 as string)).toBe(true);
			}
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can paginate a multi-property sort with a primary-key tiebreaker across ties",
		async () => {
			const PAGE = 5;
			const groups = ["ccc", "aaa", "ddd", "bbb"];
			const connector = await createConnector<TestType>(nameof<TestType>());
			const seeded = [...new Array(12).keys()].map(i => ({
				id: String(i + 1).padStart(3, "0"),
				value1: groups[i % groups.length],
				value2: i
			}));
			for (const item of seeded) {
				await connector.set(item);
			}

			const sort = [
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Ascending },
				{ property: "id" as keyof TestType, sortDirection: SortDirection.Ascending }
			];

			const all: Partial<TestType>[] = [];
			const seen = new Set<string>();
			let cursor: string | undefined;
			let pages = 0;
			do {
				const page = await connector.query(undefined, sort, undefined, cursor, PAGE);
				for (const e of page.entities) {
					expect(seen.has(e.id as string), `duplicate id ${e.id}`).toBe(false);
					seen.add(e.id as string);
				}
				all.push(...page.entities);
				cursor = page.cursor;
				expect(++pages).toBeLessThan(100);
			} while (cursor !== undefined);

			expect(all.length).toBe(seeded.length);
			for (let i = 1; i < all.length; i++) {
				expect((all[i].value1 as string) >= (all[i - 1].value1 as string)).toBe(true);
			}

			if (SUPPORT_MULTI_SORT_TIEBREAKER_ORDER) {
				const expectedIds = seeded
					.slice()
					.sort((a, b) => {
						if (a.value1 === b.value1) {
							return a.id.localeCompare(b.id);
						}
						return a.value1.localeCompare(b.value1);
					})
					.map(e => e.id);
				expect(all.map(e => e.id)).toEqual(expectedIds);
			}
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"multi-property sort with descending first property honours the requested direction",
		async () => {
			const PAGE = 5;
			const groups = ["ccc", "aaa", "ddd", "bbb"];
			const connector = await createConnector<TestType>(nameof<TestType>());
			const seeded = [...new Array(12).keys()].map(i => ({
				id: String(i + 1).padStart(3, "0"),
				value1: groups[i % groups.length],
				value2: i
			}));
			for (const item of seeded) {
				await connector.set(item);
			}

			const sort = [
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Descending },
				{ property: "id" as keyof TestType, sortDirection: SortDirection.Ascending }
			];

			const all: Partial<TestType>[] = [];
			let cursor: string | undefined;
			let pages = 0;
			do {
				const page = await connector.query(undefined, sort, undefined, cursor, PAGE);
				all.push(...page.entities);
				cursor = page.cursor;
				expect(++pages).toBeLessThan(100);
			} while (cursor !== undefined);

			expect(all.length).toBe(seeded.length);
			for (let i = 1; i < all.length; i++) {
				expect((all[i].value1 as string) <= (all[i - 1].value1 as string)).toBe(true);
			}

			if (SUPPORT_MULTI_SORT_TIEBREAKER_ORDER) {
				const expectedIds = seeded
					.slice()
					.sort((a, b) => {
						if (a.value1 === b.value1) {
							return a.id.localeCompare(b.id);
						}
						return b.value1.localeCompare(a.value1);
					})
					.map(e => e.id);
				expect(all.map(e => e.id)).toEqual(expectedIds);
			}
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"sort led by the primary key returns primary-key order and ignores the trailing property",
		async () => {
			const groups = ["bbb", "aaa"];
			const connector = await createConnector<TestType>(nameof<TestType>());
			const seeded = [...new Array(8).keys()].map(i => ({
				id: String(8 - i).padStart(3, "0"),
				value1: groups[i % groups.length],
				value2: i
			}));
			for (const item of seeded) {
				await connector.set(item);
			}

			const sort = [
				{ property: "id" as keyof TestType, sortDirection: SortDirection.Ascending },
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Ascending }
			];

			const result = await connector.query(undefined, sort);
			const expectedIds = seeded.map(e => e.id).sort((a, b) => a.localeCompare(b));
			expect(result.entities.map(e => e.id)).toEqual(expectedIds);
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"sort with multiple non primary-key properties is honoured or clearly rejected",
		async () => {
			const groups = ["bbb", "aaa"];
			const connector = await createConnector<TestType>(nameof<TestType>());
			const seeded = [...new Array(8).keys()].map(i => ({
				id: String(i + 1).padStart(3, "0"),
				value1: groups[i % groups.length],
				value2: i,
				value4: String(8 - i)
			}));
			for (const item of seeded) {
				await connector.set(item);
			}

			const sort = [
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Ascending },
				{ property: "value4" as keyof TestType, sortDirection: SortDirection.Ascending }
			];

			if (SUPPORT_MULTI_SORT_ARBITRARY) {
				const result = await connector.query(undefined, sort);
				const expectedIds = seeded
					.slice()
					.sort((a, b) => {
						if (a.value1 === b.value1) {
							return a.value4.localeCompare(b.value4);
						}
						return a.value1.localeCompare(b.value1);
					})
					.map(e => e.id);
				expect(result.entities.map(e => e.id)).toEqual(expectedIds);
			} else {
				await expect(connector.query(undefined, sort)).rejects.toMatchObject({
					name: "GeneralError",
					message: expect.stringContaining("sortUnsupported")
				});
			}
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"multi-property sort keeps working after re-bootstrapping an existing store",
		async () => {
			const PAGE = 5;
			const groups = ["ccc", "aaa", "ddd", "bbb"];
			const connector = await createConnector<TestType>(nameof<TestType>());
			for (let i = 0; i < 12; i++) {
				await connector.set({
					id: String(i + 1).padStart(3, "0"),
					value1: groups[i % groups.length],
					value2: i
				});
			}

			const bootstrapped = await connector.bootstrap?.();
			expect(bootstrapped).toBe(true);

			const sort = [
				{ property: "value1" as keyof TestType, sortDirection: SortDirection.Ascending },
				{ property: "id" as keyof TestType, sortDirection: SortDirection.Ascending }
			];

			const all: Partial<TestType>[] = [];
			let cursor: string | undefined;
			let pages = 0;
			do {
				const page = await connector.query(undefined, sort, undefined, cursor, PAGE);
				all.push(...page.entities);
				cursor = page.cursor;
				expect(++pages).toBeLessThan(100);
			} while (cursor !== undefined);

			expect(all.length).toBe(12);
			for (let i = 1; i < all.length; i++) {
				expect((all[i].value1 as string) >= (all[i - 1].value1 as string)).toBe(true);
			}
		}
	);

	test("returns no cursor at exact page boundary for descending primary-key sort", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 10; i++) {
			await connector.set({
				id: String(i + 1).padStart(3, "0"),
				value1: "fixed",
				value2: i
			});
		}

		const result = await connector.query(
			undefined,
			[{ property: "id", sortDirection: SortDirection.Descending }],
			undefined,
			undefined,
			10
		);

		expect(result.entities.length).toBe(10);
		expect(result.cursor).toBeUndefined();
	});

	test("returns no cursor at exact page boundary for projected unfiltered query", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 10; i++) {
			await connector.set({
				id: String(i + 1).padStart(3, "0"),
				value1: "fixed",
				value2: i
			});
		}

		const result = await connector.query(undefined, undefined, ["value1"], undefined, 10);

		expect(result.entities.length).toBe(10);
		expect(result.cursor).toBeUndefined();
		expect(result.entities.every(e => e.value1 === "fixed")).toBe(true);
		expect(result.entities.every(e => e.id === undefined)).toBe(true);
	});

	test.skipIf(!SUPPORT_OR_CONDITIONS)(
		"scan fallback cursor walk returns all items without duplicates",
		async () => {
			const BATCH = 18;
			const PAGE = 5;
			const connector = await createConnector<TestType>(nameof<TestType>());
			for (let i = 0; i < BATCH; i++) {
				await connector.set({
					id: String(i + 1).padStart(3, "0"),
					value1: "scan",
					value2: i
				});
			}

			const condition = {
				logicalOperator: LogicalOperator.Or,
				conditions: [
					{
						property: "id" as keyof TestType,
						comparison: ComparisonOperator.Equals,
						value: "999"
					},
					{
						property: "value2" as keyof TestType,
						comparison: ComparisonOperator.GreaterThanOrEqual,
						value: 0
					}
				]
			};

			const allIds: string[] = [];
			let cursor: string | undefined;
			let pages = 0;
			do {
				const page = await connector.query(condition, undefined, undefined, cursor, PAGE);
				allIds.push(...page.entities.map(e => e.id as string));
				cursor = page.cursor;
				expect(++pages).toBeLessThan(100);
			} while (cursor !== undefined);

			expect(allIds.length).toBe(BATCH);
			expect(new Set(allIds).size).toBe(BATCH);
		}
	);

	test.skipIf(!SUPPORT_OR_CONDITIONS)(
		"scan fallback pagination works when projecting a non-key field",
		async () => {
			const BATCH = 12;
			const PAGE = 5;
			const connector = await createConnector<TestType>(nameof<TestType>());
			for (let i = 0; i < BATCH; i++) {
				await connector.set({
					id: String(i + 1).padStart(3, "0"),
					value1: `scan-${i}`,
					value2: i
				});
			}

			const condition = {
				logicalOperator: LogicalOperator.Or,
				conditions: [
					{
						property: "id" as keyof TestType,
						comparison: ComparisonOperator.Equals,
						value: "999"
					},
					{
						property: "value2" as keyof TestType,
						comparison: ComparisonOperator.GreaterThanOrEqual,
						value: 0
					}
				]
			};

			const all: Partial<TestType>[] = [];
			let cursor: string | undefined;
			do {
				const page = await connector.query(condition, undefined, ["value1"], cursor, PAGE);
				all.push(...page.entities);
				cursor = page.cursor;
			} while (cursor !== undefined);

			expect(all.length).toBe(BATCH);
			expect(all.every(e => Is.string(e.value1))).toBe(true);
			expect(all.every(e => e.id === undefined)).toBe(true);
		}
	);

	test("primary-key sort with secondary-property filter returns correctly sorted results", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "003", value1: "groupA", value2: 3 });
		await connector.set({ id: "001", value1: "groupA", value2: 1 });
		await connector.set({ id: "002", value1: "groupA", value2: 2 });
		await connector.set({ id: "004", value1: "groupB", value2: 4 });

		const result = await connector.query(
			{
				property: "value1",
				comparison: ComparisonOperator.Equals,
				value: "groupA"
			},
			[{ property: "id", sortDirection: SortDirection.Ascending }]
		);

		expect(result.entities.map(e => e.id)).toEqual(["001", "002", "003"]);
	});

	test("foreign partition cursor does not leak entities across partition contexts", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>(), ["tenant", "user"]);

		currentUser = "userA";
		for (let i = 0; i < 12; i++) {
			await connector.set({
				id: `A-${String(i + 1).padStart(3, "0")}`,
				value1: "tenant",
				value2: i
			});
		}
		const firstPage = await connector.query(undefined, undefined, undefined, undefined, 5);
		expect(firstPage.cursor).toBeDefined();

		currentUser = "userB";
		for (let i = 0; i < 6; i++) {
			await connector.set({
				id: `B-${String(i + 1).padStart(3, "0")}`,
				value1: "tenant",
				value2: i
			});
		}

		const result = await connector.query(undefined, undefined, undefined, firstPage.cursor, 5);
		expect(result.entities.every(e => !(e.id as string).startsWith("A-"))).toBe(true);
	});

	test.skipIf(!SUPPORT_OR_CONDITIONS)(
		"scan fallback stops early when filter matches few items in large partition",
		async () => {
			const TOTAL_ITEMS = 200;
			const MATCHING_ITEMS = 8;
			const PAGE_SIZE = 5;
			const connector = await createConnector<TestType>(nameof<TestType>());

			// Create many items with value1="noMatch" - these will NOT match the filter
			for (let i = 0; i < TOTAL_ITEMS - MATCHING_ITEMS; i++) {
				await connector.set({
					id: String(i + 1).padStart(5, "0"),
					value1: "noMatch",
					value2: i
				});
			}

			// Create a few items with value2 >= 1000 - these WILL match the filter
			for (let i = 0; i < MATCHING_ITEMS; i++) {
				await connector.set({
					id: `match-${String(i + 1).padStart(3, "0")}`,
					value1: "noMatch",
					value2: 1000 + i
				});
			}

			// Query with an OR condition that forces scan-fallback
			// The filter will match only MATCHING_ITEMS out of TOTAL_ITEMS
			const condition = {
				logicalOperator: LogicalOperator.Or,
				conditions: [
					{
						property: "id" as keyof TestType,
						comparison: ComparisonOperator.Equals,
						value: "nonexistent"
					},
					{
						property: "value2" as keyof TestType,
						comparison: ComparisonOperator.GreaterThanOrEqual,
						value: 1000
					}
				]
			};

			// Fetch all matching items in pages
			const allMatches: Partial<TestType>[] = [];
			let cursor: string | undefined;
			let pageCount = 0;
			do {
				const page = await connector.query(condition, undefined, undefined, cursor, PAGE_SIZE);
				allMatches.push(...page.entities);
				cursor = page.cursor;
				pageCount++;
			} while (cursor !== undefined);

			// Verify results
			expect(allMatches.length).toBe(MATCHING_ITEMS);
			expect(allMatches.every(e => (e.id as string).startsWith("match-"))).toBe(true);
			expect(allMatches.every(e => (e.value2 as number) >= 1000)).toBe(true);
			// Should take 2 pages (5 on first, 3 on second), not many more
			expect(pageCount).toBe(2);
		}
	);

	test("can fail to query with an invalid limit", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await expect(
			connector.query(undefined, undefined, undefined, undefined, 0)
		).rejects.toMatchObject({
			name: "ValidationError",
			message: "common.validation"
		});
	});

	test("can fail to query with an invalid property", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await expect(
			connector.query(undefined, undefined, ["nonExistent" as keyof TestType])
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.propertyNotInSchema"
		});
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

	test("can query with Equals on number field", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i * 10 });
		}
		const result = await connector.query({
			property: "value2",
			value: 20,
			comparison: ComparisonOperator.Equals
		});
		expect(result.entities.length).toEqual(1);
		expect((result.entities[0] as TestType).value2).toEqual(20);
	});

	test("can query with Equals on boolean field", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 1, isActive: true });
		await connector.set({ id: "2", value1: "bbb", value2: 2, isActive: false });
		await connector.set({ id: "3", value1: "ccc", value2: 3, isActive: true });
		const result = await connector.query({
			conditions: [{ property: "isActive", value: true, comparison: ComparisonOperator.Equals }]
		});
		expect(result.entities.length).toEqual(2);
		expect(result.entities.map(e => (e as TestType).id).sort()).toEqual(["1", "3"]);
	});

	test.skipIf(!SUPPORT_NOT_EQUALS)("can query with NotEquals on number field", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i * 10 });
		}
		const result = await connector.query({
			property: "value2",
			value: 20,
			comparison: ComparisonOperator.NotEquals
		});
		expect(result.entities.length).toEqual(4);
		expect(result.entities.every((e: Partial<TestType>) => e.value2 !== 20)).toBe(true);
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

	test("can query with In operator on number field", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: (i + 1).toString(), value1: "aaa", value2: i * 10 });
		}
		const result = await connector.query({
			conditions: [
				{
					property: "value2",
					value: [0, 20, 40],
					comparison: ComparisonOperator.In
				}
			]
		});
		expect(result.entities.length).toEqual(3);
		expect(
			result.entities.every((e: Partial<TestType>) => [0, 20, 40].includes(e.value2 ?? -1))
		).toBe(true);
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
			// The AND branch is dead - In [] is always false.
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

	test.skipIf(!SUPPORT_OR_CONDITIONS)(
		"can query with single-child AND group wrapping a multi-child OR group",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.set({ id: "1", value1: "alpha", value2: 1 });
			await connector.set({ id: "2", value1: "beta", value2: 2 });
			await connector.set({ id: "3", value1: "gamma", value2: 3 });
			// AND[ OR[value1==alpha, value1==beta] ] - single-child AND wrapping a multi-child OR.
			// Without the fix DynamoDB rejects the generated ( (expr) ) as redundant parens.
			const result = await connector.query({
				logicalOperator: LogicalOperator.And,
				conditions: [
					{
						logicalOperator: LogicalOperator.Or,
						conditions: [
							{ property: "value1", value: "alpha", comparison: ComparisonOperator.Equals },
							{ property: "value1", value: "beta", comparison: ComparisonOperator.Equals }
						]
					}
				]
			});
			expect(result.entities.length).toEqual(2);
			expect(result.entities.map((e: Partial<TestType>) => e.id).sort()).toEqual(["1", "2"]);
		}
	);

	test.skipIf(!SUPPORT_OR_CONDITIONS)(
		"can query with OR group containing multiple AND children",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.set({ id: "1", value1: "alpha", value2: 1 });
			await connector.set({ id: "2", value1: "beta", value2: 2 });
			await connector.set({ id: "3", value1: "alpha", value2: 2 });
			await connector.set({ id: "4", value1: "gamma", value2: 3 });
			// OR[ AND[value1==alpha, value2==1], AND[value1==beta, value2==2] ]
			// Uses OR at the outer level and AND at the inner level.
			const result = await connector.query({
				logicalOperator: LogicalOperator.Or,
				conditions: [
					{
						logicalOperator: LogicalOperator.And,
						conditions: [
							{ property: "value1", value: "alpha", comparison: ComparisonOperator.Equals },
							{ property: "value2", value: 1, comparison: ComparisonOperator.Equals }
						]
					},
					{
						logicalOperator: LogicalOperator.And,
						conditions: [
							{ property: "value1", value: "beta", comparison: ComparisonOperator.Equals },
							{ property: "value2", value: 2, comparison: ComparisonOperator.Equals }
						]
					}
				]
			});
			expect(result.entities.length).toEqual(2);
			expect(result.entities.map((e: Partial<TestType>) => e.id).sort()).toEqual(["1", "2"]);
		}
	);

	test.skipIf(!SUPPORT_OR_CONDITIONS)(
		"can query with AND group containing multiple OR children",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.set({ id: "1", value1: "alpha", value2: 1 });
			await connector.set({ id: "2", value1: "beta", value2: 2 });
			await connector.set({ id: "3", value1: "alpha", value2: 3 });
			await connector.set({ id: "4", value1: "gamma", value2: 1 });
			// AND[ OR[value1==alpha, value1==beta], OR[value2==1, value2==2] ]
			// Uses AND at the outer level and OR at each inner group.
			const result = await connector.query({
				logicalOperator: LogicalOperator.And,
				conditions: [
					{
						logicalOperator: LogicalOperator.Or,
						conditions: [
							{ property: "value1", value: "alpha", comparison: ComparisonOperator.Equals },
							{ property: "value1", value: "beta", comparison: ComparisonOperator.Equals }
						]
					},
					{
						logicalOperator: LogicalOperator.Or,
						conditions: [
							{ property: "value2", value: 1, comparison: ComparisonOperator.Equals },
							{ property: "value2", value: 2, comparison: ComparisonOperator.Equals }
						]
					}
				]
			});
			expect(result.entities.length).toEqual(2);
			expect(result.entities.map((e: Partial<TestType>) => e.id).sort()).toEqual(["1", "2"]);
		}
	);

	test.skipIf(!SUPPORT_OR_CONDITIONS)(
		"can query with triple-nested alternating logical operators",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.set({ id: "1", value1: "alpha", value2: 1 });
			await connector.set({ id: "2", value1: "beta", value2: 2 });
			await connector.set({ id: "3", value1: "gamma", value2: 3 });
			// OR[ AND[ OR[value1==alpha, value1==beta] ] ] - three levels of nesting
			// with alternating OR → AND → OR logical operators.
			const result = await connector.query({
				logicalOperator: LogicalOperator.Or,
				conditions: [
					{
						logicalOperator: LogicalOperator.And,
						conditions: [
							{
								logicalOperator: LogicalOperator.Or,
								conditions: [
									{
										property: "value1",
										value: "alpha",
										comparison: ComparisonOperator.Equals
									},
									{
										property: "value1",
										value: "beta",
										comparison: ComparisonOperator.Equals
									}
								]
							}
						]
					}
				]
			});
			expect(result.entities.length).toEqual(2);
			expect(result.entities.map((e: Partial<TestType>) => e.id).sort()).toEqual(["1", "2"]);
		}
	);

	test("can query with an empty nested condition group in AND", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "alpha", value2: 1 });
		await connector.set({ id: "2", value1: "beta", value2: 2 });
		await connector.set({ id: "3", value1: "gamma", value2: 3 });
		// AND[ AND[] ] - empty AND child inside outer AND applies no constraint.
		const result = await connector.query({
			logicalOperator: LogicalOperator.And,
			conditions: [
				{
					logicalOperator: LogicalOperator.And,
					conditions: []
				}
			]
		});
		expect(result.entities.length).toEqual(3);
	});

	test("can query with an empty nested group alongside a real condition", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "alpha", value2: 1 });
		await connector.set({ id: "2", value1: "beta", value2: 2 });
		await connector.set({ id: "3", value1: "gamma", value2: 3 });
		// AND[ AND[], value1==alpha ] - empty AND sibling is a no-op; only value1==alpha filters.
		const result = await connector.query({
			logicalOperator: LogicalOperator.And,
			conditions: [
				{
					logicalOperator: LogicalOperator.And,
					conditions: []
				},
				{ property: "value1", value: "alpha", comparison: ComparisonOperator.Equals }
			]
		});
		expect(result.entities.length).toEqual(1);
		expect((result.entities[0] as TestType).id).toEqual("1");
	});

	test.skipIf(!SUPPORT_OR_CONDITIONS)(
		"can query with an empty OR nested group alongside a real OR condition",
		async () => {
			const connector = await createConnector<TestType>(nameof<TestType>());
			await connector.set({ id: "1", value1: "alpha", value2: 1 });
			await connector.set({ id: "2", value1: "beta", value2: 2 });
			await connector.set({ id: "3", value1: "gamma", value2: 3 });
			// OR[ OR[], value1==alpha ] - empty OR child contributes nothing; only value1==alpha matches.
			const result = await connector.query({
				logicalOperator: LogicalOperator.Or,
				conditions: [
					{
						logicalOperator: LogicalOperator.Or,
						conditions: []
					},
					{ property: "value1", value: "alpha", comparison: ComparisonOperator.Equals }
				]
			});
			expect(result.entities.length).toEqual(1);
			expect((result.entities[0] as TestType).id).toEqual("1");
		}
	);

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

	test("throws if query sort property is not indexed", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await expect(
			connector.query(undefined, [{ property: "value2", sortDirection: SortDirection.Ascending }])
		).rejects.toMatchObject({ message: "entityStorageHelper.sortNotIndexed" });
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

	test("can set and get entity with a reserved-word property", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 0, role: "admin" });
		const result = await connector.get("1");
		expect(result?.role).toEqual("admin");
	});

	test("can query with projection including a reserved-word property", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 0, role: "admin" });
		const result = await connector.query(undefined, undefined, ["id", "role"]);
		expect(result.entities.length).toEqual(1);
		expect(result.entities[0].id).toBeDefined();
		expect(result.entities[0].role).toEqual("admin");
		expect(result.entities[0].value1).toBeUndefined();
	});

	test("can query filtering by a reserved-word property", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 0, role: "admin" });
		await connector.set({ id: "2", value1: "aaa", value2: 1, role: "viewer" });
		const result = await connector.query({
			property: "role",
			comparison: ComparisonOperator.Equals,
			value: "admin"
		});
		expect(result.entities.length).toEqual(1);
		expect(result.entities[0].role).toEqual("admin");
	});

	test("can count entities filtering by a reserved-word property", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "aaa", value2: 0, role: "admin" });
		await connector.set({ id: "2", value1: "aaa", value2: 1, role: "viewer" });
		await connector.set({ id: "3", value1: "aaa", value2: 2, role: "admin" });
		const count = await connector.count({
			property: "role",
			comparison: ComparisonOperator.Equals,
			value: "admin"
		});
		expect(count).toEqual(2);
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

	test("can query with StartsWith on string field", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "hello world", value2: 1 });
		await connector.set({ id: "2", value1: "worldwide", value2: 2 });
		await connector.set({ id: "3", value1: "foo bar", value2: 3 });
		const result = await connector.query({
			conditions: [
				{ property: "value1", value: "world", comparison: ComparisonOperator.StartsWith }
			]
		});
		expect(result.entities.length).toEqual(1);
		expect((result.entities[0] as TestType).value1).toEqual("worldwide");
	});

	test("can query with StartsWith treating wildcard characters in the value literally", async () => {
		const connector = await createConnector<TestType>(nameof<TestType>());
		await connector.set({ id: "1", value1: "a_b", value2: 1 });
		await connector.set({ id: "2", value1: "axb", value2: 2 });
		await connector.set({ id: "3", value1: "a%b", value2: 3 });
		const underscore = await connector.query({
			conditions: [{ property: "value1", value: "a_", comparison: ComparisonOperator.StartsWith }]
		});
		expect(underscore.entities.map(e => (e as TestType).value1)).toEqual(["a_b"]);
		const percent = await connector.query({
			conditions: [{ property: "value1", value: "a%", comparison: ComparisonOperator.StartsWith }]
		});
		expect(percent.entities.map(e => (e as TestType).value1)).toEqual(["a%b"]);
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

	test.skipIf(!SUPPORT_DOT_NOTATION)(
		"can query with Equals empty string on nested object subproperty returns no entries",
		async () => {
			const connector = await createConnector<NestedSearchType>(nameof<NestedSearchType>());
			await connector.set({ id: "1", consignor: { name: "Alice" } });
			await connector.set({ id: "2", consignor: { name: "Bob" } });
			await connector.set({ id: "3", consignor: { name: "Charlie" } });
			const result = await connector.query({
				conditions: [
					{
						property: "consignor.name",
						value: "",
						comparison: ComparisonOperator.Equals
					}
				]
			});
			expect(result.entities.length).toEqual(0);
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

	test("can query with Includes scalar string in array-typed column", async () => {
		const connector = await createConnector<ScalarArrayTestType>(nameof<ScalarArrayTestType>());
		await connector.set({ id: "1", tags: ["BorderAgency", "Trade"] });
		await connector.set({ id: "2", tags: ["Customs", "Trade"] });
		await connector.set({ id: "3", tags: ["Finance"] });
		const result = await connector.query({
			conditions: [
				{
					property: "tags",
					value: "BorderAgency",
					comparison: ComparisonOperator.Includes
				}
			]
		});
		expect(result.entities.length).toEqual(1);
		expect((result.entities[0] as ScalarArrayTestType).id).toEqual("1");
	});

	test("can query with Includes scalar string in object-typed JSON array column", async () => {
		const connector =
			await createConnector<ObjectJsonArrayTestType>(nameof<ObjectJsonArrayTestType>());
		await connector.set({ id: "1", keywords: ["BorderAgency", "Trade"] });
		await connector.set({ id: "2", keywords: ["Customs", "Trade"] });
		await connector.set({ id: "3", keywords: ["Finance"] });
		const result = await connector.query({
			conditions: [
				{
					property: "keywords",
					value: "BorderAgency",
					comparison: ComparisonOperator.Includes
				}
			]
		});
		expect(result.entities.length).toEqual(1);
		expect((result.entities[0] as ObjectJsonArrayTestType).id).toEqual("1");
	});

	test("can query with Includes scalar string matching multiple results in array-typed column", async () => {
		const connector = await createConnector<ScalarArrayTestType>(nameof<ScalarArrayTestType>());
		await connector.set({ id: "1", tags: ["BorderAgency", "Trade"] });
		await connector.set({ id: "2", tags: ["Customs", "Trade"] });
		await connector.set({ id: "3", tags: ["Finance"] });
		const result = await connector.query({
			conditions: [
				{
					property: "tags",
					value: "Trade",
					comparison: ComparisonOperator.Includes
				}
			]
		});
		expect(result.entities.length).toEqual(2);
		expect(result.entities.map(e => (e as ScalarArrayTestType).id).sort()).toEqual(["1", "2"]);
	});

	test.skipIf(!SUPPORT_NOT_INCLUDES)(
		"can query with NotIncludes scalar string in array-typed column",
		async () => {
			const connector = await createConnector<ScalarArrayTestType>(nameof<ScalarArrayTestType>());
			await connector.set({ id: "1", tags: ["BorderAgency", "Trade"] });
			await connector.set({ id: "2", tags: ["Customs", "Trade"] });
			await connector.set({ id: "3", tags: ["Finance"] });
			const result = await connector.query({
				conditions: [
					{
						property: "tags",
						value: "BorderAgency",
						comparison: ComparisonOperator.NotIncludes
					}
				]
			});
			expect(result.entities.length).toEqual(2);
			expect(result.entities.map(e => (e as ScalarArrayTestType).id).sort()).toEqual(["2", "3"]);
		}
	);

	test("can query with Includes scalar number in array-typed column", async () => {
		const connector = await createConnector<ScalarArrayTestType>(nameof<ScalarArrayTestType>());
		await connector.set({ id: "1", scores: [10, 20, 30] });
		await connector.set({ id: "2", scores: [20, 40] });
		await connector.set({ id: "3", scores: [50, 60] });
		const result = await connector.query({
			conditions: [
				{
					property: "scores",
					value: 20,
					comparison: ComparisonOperator.Includes
				}
			]
		});
		expect(result.entities.length).toEqual(2);
		expect(result.entities.map(e => (e as ScalarArrayTestType).id).sort()).toEqual(["1", "2"]);
	});

	test.skipIf(!SUPPORT_NOT_INCLUDES)(
		"can query with NotIncludes scalar number in array-typed column",
		async () => {
			const connector = await createConnector<ScalarArrayTestType>(nameof<ScalarArrayTestType>());
			await connector.set({ id: "1", scores: [10, 20, 30] });
			await connector.set({ id: "2", scores: [20, 40] });
			await connector.set({ id: "3", scores: [50, 60] });
			const result = await connector.query({
				conditions: [
					{
						property: "scores",
						value: 20,
						comparison: ComparisonOperator.NotIncludes
					}
				]
			});
			expect(result.entities.length).toEqual(1);
			expect((result.entities[0] as ScalarArrayTestType).id).toEqual("3");
		}
	);

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

	test("can set and get int64 and uint64 properties as numbers", async () => {
		const connector = await createConnector<BigIntTestType>(nameof<BigIntTestType>());
		await connector.set({
			id: "1",
			signedValue: Number.MIN_SAFE_INTEGER,
			unsignedValue: Number.MAX_SAFE_INTEGER
		});
		const item = await connector.get("1");
		expect(item?.signedValue).toBe(Number.MIN_SAFE_INTEGER);
		expect(item?.unsignedValue).toBe(Number.MAX_SAFE_INTEGER);
	});

	test("can leave an optional uint64 property undefined", async () => {
		const connector = await createConnector<BigIntTestType>(nameof<BigIntTestType>());
		await connector.set({ id: "1", signedValue: 1 });
		const item = await connector.get("1");
		expect(item?.signedValue).toBe(1);
		expect(item?.unsignedValue).toBeUndefined();
	});

	test("can query by int64 property", async () => {
		const connector = await createConnector<BigIntTestType>(nameof<BigIntTestType>());
		const base = Date.now();
		for (let i = 0; i < 3; i++) {
			await connector.set({ id: (i + 1).toString(), signedValue: base + i });
		}
		const result = await connector.query({
			property: "signedValue",
			value: base,
			comparison: ComparisonOperator.GreaterThan
		});
		expect(result.entities.length).toEqual(2);
		for (const item of result.entities) {
			expect(item.signedValue).toBeGreaterThan(base);
		}
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

	describe("dynamically-built OR conditions on dot-notation path", () => {
		test.skipIf(!SUPPORT_OR_CONDITIONS || !SUPPORT_DOT_NOTATION)(
			"returns all entities whose annotationObject.globalId appears in the id list",
			async () => {
				const connector = await createConnector<AnnotationTestType>(nameof<AnnotationTestType>());
				await connector.set({ id: "1", annotationObject: { globalId: "gid-a" }, label: "alpha" });
				await connector.set({ id: "2", annotationObject: { globalId: "gid-b" }, label: "beta" });
				await connector.set({ id: "3", annotationObject: { globalId: "gid-c" }, label: "gamma" });
				await connector.set({ id: "4", label: "no-annotation" });

				const entityIds = ["gid-a", "gid-c"];
				const conditions = entityIds.map(entityId => ({
					property: "annotationObject.globalId",
					value: entityId,
					comparison: ComparisonOperator.Equals
				}));

				const result = await connector.query({
					logicalOperator: LogicalOperator.Or,
					conditions
				});

				expect(result.entities.length).toEqual(2);
				expect(result.entities.map(e => (e as AnnotationTestType).id).sort()).toEqual(["1", "3"]);
			}
		);

		test.skipIf(!SUPPORT_OR_CONDITIONS || !SUPPORT_DOT_NOTATION)(
			"returns a single entity when the id list has one entry",
			async () => {
				const connector = await createConnector<AnnotationTestType>(nameof<AnnotationTestType>());
				await connector.set({ id: "1", annotationObject: { globalId: "gid-a" } });
				await connector.set({ id: "2", annotationObject: { globalId: "gid-b" } });

				const entityIds = ["gid-a"];
				const conditions = entityIds.map(entityId => ({
					property: "annotationObject.globalId",
					value: entityId,
					comparison: ComparisonOperator.Equals
				}));

				const result = await connector.query({
					logicalOperator: LogicalOperator.Or,
					conditions
				});

				expect(result.entities.length).toEqual(1);
				expect((result.entities[0] as AnnotationTestType).id).toEqual("1");
			}
		);

		test.skipIf(!SUPPORT_OR_CONDITIONS || !SUPPORT_DOT_NOTATION)(
			"returns empty when no entity matches any id in the list",
			async () => {
				const connector = await createConnector<AnnotationTestType>(nameof<AnnotationTestType>());
				await connector.set({ id: "1", annotationObject: { globalId: "gid-a" } });
				await connector.set({ id: "2", annotationObject: { globalId: "gid-b" } });

				const entityIds = ["nonexistent-x", "nonexistent-y"];
				const conditions = entityIds.map(entityId => ({
					property: "annotationObject.globalId",
					value: entityId,
					comparison: ComparisonOperator.Equals
				}));

				const result = await connector.query({
					logicalOperator: LogicalOperator.Or,
					conditions
				});

				expect(result.entities.length).toEqual(0);
				expect(result.cursor).toBeUndefined();
			}
		);

		test.skipIf(!SUPPORT_OR_CONDITIONS || !SUPPORT_DOT_NOTATION)(
			"does not return entities that lack annotationObject when querying by globalId",
			async () => {
				const connector = await createConnector<AnnotationTestType>(nameof<AnnotationTestType>());
				await connector.set({ id: "1", annotationObject: { globalId: "gid-a" } });
				await connector.set({ id: "2", label: "no-annotation" });
				await connector.set({ id: "3", label: "also-no-annotation" });

				const entityIds = ["gid-a"];
				const conditions = entityIds.map(entityId => ({
					property: "annotationObject.globalId",
					value: entityId,
					comparison: ComparisonOperator.Equals
				}));

				const result = await connector.query({
					logicalOperator: LogicalOperator.Or,
					conditions
				});

				expect(result.entities.length).toEqual(1);
				expect((result.entities[0] as AnnotationTestType).id).toEqual("1");
			}
		);

		test.skipIf(!SUPPORT_OR_CONDITIONS || !SUPPORT_DOT_NOTATION)(
			"returns only the matching subset when id list partially overlaps stored globalIds",
			async () => {
				const connector = await createConnector<AnnotationTestType>(nameof<AnnotationTestType>());
				await connector.set({ id: "1", annotationObject: { globalId: "gid-a" } });
				await connector.set({ id: "2", annotationObject: { globalId: "gid-b" } });
				await connector.set({ id: "3", annotationObject: { globalId: "gid-c" } });

				const entityIds = ["gid-a", "gid-z"];
				const conditions = entityIds.map(entityId => ({
					property: "annotationObject.globalId",
					value: entityId,
					comparison: ComparisonOperator.Equals
				}));

				const result = await connector.query({
					logicalOperator: LogicalOperator.Or,
					conditions
				});

				expect(result.entities.length).toEqual(1);
				expect((result.entities[0] as AnnotationTestType).id).toEqual("1");
			}
		);

		test.skipIf(!SUPPORT_OR_CONDITIONS || !SUPPORT_DOT_NOTATION)(
			"matches entity whose annotationObject.globalId is an empty string",
			async () => {
				const connector = await createConnector<AnnotationTestType>(nameof<AnnotationTestType>());
				await connector.set({ id: "1", annotationObject: { globalId: "gid-a" } });
				await connector.set({ id: "2", annotationObject: { globalId: "" } });
				await connector.set({ id: "3", annotationObject: { globalId: "gid-c" } });

				const entityIds = [""];
				const conditions = entityIds.map(entityId => ({
					property: "annotationObject.globalId",
					value: entityId,
					comparison: ComparisonOperator.Equals
				}));

				const result = await connector.query({
					logicalOperator: LogicalOperator.Or,
					conditions
				});

				expect(result.entities.length).toEqual(1);
				expect((result.entities[0] as AnnotationTestType).id).toEqual("2");
			}
		);

		test.skipIf(!SUPPORT_OR_CONDITIONS || !SUPPORT_DOT_NOTATION)(
			"returns no results when the id list contains only spaces and no entity matches",
			async () => {
				const connector = await createConnector<AnnotationTestType>(nameof<AnnotationTestType>());
				await connector.set({ id: "1", annotationObject: { globalId: "gid-a" } });
				await connector.set({ id: "2", annotationObject: { globalId: "gid-b" } });
				await connector.set({ id: "3", annotationObject: { globalId: "gid-c" } });

				const entityIds = ["   "];
				const conditions = entityIds.map(entityId => ({
					property: "annotationObject.globalId",
					value: entityId,
					comparison: ComparisonOperator.Equals
				}));

				const result = await connector.query({
					logicalOperator: LogicalOperator.Or,
					conditions
				});

				expect(result.entities.length).toEqual(0);
				expect(result.cursor).toBeUndefined();
			}
		);
	});

	describe("maxLength", () => {
		const atLimit = {
			id: "a".repeat(64),
			shortValue: "b".repeat(10),
			indexedValue: "c".repeat(20),
			longIndexedValue: "d".repeat(300)
		};

		test("can set an item with string properties at their maximum length", async () => {
			const connector = await createConnector<MaxLengthTestType>(nameof<MaxLengthTestType>());
			await connector.set({ ...atLimit });
			const item = await connector.get(atLimit.id);
			expect(item?.id).toEqual(atLimit.id);
			expect(item?.shortValue).toEqual(atLimit.shortValue);
			expect(item?.indexedValue).toEqual(atLimit.indexedValue);
			expect(item?.longIndexedValue).toEqual(atLimit.longIndexedValue);
		});

		test("can set an item with a string property which has no maximum length", async () => {
			const connector = await createConnector<MaxLengthTestType>(nameof<MaxLengthTestType>());
			const unboundedValue = "e".repeat(2000);
			await connector.set({ ...atLimit, unboundedValue });
			const item = await connector.get(atLimit.id);
			expect(item?.unboundedValue).toEqual(unboundedValue);
		});

		test("can get an item by a secondary index which has a maximum length", async () => {
			const connector = await createConnector<MaxLengthTestType>(nameof<MaxLengthTestType>());
			await connector.set({ ...atLimit });
			const item = await connector.get(atLimit.indexedValue, "indexedValue");
			expect(item?.id).toEqual(atLimit.id);
		});

		test("can fail to set an item with a string property over its maximum length", async () => {
			const connector = await createConnector<MaxLengthTestType>(nameof<MaxLengthTestType>());
			await expect(connector.set({ ...atLimit, shortValue: "b".repeat(11) })).rejects.toMatchObject(
				{
					name: "GeneralError",
					message: "entitySchemaHelper.maxLengthExceeded",
					properties: { property: "shortValue", maxLength: 10, length: 11 }
				}
			);
			expect(await connector.get(atLimit.id)).toBeUndefined();
		});

		test("can fail to set an item with a primary key over its maximum length", async () => {
			const connector = await createConnector<MaxLengthTestType>(nameof<MaxLengthTestType>());
			await expect(connector.set({ ...atLimit, id: "a".repeat(65) })).rejects.toMatchObject({
				name: "GeneralError",
				message: "entitySchemaHelper.maxLengthExceeded",
				properties: { property: "id", maxLength: 64, length: 65 }
			});
		});

		test("can fail to set an item with a secondary index over its maximum length", async () => {
			const connector = await createConnector<MaxLengthTestType>(nameof<MaxLengthTestType>());
			await expect(
				connector.set({ ...atLimit, indexedValue: "c".repeat(21) })
			).rejects.toMatchObject({
				name: "GeneralError",
				message: "entitySchemaHelper.maxLengthExceeded",
				properties: { property: "indexedValue", maxLength: 20, length: 21 }
			});
		});

		test("can set an item with a formatted property within its default maximum length", async () => {
			const connector = await createConnector<MaxLengthTestType>(nameof<MaxLengthTestType>());
			const uriValue = "https://example.com/a/path";
			await connector.set({ ...atLimit, uriValue });
			const item = await connector.get(atLimit.id);
			expect(item?.uriValue).toEqual(uriValue);
		});

		test("can fail to set an item with a formatted property over its default maximum length", async () => {
			const connector = await createConnector<MaxLengthTestType>(nameof<MaxLengthTestType>());
			const uriValue = `https://example.com/${"p".repeat(EntitySchemaHelper.FORMAT_MAX_LENGTHS.uri)}`;
			await expect(connector.set({ ...atLimit, uriValue })).rejects.toMatchObject({
				name: "GeneralError",
				message: "entitySchemaHelper.maxLengthExceeded",
				properties: {
					property: "uriValue",
					maxLength: EntitySchemaHelper.FORMAT_MAX_LENGTHS.uri,
					length: uriValue.length
				}
			});
		});

		test("can fail to set a batch when an item is over its maximum length", async () => {
			const connector = await createConnector<MaxLengthTestType>(nameof<MaxLengthTestType>());
			await expect(
				connector.setBatch([
					{ ...atLimit, id: "1" },
					{ ...atLimit, id: "2", shortValue: "b".repeat(11) }
				])
			).rejects.toMatchObject({
				name: "GeneralError",
				message: "entitySchemaHelper.maxLengthExceeded",
				properties: { property: "shortValue", maxLength: 10, length: 11 }
			});
			expect(await connector.get("1")).toBeUndefined();
		});
	});

	describe("property validation", () => {
		let connector: ScyllaDBTableConnector<TestType>;

		beforeAll(() => {
			connector = new ScyllaDBTableConnector<TestType>({
				entitySchema: nameof<TestType>(),
				config: TEST_SCYLLA_CONFIG
			});
		});

		test("query() rejects an unrecognised condition property", async () => {
			await expect(
				connector.query({
					property: "__injected",
					comparison: ComparisonOperator.Equals,
					value: "x"
				})
			).rejects.toMatchObject({
				name: "GeneralError",
				message: "entityStorageHelper.unknownPropertyInConditionProperty"
			});
		});

		test("count() rejects an unrecognised condition property", async () => {
			await expect(
				connector.count({
					property: "__injected",
					comparison: ComparisonOperator.Equals,
					value: "x"
				})
			).rejects.toMatchObject({
				name: "GeneralError",
				message: "entityStorageHelper.unknownPropertyInConditionProperty"
			});
		});

		test("get() rejects an unrecognised simple condition property", async () => {
			await expect(
				connector.get("id", undefined, [{ property: "__injected" as keyof TestType, value: "x" }])
			).rejects.toMatchObject({
				name: "GeneralError",
				message: "entityStorageHelper.unknownPropertyInConditions"
			});
		});

		test("set() rejects an unrecognised simple condition property", async () => {
			await expect(
				connector.set({ id: "1", value1: "aaa", value2: 1 }, [
					{ property: "__injected" as keyof TestType, value: "x" }
				])
			).rejects.toMatchObject({
				name: "GeneralError",
				message: "entityStorageHelper.unknownPropertyInConditions"
			});
		});

		test("remove() rejects an unrecognised simple condition property", async () => {
			await expect(
				connector.remove("id", [{ property: "__injected" as keyof TestType, value: "x" }])
			).rejects.toMatchObject({
				name: "GeneralError",
				message: "entityStorageHelper.unknownPropertyInConditions"
			});
		});
	});
});
