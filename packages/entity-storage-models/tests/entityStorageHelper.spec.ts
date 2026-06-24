// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { BaseError, GeneralError } from "@twin.org/core";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	LogicalOperator,
	SortDirection,
	entity,
	property
} from "@twin.org/entity";
import type { EntityCondition, IComparator } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { EntityStorageHelper } from "../src/helpers/entityStorageHelper.js";

@entity()
class SortTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", isSecondary: true })
	public tenant!: string;

	@property({ type: "string", sortDirection: SortDirection.Ascending })
	public name!: string;

	@property({ type: "string" })
	public plain!: string;
}

@entity()
class RequiredOnlyType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public name!: string;
}

@entity()
class MixedType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public required!: string;

	@property({ type: "string", optional: true })
	public optional?: string;

	@property({ type: "number", optional: true })
	public count?: number;

	@property({ type: "boolean", optional: true })
	public flag?: boolean;

	@property({ type: "object", optional: true })
	public nested?: { value: string };
}

describe("EntityStorageHelper.prepareEntity", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<RequiredOnlyType>(), () =>
			EntitySchemaHelper.getSchema(RequiredOnlyType)
		);
		EntitySchemaFactory.register(nameof<MixedType>(), () =>
			EntitySchemaHelper.getSchema(MixedType)
		);
		EntitySchemaFactory.register(nameof<SortTestType>(), () =>
			EntitySchemaHelper.getSchema(SortTestType)
		);
	});

	test("returns a clone, not the original entity", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const original = { id: "1", required: "r" };
		const result = EntityStorageHelper.prepareEntity(original, schema);
		expect(result).not.toBe(original);
	});

	test("leaves required properties with values unchanged", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const result = EntityStorageHelper.prepareEntity({ id: "1", required: "hello" }, schema);
		expect(result.id).toEqual("1");
		expect(result.required).toEqual("hello");
	});

	test("throws when a required property is undefined", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		expect(() =>
			EntityStorageHelper.prepareEntity(
				{ id: "1", required: undefined as unknown as string },
				schema
			)
		).toThrow();
	});

	test("sets optional undefined properties to null", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const result = EntityStorageHelper.prepareEntity<MixedType>({ id: "1", required: "r" }, schema);
		expect(result.optional).toBeNull();
		expect(result.count).toBeNull();
		expect(result.flag).toBeNull();
		expect(result.nested).toBeNull();
	});

	test("preserves optional null values as null", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const result = EntityStorageHelper.prepareEntity(
			{ id: "1", required: "r", optional: null as unknown as string },
			schema
		);
		expect(result.optional).toBeNull();
	});

	test("preserves optional properties that have values", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const result = EntityStorageHelper.prepareEntity(
			{ id: "1", required: "r", optional: "val", count: 42, flag: true },
			schema
		);
		expect(result.optional).toEqual("val");
		expect(result.count).toEqual(42);
		expect(result.flag).toBe(true);
	});

	test("sets additional properties on the returned entity", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const result = EntityStorageHelper.prepareEntity({ id: "1", required: "r" }, schema, [
			{ property: "partitionId", value: "tenant:user" }
		]);
		expect((result as { [key: string]: unknown }).partitionId).toEqual("tenant:user");
	});

	test("does not mutate the original entity", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const original = { id: "1", required: "r" };
		EntityStorageHelper.prepareEntity(original, schema, [{ property: "partitionId", value: "x" }]);
		expect((original as { [key: string]: unknown }).partitionId).toBeUndefined();
	});
});

describe("EntityStorageHelper.unPrepareEntity", () => {
	test("removes null properties from the entity", () => {
		const result = EntityStorageHelper.unPrepareEntity({
			id: "1",
			required: "r",
			optional: null
		});
		expect(result.optional).toBeUndefined();
		expect("optional" in result).toBe(false);
	});

	test("removes undefined properties from the entity", () => {
		const result = EntityStorageHelper.unPrepareEntity({
			id: "1",
			required: "r",
			optional: undefined
		});
		expect("optional" in result).toBe(false);
	});

	test("leaves non-empty properties unchanged", () => {
		const result = EntityStorageHelper.unPrepareEntity({ id: "1", required: "r", count: 0 });
		expect(result.id).toEqual("1");
		expect(result.required).toEqual("r");
		expect(result.count).toEqual(0);
	});

	test("removes specified named properties", () => {
		const result = EntityStorageHelper.unPrepareEntity(
			{ id: "1", required: "r", partitionId: "t:u" },
			["partitionId"]
		);
		expect(result.partitionId).toBeUndefined();
		expect(result.id).toEqual("1");
	});

	test("removes null values from nested objects", () => {
		const result = EntityStorageHelper.unPrepareEntity({
			id: "1",
			nested: { value: "v", empty: null }
		});
		expect(result.nested).toEqual({ value: "v" });
	});

	test("returns a new object, not the original", () => {
		const original = { id: "1", optional: null };
		const result = EntityStorageHelper.unPrepareEntity(original);
		expect(result).not.toBe(original);
	});
});

