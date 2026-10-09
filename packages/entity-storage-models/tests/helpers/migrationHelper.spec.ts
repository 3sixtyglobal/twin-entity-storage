// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	ContextIdHandlerFactory,
	ContextIdHelper,
	ContextIdKeys,
	ContextIdStore,
	type IContextIds
} from "@3sixty/context";
import { BaseError, ComponentFactory, GeneralError, Is } from "@3sixty/core";
import {
	EntitySchemaPropertyType,
	type IEntitySchemaDiff,
	type IEntitySchemaProperty
} from "@3sixty/entity";
import { EntityStorageHelper } from "../../src/helpers/entityStorageHelper.js";
import { MigrationHelper } from "../../src/helpers/migrationHelper.js";
import type { IEntityStorageConnector } from "../../src/models/IEntityStorageConnector.js";
import type { IEntityStorageMigrationConnector } from "../../src/models/IEntityStorageMigrationConnector.js";
import type { IResolvedMigrationStep } from "../../src/models/IResolvedMigrationStep.js";
import { TestContextIdHandler } from "../testContextIdHandler.js";

// ---------------------------------------------------------------------------
// String-indexed entity type so keyof resolves to string
// ---------------------------------------------------------------------------

interface ITransformEntity {
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// applyEntityTransform tests
// ---------------------------------------------------------------------------

describe("MigrationHelper.applyEntityTransform", () => {
	function diff(
		partial: Partial<IEntitySchemaDiff<ITransformEntity, ITransformEntity>>
	): IEntitySchemaDiff<ITransformEntity, ITransformEntity> {
		return { unchanged: [], added: [], removed: [], modified: [], ...partial };
	}

	function prop(
		property: string,
		type: EntitySchemaPropertyType,
		extra?: Partial<IEntitySchemaProperty<ITransformEntity>>
	): IEntitySchemaProperty<ITransformEntity> {
		return { property, type, ...extra };
	}

	test("copies unchanged properties from source entity", async () => {
		const d = diff({
			unchanged: [
				prop("id", EntitySchemaPropertyType.String),
				prop("value", EntitySchemaPropertyType.String)
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ id: "1", value: "hello" },
			d
		);
		expect(result).toEqual({ id: "1", value: "hello" });
	});

	test("added non-optional boolean property defaults to false", async () => {
		const d = diff({ added: [prop("active", EntitySchemaPropertyType.Boolean)] });
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{},
			d
		);
		expect(result.active).toBe(false);
	});

	test("added non-optional number property defaults to 0", async () => {
		const d = diff({ added: [prop("count", EntitySchemaPropertyType.Number)] });
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{},
			d
		);
		expect(result.count).toBe(0);
	});

	test("added non-optional integer property defaults to 0", async () => {
		const d = diff({ added: [prop("age", EntitySchemaPropertyType.Integer)] });
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{},
			d
		);
		expect(result.age).toBe(0);
	});

