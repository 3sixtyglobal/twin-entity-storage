// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	ContextIdHandlerFactory,
	ContextIdHelper,
	ContextIdKeys,
	ContextIdStore,
	type IContextIds
} from "@twin.org/context";
import { GeneralError } from "@twin.org/core";
import {
	EntitySchemaPropertyType,
	type IEntitySchemaDiff,
	type IEntitySchemaProperty
} from "@twin.org/entity";
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

	test("copies unchanged properties from source entity", () => {
		const d = diff({
			unchanged: [
				prop("id", EntitySchemaPropertyType.String),
				prop("value", EntitySchemaPropertyType.String)
			]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ id: "1", value: "hello" },
			d
		);
		expect(result).toEqual({ id: "1", value: "hello" });
	});

	test("added non-optional boolean property defaults to false", () => {
		const d = diff({ added: [prop("active", EntitySchemaPropertyType.Boolean)] });
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({}, d);
		expect(result.active).toBe(false);
	});

	test("added non-optional number property defaults to 0", () => {
		const d = diff({ added: [prop("count", EntitySchemaPropertyType.Number)] });
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({}, d);
		expect(result.count).toBe(0);
	});

	test("added non-optional integer property defaults to 0", () => {
		const d = diff({ added: [prop("age", EntitySchemaPropertyType.Integer)] });
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({}, d);
		expect(result.age).toBe(0);
	});

	test("added non-optional string property defaults to empty string", () => {
		const d = diff({ added: [prop("name", EntitySchemaPropertyType.String)] });
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({}, d);
		expect(result.name).toBe("");
	});

	test("added non-optional array property defaults to []", () => {
		const d = diff({ added: [prop("tags", EntitySchemaPropertyType.Array)] });
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({}, d);
		expect(result.tags).toEqual([]);
	});

	test("added non-optional object property defaults to {}", () => {
		const d = diff({ added: [prop("meta", EntitySchemaPropertyType.Object)] });
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({}, d);
		expect(result.meta).toEqual({});
	});

	test("added non-optional string property uses defaultValue when provided", () => {
		const d = diff({
			added: [prop("status", EntitySchemaPropertyType.String, { defaultValue: "active" })]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({}, d);
		expect(result.status).toBe("active");
	});

	test("added non-optional integer property uses defaultValue when provided", () => {
		const d = diff({
			added: [prop("score", EntitySchemaPropertyType.Integer, { defaultValue: 42 })]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({}, d);
		expect(result.score).toBe(42);
	});

	test("added optional property defaults to undefined", () => {
		const d = diff({ added: [prop("note", EntitySchemaPropertyType.String, { optional: true })] });
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({}, d);
		expect(result.note).toBeUndefined();
	});

	test("removed property is not present in result", () => {
		const d = diff({
			unchanged: [prop("id", EntitySchemaPropertyType.String)],
			removed: [prop("legacy", EntitySchemaPropertyType.String)]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ id: "1", legacy: "old" },
			d
		);
		expect(result.legacy).toBeUndefined();
		expect(result.id).toBe("1");
	});

	test("modified property: string value coerced to boolean", () => {
		const d = diff({
			modified: [
				{
					from: prop("flag", EntitySchemaPropertyType.String),
					to: prop("flag", EntitySchemaPropertyType.Boolean)
				}
			]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ flag: "true" },
			d
		);
		expect(result.flag).toBe(true);
	});

	test("modified property: string value coerced to number", () => {
		const d = diff({
			modified: [
				{
					from: prop("qty", EntitySchemaPropertyType.String),
					to: prop("qty", EntitySchemaPropertyType.Number)
				}
			]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ qty: "42" },
			d
		);
		expect(result.qty).toBe(42);
	});

	test("modified property: string value coerced to integer", () => {
		const d = diff({
			modified: [
				{
					from: prop("qty", EntitySchemaPropertyType.String),
					to: prop("qty", EntitySchemaPropertyType.Integer)
				}
			]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ qty: "7" },
			d
		);
		expect(result.qty).toBe(7);
	});

	test("modified property: number value coerced to string", () => {
		const d = diff({
			modified: [
				{
					from: prop("code", EntitySchemaPropertyType.Number),
					to: prop("code", EntitySchemaPropertyType.String)
				}
			]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ code: 99 },
			d
		);
		expect(result.code).toBe("99");
	});

	test("modified property: array type without transformEntityProperty throws GeneralError", () => {
		const d = diff({
			modified: [
				{
					from: prop("data", EntitySchemaPropertyType.String),
					to: prop("data", EntitySchemaPropertyType.Array)
				}
			]
		});
		expect(() =>
			MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({ data: "raw" }, d)
		).toThrow(GeneralError);
	});

	test("modified property: object type without transformEntityProperty throws GeneralError", () => {
		const d = diff({
			modified: [
				{
					from: prop("meta", EntitySchemaPropertyType.String),
					to: prop("meta", EntitySchemaPropertyType.Object)
				}
			]
		});
		expect(() =>
			MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({ meta: "raw" }, d)
		).toThrow(GeneralError);
	});

	test("modified property: array type with transformEntityProperty uses the return value", () => {
		const d = diff({
			modified: [
				{
					from: prop("tags", EntitySchemaPropertyType.String),
					to: prop("tags", EntitySchemaPropertyType.Array)
				}
			]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ tags: "a,b,c" },
			d,
			(f, t, v) => (v as string).split(",")
		);
		expect(result.tags).toEqual(["a", "b", "c"]);
	});

	test("combination: unchanged, added, and removed properties all handled correctly", () => {
		const d = diff({
			unchanged: [prop("id", EntitySchemaPropertyType.String)],
			added: [prop("newField", EntitySchemaPropertyType.Number)],
			removed: [prop("old", EntitySchemaPropertyType.String)]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ id: "42", old: "gone" },
			d
		);
		expect(result.id).toBe("42");
		expect(result.newField).toBe(0);
		expect(result.old).toBeUndefined();
	});

	test("modified property: property renamed - value moved to new property name", () => {
		const d = diff({
			modified: [
				{
					from: prop("qty", EntitySchemaPropertyType.String),
					to: prop("quantity", EntitySchemaPropertyType.String)
				}
			]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ qty: "5" },
			d
		);
		expect(result.quantity).toBe("5");
		expect(result.qty).toBeUndefined();
	});

	test("modified property: missing source value on non-optional boolean target throws GeneralError", () => {
		const d = diff({
			modified: [
				{
					from: prop("flag", EntitySchemaPropertyType.String),
					to: prop("flag", EntitySchemaPropertyType.Boolean)
				}
			]
		});
		expect(() => MigrationHelper.applyEntityTransform({}, d)).toThrow(GeneralError);
	});

	test("modified property: missing source value on non-optional number target throws GeneralError", () => {
		const d = diff({
			modified: [
				{
					from: prop("qty", EntitySchemaPropertyType.String),
					to: prop("qty", EntitySchemaPropertyType.Number)
				}
			]
		});
		expect(() => MigrationHelper.applyEntityTransform({}, d)).toThrow(GeneralError);
	});

	test("modified property: missing source value on non-optional string target throws GeneralError", () => {
		const d = diff({
			modified: [
				{
					from: prop("name", EntitySchemaPropertyType.Number),
					to: prop("name", EntitySchemaPropertyType.String)
				}
			]
		});
		expect(() => MigrationHelper.applyEntityTransform({}, d)).toThrow(GeneralError);
	});

	test("modified property: missing source value on optional target is allowed through as undefined", () => {
		const d = diff({
			modified: [
				{
					from: prop("note", EntitySchemaPropertyType.Number),
					to: prop("note", EntitySchemaPropertyType.String, { optional: true })
				}
			]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>({}, d);
		expect(result.note).toBeUndefined();
	});

	// ---
	// Issue #185 Bug 2 - "added" properties must preserve existing source values
	// ---

	test("added non-optional string property preserves existing source value over empty-string default", () => {
		const d = diff({ added: [prop("organizationId", EntitySchemaPropertyType.String)] });
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ id: "1", organizationId: "org-abc" },
			d
		);
		expect(result.organizationId).toBe("org-abc");
	});

	test("added non-optional string property preserves existing source value over provided defaultValue", () => {
		const d = diff({
			added: [prop("status", EntitySchemaPropertyType.String, { defaultValue: "active" })]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ status: "custom" },
			d
		);
		expect(result.status).toBe("custom");
	});

	test("added non-optional boolean property preserves existing source value over boolean default", () => {
		const d = diff({ added: [prop("active", EntitySchemaPropertyType.Boolean)] });
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ active: true },
			d
		);
		expect(result.active).toBe(true);
	});

	test("added non-optional number property preserves existing source value over zero default", () => {
		const d = diff({ added: [prop("count", EntitySchemaPropertyType.Number)] });
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
			{ count: 42 },
			d
		);
		expect(result.count).toBe(42);
	});

	test("unchanged property absent from entity is copied as undefined", () => {
		const d = diff({
			unchanged: [
				prop("id", EntitySchemaPropertyType.String),
				prop("optional", EntitySchemaPropertyType.String, { optional: true })
			]
		});
		const result = MigrationHelper.applyEntityTransform<ITransformEntity, ITransformEntity>(
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

	test("returns entity unchanged when steps list is empty", () => {
		const entity: { [key: string]: unknown } = { id: "1", name: "Alice" };
		const result = MigrationHelper.applyEntityChain(entity, []);
		expect(result).toEqual(entity);
	});

	test("applies a single step - adds a new optional field", () => {
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
		const result = MigrationHelper.applyEntityChain({ id: "1", name: "Alice" }, [step]) as {
			[key: string]: unknown;
		};
		expect(result.id).toBe("1");
		expect(result.name).toBe("Alice");
		expect(result.extra).toBeUndefined();
	});

	test("applies a single step - adds a new required string field with default", () => {
		const step: IResolvedMigrationStep = {
			fromProperties: makeProps(["id", EntitySchemaPropertyType.String]),
			toProperties: [
				{ property: "id", type: EntitySchemaPropertyType.String },
				{ property: "status", type: EntitySchemaPropertyType.String, defaultValue: "active" }
			] as unknown as IEntitySchemaProperty[]
		};
		const result = MigrationHelper.applyEntityChain({ id: "x" }, [step]) as {
			[key: string]: unknown;
		};
		expect(result.status).toBe("active");
	});

	test("applies multiple steps in sequence - each step's output feeds the next", () => {
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

		const result = MigrationHelper.applyEntityChain({ id: "x" }, [step1, step2]) as {
			[key: string]: unknown;
		};

		expect(result.id).toBe("x");
		expect(result.count).toBe(0);
		expect(result.label).toBe("");
	});

	test("applies a rename via the renames option on the step", () => {
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
		const result = MigrationHelper.applyEntityChain({ id: "1", qty: "5" }, [step]) as {
			[key: string]: unknown;
		};
		expect(result.quantity).toBe("5");
		expect(result.qty).toBeUndefined();
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

	function makeTargetConnector(): IEntityStorageConnector<{ [key: string]: unknown }> {
		const written: { [key: string]: unknown }[] = [];
		return {
			className: () => "TargetStub",
			getSchema: vi.fn().mockReturnValue({ type: "TargetSchema", properties: v1Props }),
			bootstrap: vi.fn().mockResolvedValue(undefined),
			start: vi.fn().mockResolvedValue(undefined),
			setBatch: vi.fn().mockImplementation(async (batch: { [key: string]: unknown }[]) => {
				written.push(...batch);
			}),
			count: vi.fn().mockImplementation(async () => written.length),
			query: vi.fn().mockResolvedValue({ entities: written }),
			set: vi.fn(),
			get: vi.fn(),
			remove: vi.fn(),
			removeBatch: vi.fn(),
			empty: vi.fn()
		};
	}

	function makeSourceConnector(
		entities: { [key: string]: unknown }[],
		targetConnector: IEntityStorageConnector<{ [key: string]: unknown }>
	): IEntityStorageMigrationConnector<{ [key: string]: unknown }> {
		return {
			className: () => "SourceStub",
			connectorVersion: vi.fn().mockReturnValue(1),
			getSchema: vi.fn().mockReturnValue({ type: "SourceSchema", properties: v0Props }),
			bootstrap: vi.fn().mockResolvedValue(undefined),
			start: vi.fn().mockResolvedValue(undefined),
			query: vi.fn().mockResolvedValue({ entities }),
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
});