describe("EntityStorageHelper.normalizeConditionValues", () => {
	test("normalizes undefined to undefined for Equals leaf condition", () => {
		const condition: EntityCondition<MixedType> = {
			property: "optional",
			comparison: ComparisonOperator.Equals,
			value: undefined
		};
		const result = EntityStorageHelper.normalizeConditionValues(condition);
		expect((result as IComparator).value).toBeUndefined();
	});

	test("normalizes undefined to undefined for NotEquals leaf condition", () => {
		const condition: EntityCondition<MixedType> = {
			property: "optional",
			comparison: ComparisonOperator.NotEquals,
			value: undefined
		};
		const result = EntityStorageHelper.normalizeConditionValues(condition);
		expect((result as IComparator).value).toBeUndefined();
	});

	test("does not transform undefined for non-Equals/NotEquals operators", () => {
		const condition: EntityCondition<MixedType> = {
			property: "count",
			comparison: ComparisonOperator.GreaterThan,
			value: undefined as unknown as number
		};
		const result = EntityStorageHelper.normalizeConditionValues(condition);
		expect((result as IComparator).value).toBeUndefined();
	});

	test("normalizes null to undefined for Equals leaf condition", () => {
		const condition: EntityCondition<MixedType> = {
			property: "optional",
			comparison: ComparisonOperator.Equals,
			value: null as unknown as string
		};
		const result = EntityStorageHelper.normalizeConditionValues(condition);
		expect((result as IComparator).value).toBeUndefined();
	});

	test("normalizes null to undefined for NotEquals leaf condition", () => {
		const condition: EntityCondition<MixedType> = {
			property: "optional",
			comparison: ComparisonOperator.NotEquals,
			value: null as unknown as string
		};
		const result = EntityStorageHelper.normalizeConditionValues(condition);
		expect((result as IComparator).value).toBeUndefined();
	});

	test("does not transform a non-null non-undefined value", () => {
		const condition: EntityCondition<MixedType> = {
			property: "optional",
			comparison: ComparisonOperator.Equals,
			value: "hello"
		};
		const result = EntityStorageHelper.normalizeConditionValues(condition);
		expect(result).toMatchObject({ value: "hello" });
	});

	test("does not mutate the original condition", () => {
		const condition: EntityCondition<MixedType> = {
			property: "optional",
			comparison: ComparisonOperator.Equals,
			value: undefined
		};
		EntityStorageHelper.normalizeConditionValues(condition);
		expect(condition.value).toBeUndefined();
	});

	test("recursively normalizes nested compound conditions", () => {
		const condition: EntityCondition<MixedType> = {
			conditions: [
				{ property: "optional", comparison: ComparisonOperator.Equals, value: undefined },
				{ property: "count", comparison: ComparisonOperator.GreaterThan, value: 5 }
			],
			logicalOperator: LogicalOperator.And
		};
		const result = EntityStorageHelper.normalizeConditionValues(condition);
		expect("conditions" in result).toBe(true);
		const group = result as { conditions: EntityCondition<MixedType>[] };
		expect((group.conditions[0] as IComparator).value).toBeUndefined();
		expect(group.conditions[1]).toMatchObject({ value: 5 });
	});

	test("recursively normalizes deeply nested compound conditions", () => {
		const inner: EntityCondition<MixedType> = {
			conditions: [
				{ property: "optional", comparison: ComparisonOperator.NotEquals, value: undefined }
			],
			logicalOperator: LogicalOperator.Or
		};
		const outer: EntityCondition<MixedType> = {
			conditions: [inner],
			logicalOperator: LogicalOperator.And
		};
		const result = EntityStorageHelper.normalizeConditionValues(outer);
		const outerGroup = result as { conditions: EntityCondition<MixedType>[] };
		const innerGroup = outerGroup.conditions[0] as { conditions: EntityCondition<MixedType>[] };
		expect((innerGroup.conditions[0] as IComparator).value).toBeUndefined();
	});

	test("does not mutate nested compound conditions", () => {
		const leaf: EntityCondition<MixedType> = {
			property: "optional",
			comparison: ComparisonOperator.Equals,
			value: undefined
		};
		const condition: EntityCondition<MixedType> = {
			conditions: [leaf],
			logicalOperator: LogicalOperator.And
		};
		EntityStorageHelper.normalizeConditionValues(condition);
		expect(leaf.value).toBeUndefined();
	});
});