	test("added non-optional string property defaults to empty string", async () => {
		const d = diff({ added: [prop("name", EntitySchemaPropertyType.String)] });
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{},
			d
		);
		expect(result.name).toBe("");
	});

	test("added non-optional array property defaults to []", async () => {
		const d = diff({ added: [prop("tags", EntitySchemaPropertyType.Array)] });
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{},
			d
		);
		expect(result.tags).toEqual([]);
	});

	test("added non-optional object property defaults to {}", async () => {
		const d = diff({ added: [prop("meta", EntitySchemaPropertyType.Object)] });
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{},
			d
		);
		expect(result.meta).toEqual({});
	});

	test("added non-optional string property uses defaultValue when provided", async () => {
		const d = diff({
			added: [prop("status", EntitySchemaPropertyType.String, { defaultValue: "active" })]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{},
			d
		);
		expect(result.status).toBe("active");
	});

	test("added non-optional integer property uses defaultValue when provided", async () => {
		const d = diff({
			added: [prop("score", EntitySchemaPropertyType.Integer, { defaultValue: 42 })]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{},
			d
		);
		expect(result.score).toBe(42);
	});

	test("added optional property defaults to undefined", async () => {
		const d = diff({ added: [prop("note", EntitySchemaPropertyType.String, { optional: true })] });
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{},
			d
		);
		expect(result.note).toBeUndefined();
	});

	test("removed property is not present in result", async () => {
		const d = diff({
			unchanged: [prop("id", EntitySchemaPropertyType.String)],
			removed: [prop("legacy", EntitySchemaPropertyType.String)]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ id: "1", legacy: "old" },
			d
		);
		expect(result.legacy).toBeUndefined();
		expect(result.id).toBe("1");
	});

	test("modified property: string value coerced to boolean", async () => {
		const d = diff({
			modified: [
				{
					from: prop("flag", EntitySchemaPropertyType.String),
					to: prop("flag", EntitySchemaPropertyType.Boolean)
				}
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ flag: "true" },
			d
		);
		expect(result.flag).toBe(true);
	});

	test("modified property: string value coerced to number", async () => {
		const d = diff({
			modified: [
				{
					from: prop("qty", EntitySchemaPropertyType.String),
					to: prop("qty", EntitySchemaPropertyType.Number)
				}
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ qty: "42" },
			d
		);
		expect(result.qty).toBe(42);
	});

	test("modified property: string value coerced to integer", async () => {
		const d = diff({
			modified: [
				{
					from: prop("qty", EntitySchemaPropertyType.String),
					to: prop("qty", EntitySchemaPropertyType.Integer)
				}
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ qty: "7" },
			d
		);
		expect(result.qty).toBe(7);
	});

	test("modified property: number value coerced to string", async () => {
		const d = diff({
			modified: [
				{
					from: prop("code", EntitySchemaPropertyType.Number),
					to: prop("code", EntitySchemaPropertyType.String)
				}
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ code: 99 },
			d
		);
		expect(result.code).toBe("99");
	});

	test("modified property: array type without transformEntityProperty throws GeneralError", async () => {
		const d = diff({
			modified: [
				{
					from: prop("data", EntitySchemaPropertyType.String),
					to: prop("data", EntitySchemaPropertyType.Array)
				}
			]
		});
		await expect(
			MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({ data: "raw" }, d)
		).rejects.toThrow(GeneralError);
	});

	test("modified property: object type without transformEntityProperty throws GeneralError", async () => {
		const d = diff({
			modified: [
				{
					from: prop("meta", EntitySchemaPropertyType.String),
					to: prop("meta", EntitySchemaPropertyType.Object)
				}
			]
		});
		await expect(
			MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({ meta: "raw" }, d)
		).rejects.toThrow(GeneralError);
	});

	test("modified property: array type with transformEntityProperty uses the return value", async () => {
		const d = diff({
			modified: [
				{
					from: prop("tags", EntitySchemaPropertyType.String),
					to: prop("tags", EntitySchemaPropertyType.Array)
				}
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ tags: "a,b,c" },
			d,
			(entity, f, t, v) => (v as string).split(",")
		);
		expect(result.tags).toEqual(["a", "b", "c"]);
	});

	test("modified property: array type with async transformEntityProperty uses the return value", async () => {
		const d = diff({
			modified: [
				{
					from: prop("tags", EntitySchemaPropertyType.String),
					to: prop("tags", EntitySchemaPropertyType.Array)
				}
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ tags: "a,b,c" },
			d,
			async (entity, f, t, v) => (v as string).split(",")
		);
		expect(result.tags).toEqual(["a", "b", "c"]);
	});

	test("modified property: string rename uses the transformEntityProperty return value instead of coercion", async () => {
		const d = diff({
			modified: [
				{
					from: prop("hash", EntitySchemaPropertyType.String),
					to: prop("integrity", EntitySchemaPropertyType.String)
				}
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ hash: "sha256:abc" },
			d,
			(entity, f, t, v) => (v as string).replace("sha256:", "sha256-")
		);
		expect(result.integrity).toBe("sha256-abc");
		expect(result.hash).toBeUndefined();
	});

	test("modified property: number target uses the transformEntityProperty return value instead of coercion", async () => {
		const d = diff({
			modified: [
				{
					from: prop("count", EntitySchemaPropertyType.String),
					to: prop("count", EntitySchemaPropertyType.Number)
				}
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ count: "three" },
			d,
			() => 3
		);
		expect(result.count).toBe(3);
	});

	test("modified property: boolean target uses the transformEntityProperty return value instead of coercion", async () => {
		const d = diff({
			modified: [
				{
					from: prop("flag", EntitySchemaPropertyType.String),
					to: prop("flag", EntitySchemaPropertyType.Boolean)
				}
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ flag: "nope" },
			d,
			() => false
		);
		expect(result.flag).toBe(false);
	});

	test("modified property: scalar target falls back to coercion when transformEntityProperty returns undefined", async () => {
		const d = diff({
			modified: [
				{
					from: prop("qty", EntitySchemaPropertyType.String),
					to: prop("quantity", EntitySchemaPropertyType.String)
				}
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ qty: "5" },
			d,
			() => undefined
		);
		expect(result.quantity).toBe("5");
	});

	test("combination: unchanged, added, and removed properties all handled correctly", async () => {
		const d = diff({
			unchanged: [prop("id", EntitySchemaPropertyType.String)],
			added: [prop("newField", EntitySchemaPropertyType.Number)],
			removed: [prop("old", EntitySchemaPropertyType.String)]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ id: "42", old: "gone" },
			d
		);
		expect(result.id).toBe("42");
		expect(result.newField).toBe(0);
		expect(result.old).toBeUndefined();
	});

	test("removed property: removeEntityProperty hook called with original entity and removed schemas", async () => {
		const removed = [prop("old", EntitySchemaPropertyType.String)];
		const d = diff({ removed });
		const calls: { entity: unknown; props: unknown[] }[] = [];
		await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ old: "gone" },
			d,
			undefined,
			(entity, removedProperties) => {
				calls.push({ entity, props: removedProperties });
			}
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].entity).toEqual({ old: "gone" });
		expect(calls[0].props).toEqual(removed);
	});

	test("removed property: async removeEntityProperty hook called with original entity and removed schemas", async () => {
		const removed = [prop("old", EntitySchemaPropertyType.String)];
		const d = diff({ removed });
		const calls: { entity: unknown; props: unknown[] }[] = [];
		await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ old: "gone" },
			d,
			undefined,
			async (entity, removedProperties) => {
				calls.push({ entity, props: removedProperties });
			}
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].entity).toEqual({ old: "gone" });
		expect(calls[0].props).toEqual(removed);
	});

	test("removed property: removeEntityProperty hook not called when no properties are removed", async () => {
		const d = diff({ unchanged: [prop("id", EntitySchemaPropertyType.String)] });
		const calls: unknown[] = [];
		await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ id: "1" },
			d,
			undefined,
			(entity, removedProperties) => {
				calls.push({ entity, removedProperties });
			}
		);
		expect(calls).toHaveLength(0);
	});

	test("removed property: async removeEntityProperty hook not called when no properties are removed", async () => {
		const d = diff({ unchanged: [prop("id", EntitySchemaPropertyType.String)] });
		const calls: unknown[] = [];
		await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ id: "1" },
			d,
			undefined,
			async (entity, removedProperties) => {
				calls.push({ entity, removedProperties });
			}
		);
		expect(calls).toHaveLength(0);
	});

	test("modified property: property renamed - value moved to new property name", async () => {
		const d = diff({
			modified: [
				{
					from: prop("qty", EntitySchemaPropertyType.String),
					to: prop("quantity", EntitySchemaPropertyType.String)
				}
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ qty: "5" },
			d
		);
		expect(result.quantity).toBe("5");
		expect(result.qty).toBeUndefined();
	});

	test("modified property: missing source value on non-optional boolean target throws GeneralError", async () => {
		const d = diff({
			modified: [
				{
					from: prop("flag", EntitySchemaPropertyType.String),
					to: prop("flag", EntitySchemaPropertyType.Boolean)
				}
			]
		});
		await expect(MigrationHelper.applyEntityTransform({}, d)).rejects.toThrow(GeneralError);
	});

	test("modified property: missing source value on non-optional number target throws GeneralError", async () => {
		const d = diff({
			modified: [
				{
					from: prop("qty", EntitySchemaPropertyType.String),
					to: prop("qty", EntitySchemaPropertyType.Number)
				}
			]
		});
		await expect(MigrationHelper.applyEntityTransform({}, d)).rejects.toThrow(GeneralError);
	});

	test("modified property: missing source value on non-optional string target throws GeneralError", async () => {
		const d = diff({
			modified: [
				{
					from: prop("name", EntitySchemaPropertyType.Number),
					to: prop("name", EntitySchemaPropertyType.String)
				}
			]
		});
		await expect(MigrationHelper.applyEntityTransform({}, d)).rejects.toThrow(GeneralError);
	});

	test("modified property: missing source value on optional target is allowed through as undefined", async () => {
		const d = diff({
			modified: [
				{
					from: prop("note", EntitySchemaPropertyType.Number),
					to: prop("note", EntitySchemaPropertyType.String, { optional: true })
				}
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{},
			d
		);
		expect(result.note).toBeUndefined();
	});

	// ---
	// Issue #185 Bug 2 - "added" properties must preserve existing source values
	// ---

	test("added non-optional string property preserves existing source value over empty-string default", async () => {
		const d = diff({ added: [prop("organizationId", EntitySchemaPropertyType.String)] });
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ id: "1", organizationId: "org-abc" },
			d
		);
		expect(result.organizationId).toBe("org-abc");
	});

	test("added non-optional string property preserves existing source value over provided defaultValue", async () => {
		const d = diff({
			added: [prop("status", EntitySchemaPropertyType.String, { defaultValue: "active" })]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ status: "custom" },
			d
		);
		expect(result.status).toBe("custom");
	});

	test("added non-optional boolean property preserves existing source value over boolean default", async () => {
		const d = diff({ added: [prop("active", EntitySchemaPropertyType.Boolean)] });
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ active: true },
			d
		);
		expect(result.active).toBe(true);
	});

	test("added non-optional number property preserves existing source value over zero default", async () => {
		const d = diff({ added: [prop("count", EntitySchemaPropertyType.Number)] });
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ count: 42 },
			d
		);
		expect(result.count).toBe(42);
	});

	test("unchanged property absent from entity is copied as undefined", async () => {
		const d = diff({
			unchanged: [
				prop("id", EntitySchemaPropertyType.String),
				prop("optional", EntitySchemaPropertyType.String, { optional: true })
			]
		});
		const result = await MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ id: "1" },
			d
		);
		expect(result.id).toBe("1");
		expect(result.optional).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// applyEntityChain tests
