// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	LogicalOperator,
	entity,
	property
} from "@twin.org/entity";
import type { EntityCondition } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { EntityHelper } from "../src/helpers/entityHelper.js";

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

describe("EntityHelper.prepareEntity", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<RequiredOnlyType>(), () =>
			EntitySchemaHelper.getSchema(RequiredOnlyType)
		);
		EntitySchemaFactory.register(nameof<MixedType>(), () =>
			EntitySchemaHelper.getSchema(MixedType)
		);
	});

	test("returns a clone, not the original entity", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const original = { id: "1", required: "r" };
		const result = EntityHelper.prepareEntity(original, schema);
		expect(result).not.toBe(original);
	});

	test("leaves required properties with values unchanged", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const result = EntityHelper.prepareEntity({ id: "1", required: "hello" }, schema);
		expect(result.id).toEqual("1");
		expect(result.required).toEqual("hello");
	});

	test("throws when a required property is undefined", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		expect(() =>
			EntityHelper.prepareEntity({ id: "1", required: undefined as unknown as string }, schema)
		).toThrow();
	});

	test("sets optional undefined properties to null", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const result = EntityHelper.prepareEntity<MixedType>({ id: "1", required: "r" }, schema);
		expect(result.optional).toBeNull();
		expect(result.count).toBeNull();
		expect(result.flag).toBeNull();
		expect(result.nested).toBeNull();
	});

	test("preserves optional null values as null", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const result = EntityHelper.prepareEntity(
			{ id: "1", required: "r", optional: null as unknown as string },
			schema
		);
		expect(result.optional).toBeNull();
	});

	test("preserves optional properties that have values", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const result = EntityHelper.prepareEntity(
			{ id: "1", required: "r", optional: "val", count: 42, flag: true },
			schema
		);
		expect(result.optional).toEqual("val");
		expect(result.count).toEqual(42);
		expect(result.flag).toBe(true);
	});

	test("sets additional properties on the returned entity", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const result = EntityHelper.prepareEntity({ id: "1", required: "r" }, schema, [
			{ property: "partitionId", value: "tenant:user" }
		]);
		expect((result as { [key: string]: unknown }).partitionId).toEqual("tenant:user");
	});

	test("does not mutate the original entity", () => {
		const schema = EntitySchemaFactory.get(nameof<MixedType>());
		const original = { id: "1", required: "r" };
		EntityHelper.prepareEntity(original, schema, [{ property: "partitionId", value: "x" }]);
		expect((original as { [key: string]: unknown }).partitionId).toBeUndefined();
	});
});

describe("EntityHelper.unPrepareEntity", () => {
	test("removes null properties from the entity", () => {
		const result = EntityHelper.unPrepareEntity({
			id: "1",
			required: "r",
			optional: null
		});
		expect(result.optional).toBeUndefined();
		expect("optional" in result).toBe(false);
	});

	test("removes undefined properties from the entity", () => {
		const result = EntityHelper.unPrepareEntity({
			id: "1",
			required: "r",
			optional: undefined
		});
		expect("optional" in result).toBe(false);
	});

	test("leaves non-empty properties unchanged", () => {
		const result = EntityHelper.unPrepareEntity({ id: "1", required: "r", count: 0 });
		expect(result.id).toEqual("1");
		expect(result.required).toEqual("r");
		expect(result.count).toEqual(0);
	});

	test("removes specified named properties", () => {
		const result = EntityHelper.unPrepareEntity({ id: "1", required: "r", partitionId: "t:u" }, [
			"partitionId"
		]);
		expect(result.partitionId).toBeUndefined();
		expect(result.id).toEqual("1");
	});

	test("removes null values from nested objects", () => {
		const result = EntityHelper.unPrepareEntity({
			id: "1",
			nested: { value: "v", empty: null }
		});
		expect(result.nested).toEqual({ value: "v" });
	});

	test("returns a new object, not the original", () => {
		const original = { id: "1", optional: null };
		const result = EntityHelper.unPrepareEntity(original);
		expect(result).not.toBe(original);
	});
});

describe("EntityHelper.normalizeConditionValues", () => {
	test("converts undefined to null for Equals leaf condition", () => {
		const condition: EntityCondition<MixedType> = {
			property: "optional",
			comparison: ComparisonOperator.Equals,
			value: undefined
		};
		const result = EntityHelper.normalizeConditionValues(condition);
		expect(result).toMatchObject({ value: null });
	});

	test("converts undefined to null for NotEquals leaf condition", () => {
		const condition: EntityCondition<MixedType> = {
			property: "optional",
			comparison: ComparisonOperator.NotEquals,
			value: undefined
		};
		const result = EntityHelper.normalizeConditionValues(condition);
		expect(result).toMatchObject({ value: null });
	});

	test("does not transform undefined for non-Equals/NotEquals operators", () => {
		const condition: EntityCondition<MixedType> = {
			property: "count",
			comparison: ComparisonOperator.GreaterThan,
			value: undefined as unknown as number
		};
		const result = EntityHelper.normalizeConditionValues(condition);
		expect(result).toMatchObject({ value: undefined });
	});

	test("does not transform a null value (already null)", () => {
		const condition: EntityCondition<MixedType> = {
			property: "optional",
			comparison: ComparisonOperator.Equals,
			value: null as unknown as string
		};
		const result = EntityHelper.normalizeConditionValues(condition);
		expect(result).toMatchObject({ value: null });
	});

	test("does not transform a non-null non-undefined value", () => {
		const condition: EntityCondition<MixedType> = {
			property: "optional",
			comparison: ComparisonOperator.Equals,
			value: "hello"
		};
		const result = EntityHelper.normalizeConditionValues(condition);
		expect(result).toMatchObject({ value: "hello" });
	});

	test("does not mutate the original condition", () => {
		const condition: EntityCondition<MixedType> = {
			property: "optional",
			comparison: ComparisonOperator.Equals,
			value: undefined
		};
		EntityHelper.normalizeConditionValues(condition);
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
		const result = EntityHelper.normalizeConditionValues(condition);
		expect("conditions" in result).toBe(true);
		const group = result as { conditions: EntityCondition<MixedType>[] };
		expect(group.conditions[0]).toMatchObject({ value: null });
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
		const result = EntityHelper.normalizeConditionValues(outer);
		const outerGroup = result as { conditions: EntityCondition<MixedType>[] };
		const innerGroup = outerGroup.conditions[0] as { conditions: EntityCondition<MixedType>[] };
		expect(innerGroup.conditions[0]).toMatchObject({ value: null });
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
		EntityHelper.normalizeConditionValues(condition);
		expect(leaf.value).toBeUndefined();
	});
});