describe("EntityStorageHelper.validateSortProperties", () => {
	let schema: ReturnType<typeof EntitySchemaHelper.getSchema<SortTestType>>;

	beforeAll(() => {
		schema = EntitySchemaFactory.get(nameof<SortTestType>());
	});

	test("does not throw when sortProperties is undefined", () => {
		expect(() => EntityStorageHelper.validateSortProperties(schema, undefined)).not.toThrow();
	});

	test("does not throw when sortProperties is an empty array", () => {
		expect(() => EntityStorageHelper.validateSortProperties(schema, [])).not.toThrow();
	});

	test("does not throw for a primary key property", () => {
		expect(() =>
			EntityStorageHelper.validateSortProperties(schema, [
				{ property: "id", sortDirection: SortDirection.Ascending }
			])
		).not.toThrow();
	});

	test("does not throw for a secondary index property", () => {
		expect(() =>
			EntityStorageHelper.validateSortProperties(schema, [
				{ property: "tenant", sortDirection: SortDirection.Ascending }
			])
		).not.toThrow();
	});

	test("does not throw for a property with a default sortDirection", () => {
		expect(() =>
			EntityStorageHelper.validateSortProperties(schema, [
				{ property: "name", sortDirection: SortDirection.Descending }
			])
		).not.toThrow();
	});

	test("throws GeneralError for a plain non-indexed property", () => {
		expect(() =>
			EntityStorageHelper.validateSortProperties(schema, [
				{ property: "plain", sortDirection: SortDirection.Ascending }
			])
		).toThrow(GeneralError);
	});

	test("throws GeneralError for a property not present in the schema", () => {
		expect(() =>
			EntityStorageHelper.validateSortProperties(schema, [
				{ property: "nonExistent" as keyof SortTestType, sortDirection: SortDirection.Ascending }
			])
		).toThrow(GeneralError);
	});

	test("error message is sortNotIndexed for a plain non-indexed property", () => {
		expect.assertions(1);
		try {
			EntityStorageHelper.validateSortProperties(schema, [
				{ property: "plain", sortDirection: SortDirection.Ascending }
			]);
		} catch (err) {
			expect(BaseError.isErrorMessage(err, "entityStorageHelper.sortNotIndexed")).toBe(true);
		}
	});

	test("error message is sortNotIndexed for a property not in schema", () => {
		expect.assertions(1);
		try {
			EntityStorageHelper.validateSortProperties(schema, [
				{
					property: "nonExistent" as keyof SortTestType,
					sortDirection: SortDirection.Ascending
				}
			]);
		} catch (err) {
			expect(BaseError.isErrorMessage(err, "entityStorageHelper.sortNotIndexed")).toBe(true);
		}
	});
});

describe("EntityStorageHelper.validateProperties", () => {
	let schema: ReturnType<typeof EntitySchemaHelper.getSchema<SortTestType>>;

	beforeAll(() => {
		schema = EntitySchemaFactory.get(nameof<SortTestType>());
	});

	test("does not throw when properties is undefined", () => {
		expect(() => EntityStorageHelper.validateProperties(schema, undefined)).not.toThrow();
	});

	test("does not throw when properties is an empty array", () => {
		expect(() => EntityStorageHelper.validateProperties(schema, [])).not.toThrow();
	});

	test("does not throw for a valid property in the schema", () => {
		expect(() => EntityStorageHelper.validateProperties(schema, ["id"])).not.toThrow();
	});

	test("does not throw for multiple valid properties", () => {
		expect(() =>
			EntityStorageHelper.validateProperties(schema, ["id", "tenant", "name", "plain"])
		).not.toThrow();
	});

	test("throws GeneralError for a property not present in the schema", () => {
		expect(() =>
			EntityStorageHelper.validateProperties(schema, ["nonExistent" as keyof SortTestType])
		).toThrow(GeneralError);
	});

	test("error message is propertyNotInSchema for a property not in the schema", () => {
		expect.assertions(1);
		try {
			EntityStorageHelper.validateProperties(schema, ["nonExistent" as keyof SortTestType]);
		} catch (err) {
			expect(BaseError.isErrorMessage(err, "entityStorageHelper.propertyNotInSchema")).toBe(true);
		}
	});
});