// ---------------------------------------------------------------------------

describe("MigrationHelper.applyEntityChain", () => {
	function makeProps(
		...fields: [string, EntitySchemaPropertyType, boolean?][]
	): IEntitySchemaProperty[] {
		return fields.map(
			([property, type, optional]) =>
				({ property, type, optional }) as unknown as IEntitySchemaProperty
		);
	}

	test("returns entity unchanged when steps list is empty", async () => {
		const entity: { [key: string]: unknown } = { id: "1", name: "Alice" };
		const result = await MigrationHelper.applyEntityChain(entity, []);
		expect(result).toEqual(entity);
	});

	test("applies a single step - adds a new optional field", async () => {
		const step: IResolvedMigrationStep = {
			fromProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["name", EntitySchemaPropertyType.String]
			),
			toProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["name", EntitySchemaPropertyType.String],
				["extra", EntitySchemaPropertyType.String, true]
			)
		};
		const result = (await MigrationHelper.applyEntityChain({ id: "1", name: "Alice" }, [step])) as {
			[key: string]: unknown;
		};
		expect(result.id).toBe("1");
		expect(result.name).toBe("Alice");
		expect(result.extra).toBeUndefined();
	});

	test("applies a single step - adds a new required string field with default", async () => {
		const step: IResolvedMigrationStep = {
			fromProperties: makeProps(["id", EntitySchemaPropertyType.String]),
			toProperties: [
				{ property: "id", type: EntitySchemaPropertyType.String },
				{ property: "status", type: EntitySchemaPropertyType.String, defaultValue: "active" }
			] as unknown as IEntitySchemaProperty[]
		};
		const result = (await MigrationHelper.applyEntityChain({ id: "x" }, [step])) as {
			[key: string]: unknown;
		};
		expect(result.status).toBe("active");
	});

	test("applies multiple steps in sequence - each step's output feeds the next", async () => {
		const step1: IResolvedMigrationStep = {
			fromProperties: makeProps(["id", EntitySchemaPropertyType.String]),
			toProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["count", EntitySchemaPropertyType.Integer]
			)
		};
		const step2: IResolvedMigrationStep = {
			fromProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["count", EntitySchemaPropertyType.Integer]
			),
			toProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["count", EntitySchemaPropertyType.Integer],
				["label", EntitySchemaPropertyType.String]
			)
		};

		const result = (await MigrationHelper.applyEntityChain({ id: "x" }, [step1, step2])) as {
			[key: string]: unknown;
		};

		expect(result.id).toBe("x");
		expect(result.count).toBe(0);
		expect(result.label).toBe("");
	});

	test("applies a rename via the renames option on the step", async () => {
		const step: IResolvedMigrationStep = {
			fromProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["qty", EntitySchemaPropertyType.String]
			),
			toProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["quantity", EntitySchemaPropertyType.String]
			),
			renames: [{ from: "qty", to: "quantity" }]
		};
		const result = (await MigrationHelper.applyEntityChain({ id: "1", qty: "5" }, [step])) as {
			[key: string]: unknown;
		};
		expect(result.quantity).toBe("5");
		expect(result.qty).toBeUndefined();
	});

	test("applies transformEntityProperty during a rename, not just a generic coercion", async () => {
		const step: IResolvedMigrationStep = {
			fromProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["hash", EntitySchemaPropertyType.String]
			),
			toProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["integrity", EntitySchemaPropertyType.String]
			),
			renames: [{ from: "hash", to: "integrity" }],
			transformEntityProperty: (entity, f, t, v) => (v as string).replace("sha256:", "sha256-")
		};
		const result = (await MigrationHelper.applyEntityChain({ id: "1", hash: "sha256:abc" }, [
			step
		])) as { [key: string]: unknown };
		expect(result.integrity).toBe("sha256-abc");
	});

	test("applies the step's transformEntity to the source entity before the diff", async () => {
		const step: IResolvedMigrationStep = {
			fromProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["code", EntitySchemaPropertyType.String, true]
			),
			toProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["code", EntitySchemaPropertyType.String]
			),
			transformEntity: entity => {
				const source = entity as { [key: string]: unknown };
				return { ...source, code: source.legacyCode };
			}
		};

		const result = (await MigrationHelper.applyEntityChain({ id: "1", legacyCode: "abc" }, [
			step
		])) as { [key: string]: unknown };

		expect(result.code).toBe("abc");
		expect(result.legacyCode).toBeUndefined();
	});

	test("awaits an async transformEntity", async () => {
		const step: IResolvedMigrationStep = {
			fromProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["code", EntitySchemaPropertyType.String, true]
			),
			toProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["code", EntitySchemaPropertyType.String]
			),
			transformEntity: async entity => {
				await new Promise(resolve => setTimeout(resolve, 0));
				const source = entity as { [key: string]: unknown };
				return { ...source, code: source.legacyCode };
			}
		};

		const result = (await MigrationHelper.applyEntityChain({ id: "1", legacyCode: "abc" }, [
			step
		])) as { [key: string]: unknown };

		expect(result.code).toBe("abc");
	});

	test("feeds each step's output to the next step's transformEntity", async () => {
		const step1: IResolvedMigrationStep = {
			fromProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["qty", EntitySchemaPropertyType.String]
			),
			toProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["quantity", EntitySchemaPropertyType.String]
			),
			renames: [{ from: "qty", to: "quantity" }]
		};

		let received: { [key: string]: unknown } | undefined;
		const step2: IResolvedMigrationStep = {
			fromProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["quantity", EntitySchemaPropertyType.String]
			),
			toProperties: makeProps(
				["id", EntitySchemaPropertyType.String],
				["quantity", EntitySchemaPropertyType.String]
			),
			transformEntity: entity => {
				received = entity as { [key: string]: unknown };
				return entity;
			}
		};

		await MigrationHelper.applyEntityChain({ id: "1", qty: "5" }, [step1, step2]);

		expect(received?.quantity).toBe("5");
		expect(received?.qty).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// generateTargetName tests
// ---------------------------------------------------------------------------

describe("MigrationHelper.generateTargetName", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test("bounds the result to maxIdentifierLength using the head of a long base name", () => {
		const base = "a".repeat(200);
		const name = MigrationHelper.generateTargetName(base, 64);
		expect(name.length).toBe(64);
		expect(name.startsWith(base.slice(0, 43))).toBe(true);
	});

	test("still appends the marker and hash when the base name already fits", () => {
		const name = MigrationHelper.generateTargetName("t", 64);
		expect(name.startsWith("tMigration")).toBe(true);
		expect(name.length).toBe(22);
	});

	test("ends with the marker followed by a 12-character hex hash", () => {
		const name = MigrationHelper.generateTargetName("some-table", 64);
		expect(name).toMatch(/Migration[\da-f]{12}$/);
	});

	test("is deterministic for the same base name and clock, differs when the clock advances", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_700_000_000_000);
		const a = MigrationHelper.generateTargetName("my-table", 64);
		const b = MigrationHelper.generateTargetName("my-table", 64);
		expect(a).toBe(b);

		vi.setSystemTime(1_700_000_000_001);
		const c = MigrationHelper.generateTargetName("my-table", 64);
		expect(c).not.toBe(a);
	});

	test("never equals the base name it was derived from", () => {
		const base = "short";
		const name = MigrationHelper.generateTargetName(base, 64);
		expect(name).not.toBe(base);
	});

	test("rejects an empty base name, a non-integer max length, and a max length too small for the suffix", () => {
		expect(() => MigrationHelper.generateTargetName("", 64)).toThrow();
		expect(() => MigrationHelper.generateTargetName("table", 63.5)).toThrow();
		expect(() => MigrationHelper.generateTargetName("table", 21)).toThrow(
			expect.objectContaining({
				name: "GeneralError",
				message: "migrationHelper.maxIdentifierLengthTooSmall"
			})
		);
	});
});

// ---------------------------------------------------------------------------
// migrateWithChain tests
// ---------------------------------------------------------------------------

describe("MigrationHelper.migrateWithChain", () => {
	const v0Props = [
		{ property: "id", type: EntitySchemaPropertyType.String, isPrimary: true },
		{ property: "name", type: EntitySchemaPropertyType.String }
	] as unknown as IEntitySchemaProperty[];
	const v1Props = [
		{ property: "id", type: EntitySchemaPropertyType.String, isPrimary: true },
		{ property: "name", type: EntitySchemaPropertyType.String },
		{ property: "extra", type: EntitySchemaPropertyType.String, optional: true }
	] as unknown as IEntitySchemaProperty[];

	const singleStep: IResolvedMigrationStep = {
		fromProperties: v0Props,
		toProperties: v1Props
	};

	function makeTargetConnector(
		validate: boolean = false,
		partitionKeySeparator?: string
	): IEntityStorageConnector<{ [key: string]: unknown }> {
		const written: { [key: string]: unknown }[] = [];
		const schema = { type: "TargetSchema", properties: v1Props };
		const connector: IEntityStorageConnector<{ [key: string]: unknown }> = {
			className: () => "TargetStub",
			getSchema: vi.fn().mockReturnValue(schema),
			bootstrap: vi.fn().mockResolvedValue(true),
			start: vi.fn().mockResolvedValue(undefined),
			setBatch: vi.fn().mockImplementation(async (batch: { [key: string]: unknown }[]) => {
				if (validate) {
					for (const entity of batch) {
						EntityStorageHelper.prepareEntity(entity, schema);
					}
				}
				written.push(...batch);
			}),
			count: vi.fn().mockImplementation(async () => written.length),
			query: vi.fn().mockResolvedValue({ entities: written }),
			queryJoin: vi.fn().mockResolvedValue({ entities: written }),
			set: vi.fn(),
			get: vi.fn(),
			remove: vi.fn(),
			removeBatch: vi.fn(),
			empty: vi.fn()
		};
		if (Is.stringValue(partitionKeySeparator)) {
			connector.getPartitionKeySeparator = () => partitionKeySeparator;
		}
		return connector;
	}

	function makeSourceConnector(
		entities: { [key: string]: unknown }[],
		targetConnector: IEntityStorageConnector<{ [key: string]: unknown }>
	): IEntityStorageMigrationConnector<{ [key: string]: unknown }> {
		return {
			className: () => "SourceStub",
			connectorVersion: vi.fn().mockReturnValue(1),
			getSchema: vi.fn().mockReturnValue({ type: "SourceSchema", properties: v0Props }),
			bootstrap: vi.fn().mockResolvedValue(true),
			start: vi.fn().mockResolvedValue(undefined),
			query: vi.fn().mockResolvedValue({ entities }),
			queryJoin: vi.fn().mockResolvedValue({ entities }),
			count: vi.fn().mockResolvedValue(entities.length),
			set: vi.fn(),
			setBatch: vi.fn(),
			get: vi.fn(),
			remove: vi.fn(),
			removeBatch: vi.fn(),
			empty: vi.fn(),
			getPartitionContextIds: vi.fn().mockResolvedValue(undefined),
			createTargetConnector: vi.fn().mockResolvedValue(targetConnector),
			finalizeMigration: vi.fn().mockResolvedValue(targetConnector),
			cleanupMigration: vi.fn().mockResolvedValue(undefined)
		};
	}

	/**
	 * A source with one valid row in "partitionA" and one row missing "name" in "partitionB",
	 * for tests that need a failure attributable to a specific row in a specific partition.
	 * @param target The target connector, passed through to makeSourceConnector.
	 * @returns The source connector.
	 */
	function makeInvalidSecondPartitionSource(
		target: IEntityStorageConnector<{ [key: string]: unknown }>
	): IEntityStorageMigrationConnector<{ [key: string]: unknown }> {
		const source = makeSourceConnector([], target);
		vi.mocked(source.count).mockResolvedValue(1);
		vi.mocked(source.query).mockImplementation(async () => {
			const contextIds = await ContextIdStore.getContextIds();
			const invalid = contextIds?.[ContextIdKeys.Node] === "partitionB";
			return { entities: [invalid ? { id: "2" } : { id: "1", name: "Alice" }] };
		});
		return source;
	}

	test("migrates entities through a single step and returns the final connector", async () => {
		const target = makeTargetConnector();
		const source = makeSourceConnector([{ id: "1", name: "Alice" }], target);

		const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
			source,
			"TargetSchema",
			await source.getPartitionContextIds(),
			[singleStep]
		);

		expect(migrated).toBe(1);
		expect(finalConnector).toBe(target);
	});

	test("returns 0 migrated when the source is empty", async () => {
		const target = makeTargetConnector();
		const source = makeSourceConnector([], target);

		const { migrated } = await MigrationHelper.migrateWithChain(
			source,
			"TargetSchema",
			await source.getPartitionContextIds(),
			[singleStep]
		);

		expect(migrated).toBe(0);
	});

	test("calls onFinalizing after the copy and before finalizeMigration", async () => {
		const target = makeTargetConnector();
		const source = makeSourceConnector([{ id: "1", name: "Alice" }], target);
		const onFinalizing = vi.fn().mockResolvedValue(undefined);

		await MigrationHelper.migrateWithChain(
			source,
			"TargetSchema",
			await source.getPartitionContextIds(),
			[singleStep],
			{ onFinalizing }
		);

		expect(onFinalizing).toHaveBeenCalledTimes(1);
		expect(onFinalizing.mock.invocationCallOrder[0]).toBeGreaterThan(
			vi.mocked(target.setBatch).mock.invocationCallOrder[0]
		);
		expect(onFinalizing.mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(source.finalizeMigration).mock.invocationCallOrder[0]
		);
	});

	test("calls createTargetConnector with the target schema name", async () => {
		const target = makeTargetConnector();
		const source = makeSourceConnector([], target);

		await MigrationHelper.migrateWithChain(
			source,
			"TargetSchema",
			await source.getPartitionContextIds(),
			[singleStep]
		);

		expect(source.createTargetConnector).toHaveBeenCalledWith("TargetSchema");
	});

	test("calls finalizeMigration after all entities are written", async () => {
		const target = makeTargetConnector();
		const source = makeSourceConnector([{ id: "1", name: "Bob" }], target);

		await MigrationHelper.migrateWithChain(
			source,
			"TargetSchema",
			await source.getPartitionContextIds(),
			[singleStep]
		);

		expect(source.finalizeMigration).toHaveBeenCalledOnce();
	});

	test("wraps connector errors in a migrationFailed GeneralError", async () => {
		const target = makeTargetConnector();
		const source = makeSourceConnector([], target);
		vi.mocked(source.finalizeMigration).mockRejectedValue(new Error("store unavailable"));

		await expect(
			MigrationHelper.migrateWithChain(
				source,
				"TargetSchema",
				await source.getPartitionContextIds(),
				[singleStep]
			)
		).rejects.toThrow(GeneralError);
	});

	test("calls cleanupMigration when an error occurs after createTargetConnector", async () => {
		const target = makeTargetConnector();
		const source = makeSourceConnector([], target);
		vi.mocked(source.finalizeMigration).mockRejectedValue(new Error("boom"));

		await expect(
			MigrationHelper.migrateWithChain(
				source,
				"TargetSchema",
				await source.getPartitionContextIds(),
				[singleStep]
			)
		).rejects.toThrow();

		expect(source.cleanupMigration).toHaveBeenCalledWith(target, undefined, undefined);
	});

	test("aborts and cleans up when the target connector fails to bootstrap", async () => {
		const target = makeTargetConnector();
		if (Is.function(target.bootstrap)) {
			vi.mocked(target.bootstrap).mockResolvedValue(false);
		}
		const source = makeSourceConnector([{ id: "1", name: "Alice" }], target);

		await expect(
			MigrationHelper.migrateWithChain(
				source,
				"TargetSchema",
				await source.getPartitionContextIds(),
				[singleStep]
			)
		).rejects.toThrow(GeneralError);

		expect(target.setBatch).not.toHaveBeenCalled();
		expect(source.cleanupMigration).toHaveBeenCalledWith(target, undefined, undefined);
	});

	test("aborts when the source connector fails to bootstrap", async () => {
		const target = makeTargetConnector();
		const source = makeSourceConnector([{ id: "1", name: "Alice" }], target);
		if (Is.function(source.bootstrap)) {
			vi.mocked(source.bootstrap).mockResolvedValue(false);
		}

		await expect(
			MigrationHelper.migrateWithChain(
				source,
				"TargetSchema",
				await source.getPartitionContextIds(),
				[singleStep]
			)
		).rejects.toThrow(GeneralError);

		expect(target.setBatch).not.toHaveBeenCalled();
		expect(source.cleanupMigration).toHaveBeenCalledWith(target, undefined, undefined);
	});

	describe("partition handling", () => {
		beforeEach(() => {
			ContextIdHandlerFactory.register(ContextIdKeys.Node, () => new TestContextIdHandler());
		});

		afterEach(() => {
			ContextIdHandlerFactory.unregister(ContextIdKeys.Node);
		});

		test("expands short-form context ids in partitions to long form before passing to ContextIdStore.run", async () => {
			const target = makeTargetConnector();
			const source = makeSourceConnector([{ id: "1", name: "Alice" }], target);

			// Partitions carry short form - no "did:internal:" prefix - as real connectors
			// do: they store the short value produced by ContextIdHelper.shortCombined.
			let contextSeenByCount: IContextIds | undefined;
			vi.mocked(source.count).mockImplementation(async () => {
				contextSeenByCount = await ContextIdStore.getContextIds();
				ContextIdHelper.combinedContextKey(contextSeenByCount, [ContextIdKeys.Node]);
				return 1;
			});

			await MigrationHelper.migrateWithChain(
				source,
				"TargetSchema",
				[{ [ContextIdKeys.Node]: "shortNodeId" }],
				[singleStep]
			);

			expect(contextSeenByCount?.[ContextIdKeys.Node]).toBe(
				`${TestContextIdHandler.INTERNAL_PREFIX}shortNodeId`
			);
		});

		test("runs transformEntity inside the partition context", async () => {
			const target = makeTargetConnector();
			const source = makeSourceConnector([{ id: "1", name: "Alice" }], target);

			const seenNodes: (string | undefined)[] = [];
			const step: IResolvedMigrationStep = {
				fromProperties: v0Props,
				toProperties: v1Props,
				transformEntity: async entity => {
					const contextIds = await ContextIdStore.getContextIds();
					seenNodes.push(contextIds?.[ContextIdKeys.Node]);
					return entity;
				}
			};

			await MigrationHelper.migrateWithChain(
				source,
				"TargetSchema",
				[{ [ContextIdKeys.Node]: "partitionA" }, { [ContextIdKeys.Node]: "partitionB" }],
				[step]
			);

			expect(seenNodes).toEqual([
				`${TestContextIdHandler.INTERNAL_PREFIX}partitionA`,
				`${TestContextIdHandler.INTERNAL_PREFIX}partitionB`
			]);
		});

		test("runs a single pass with empty context when partitions is undefined (non-partitioned table)", async () => {
			const target = makeTargetConnector();
			const source = makeSourceConnector([{ id: "1", name: "Alice" }], target);

			// undefined = not partitioned: MigrationHelper runs one pass with empty context {}
			// so count() is called exactly once and no partition key is required.
			let contextSeenByCount: IContextIds | undefined;
			vi.mocked(source.count).mockImplementation(async () => {
				contextSeenByCount = await ContextIdStore.getContextIds();
				return 1;
			});

			const { migrated } = await MigrationHelper.migrateWithChain(
				source,
				"TargetSchema",
				await source.getPartitionContextIds(),
				[singleStep]
			);

			expect(migrated).toBe(1);
			expect(source.count).toHaveBeenCalledOnce();
			expect(contextSeenByCount).toEqual({});
		});

		test("skips all partition passes and migrates 0 entities when partitions is an empty array", async () => {
			const target = makeTargetConnector();
			const source = makeSourceConnector([], target);

			// An empty partitions array means the table is partitioned but has no data.
			// MigrationHelper skips the partition loop entirely so count() is never called -
			// avoiding the "contextIdMissing" error that would occur if we fell back to [{}]
			// and called count() without the required "node" key.
			const { migrated } = await MigrationHelper.migrateWithChain(
				source,
				"TargetSchema",
				[],
				[singleStep]
			);

			expect(migrated).toBe(0);
			expect(source.count).not.toHaveBeenCalled();
		});
	});

	test("migrates 0 entities and never calls count when partitions is an empty array", async () => {
		const target = makeTargetConnector();
		const source = makeSourceConnector([{ id: "1", name: "Alice" }], target);

		const { migrated } = await MigrationHelper.migrateWithChain(
			source,
			"TargetSchema",
			[],
			[singleStep]
		);

		expect(migrated).toBe(0);
		expect(source.count).not.toHaveBeenCalled();
	});

	test("migrates entities across all partitions when partitions is a non-empty array", async () => {
		const target = makeTargetConnector();
		const source = makeSourceConnector([{ id: "1", name: "Alice" }], target);

		// Two partitions (empty context objects - no handler registration needed).
		// source.count returns 1 and source.query returns 1 entity per partition pass,
		// so the total migrated count should equal partitions.length.
		const { migrated } = await MigrationHelper.migrateWithChain(
			source,
			"TargetSchema",
			[{}, {}],
			[singleStep]
		);

		expect(migrated).toBe(2);
		expect(source.count).toHaveBeenCalledTimes(2);
	});

	test("a chain of one step is equivalent to a single-step migration", async () => {
		const entities = Array.from({ length: 3 }, (e, i) => ({ id: String(i), name: `n${i}` }));
		const target = makeTargetConnector();
		const source = makeSourceConnector(entities, target);

		const { migrated } = await MigrationHelper.migrateWithChain(source, "TargetSchema", undefined, [
			singleStep
		]);

		expect(migrated).toBe(3);
	});

	test("names the partition and the row when a row fails validation on write", async () => {
		const target = makeTargetConnector(true);
		const source = makeInvalidSecondPartitionSource(target);

		await expect(
			MigrationHelper.migrateWithChain(
				source,
				"TargetSchema",
				[{ [ContextIdKeys.Node]: "partitionA" }, { [ContextIdKeys.Node]: "partitionB" }],
				[singleStep]
			)
		).rejects.toMatchObject({
			message: "migrationHelper.migrateSchemaFailed",
			properties: { schemaName: "TargetSchema", partitionId: "partitionB", id: "2" }
		});
	});

	test("the cause of a failed migration names the row and its partition", async () => {
		const target = makeTargetConnector(true);
		const source = makeInvalidSecondPartitionSource(target);

		const error = await MigrationHelper.migrateWithChain(
			source,
			"TargetSchema",
			[{ [ContextIdKeys.Node]: "partitionA" }, { [ContextIdKeys.Node]: "partitionB" }],
			[singleStep]
		).catch((caught: unknown) => caught);

		expect(BaseError.flatten(error)).toContainEqual(
			expect.objectContaining({
				message: "migrationHelper.migrateEntityPartitionFailed",
				properties: { partitionId: "partitionB", id: "2" }
			})
		);
	});

	test("names the row when a transform step rejects it", async () => {
		const target = makeTargetConnector();
		const source = makeSourceConnector(
			[
				{ id: "1", name: "Alice" },
				{ id: "2", name: "Bob" }
			],
			target
		);
		const step: IResolvedMigrationStep = {
			fromProperties: v0Props,
			toProperties: v1Props,
			transformEntity: async entity => {
				if ((entity as { id: string }).id === "2") {
					throw new GeneralError("TestStep", "rejectedRow");
				}
				return entity;
			}
		};

		await expect(
			MigrationHelper.migrateWithChain(
				source,
				"TargetSchema",
				[{ [ContextIdKeys.Node]: "partitionB" }],
				[step]
			)
		).rejects.toMatchObject({
			message: "migrationHelper.migrateSchemaFailed",
			properties: { schemaName: "TargetSchema", partitionId: "partitionB", id: "2" }
		});
	});

	test("names the row without a partition when the table is not partitioned", async () => {
		const target = makeTargetConnector(true);
		const source = makeSourceConnector([{ id: "2" }], target);

		const error = (await MigrationHelper.migrateWithChain(source, "TargetSchema", undefined, [
			singleStep
		]).catch((caught: unknown) => caught)) as GeneralError;

		expect(error.properties).toEqual({ schemaName: "TargetSchema", id: "2" });
		expect(BaseError.flatten(error)).toContainEqual(
			expect.objectContaining({
				message: "migrationHelper.migrateEntityFailed",
				properties: { id: "2" }
			})
		);
	});

	test("uses the connector's own separator to join a multi-key partition", async () => {
		const target = makeTargetConnector(true, ":");
		const source = makeSourceConnector([{ id: "2" }], target);

		const error = (await MigrationHelper.migrateWithChain(
			source,
			"TargetSchema",
			[{ [ContextIdKeys.Node]: "nodeA", [ContextIdKeys.Tenant]: "tenantB" }],
			[singleStep]
		).catch((caught: unknown) => caught)) as GeneralError;

		expect(error.properties).toEqual({
			schemaName: "TargetSchema",
			partitionId: "nodeA:tenantB",
			id: "2"
		});
	});

	test("a failure that is not attributable to a row still reports only the schema", async () => {
		const target = makeTargetConnector();
		const source = makeSourceConnector([], target);
		vi.mocked(source.finalizeMigration).mockRejectedValue(new Error("store unavailable"));

		const error = (await MigrationHelper.migrateWithChain(
			source,
			"TargetSchema",
			await source.getPartitionContextIds(),
			[singleStep]
		).catch((caught: unknown) => caught)) as GeneralError;

		expect(error.properties).toEqual({ schemaName: "TargetSchema" });
	});

	test("a write failure that is not a validation problem still reports only the schema, even with a valid row", async () => {
		const target = makeTargetConnector();
		target.setBatch = vi.fn().mockRejectedValue(new GeneralError("TargetStub", "writeFailed"));
		const source = makeSourceConnector([{ id: "1", name: "Alice" }], target);

		const error = (await MigrationHelper.migrateWithChain(
			source,
			"TargetSchema",
			await source.getPartitionContextIds(),
			[singleStep]
		).catch((caught: unknown) => caught)) as GeneralError;

		expect(error.properties).toEqual({ schemaName: "TargetSchema" });
		expect(BaseError.flatten(error)).toContainEqual(
			expect.objectContaining({ message: "targetStub.writeFailed" })
		);
	});

	test("logs the partition and the row alongside the schema name on a row failure", async () => {
		const target = makeTargetConnector(true);
		const source = makeInvalidSecondPartitionSource(target);
		const logSpy = vi.fn();
		ComponentFactory.register("test-logging", () => ({
			className: () => "TestLogging",
			log: logSpy
		}));

		try {
			await MigrationHelper.migrateWithChain(
				source,
				"TargetSchema",
				[{ [ContextIdKeys.Node]: "partitionA" }, { [ContextIdKeys.Node]: "partitionB" }],
				[singleStep],
				undefined,
				"test-logging"
			).catch(() => {});

			expect(logSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "migrateSchemaFailed",
					data: { schemaName: "TargetSchema", partitionId: "partitionB", id: "2" }
				})
			);
		} finally {
			ComponentFactory.unregister("test-logging");
		}
	});
});
