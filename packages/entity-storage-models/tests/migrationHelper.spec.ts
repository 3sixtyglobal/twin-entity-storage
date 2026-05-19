// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IContextIds } from "@twin.org/context";
import { GeneralError } from "@twin.org/core";
import {
	EntitySchemaFactory,
	EntitySchemaPropertyType,
	type IEntitySchema,
	type IEntitySchemaDiff,
	type IEntitySchemaProperty
} from "@twin.org/entity";
import { MigrationHelper } from "../src/helpers/migrationHelper.js";
import type { IEntityStorageConnector } from "../src/models/IEntityStorageConnector.js";
import type { IEntityStorageMigrationConnector } from "../src/models/IEntityStorageMigrationConnector.js";

// ---------------------------------------------------------------------------
// Minimal stub connector used by migratePartition / migrate tests
// ---------------------------------------------------------------------------

interface ITestEntity {
	id: string;
	value: string;
}

function makeConnector(entities: ITestEntity[]): IEntityStorageMigrationConnector<ITestEntity> {
	let store = [...entities];

	return {
		CLASS_NAME: "StubConnector",
		getSchema: () => ({ type: "TestEntity" }) as IEntitySchema,
		bootstrap: async () => {},
		set: async (entity: ITestEntity) => {
			const idx = store.findIndex(e => e.id === entity.id);
			if (idx >= 0) {
				store[idx] = entity;
			} else {
				store.push(entity);
			}
		},
		setBatch: async (batch: ITestEntity[]) => {
			for (const entity of batch) {
				const idx = store.findIndex(e => e.id === entity.id);
				if (idx >= 0) {
					store[idx] = entity;
				} else {
					store.push(entity);
				}
			}
		},
		get: async (id: string) => store.find(e => e.id === id),
		remove: async (id: string) => {
			store = store.filter(e => e.id !== id);
		},
		removeBatch: async (ids: string[]) => {
			store = store.filter(e => !ids.includes(e.id));
		},
		query: async (
			_conditions: unknown,
			_sort: unknown,
			_props: unknown,
			cursor: string | undefined,
			limit = 100
		) => {
			const start = cursor ? Number.parseInt(cursor, 10) : 0;
			const slice = store.slice(start, start + limit);
			const nextCursor = start + limit < store.length ? String(start + limit) : undefined;
			return { entities: slice as Partial<ITestEntity>[], cursor: nextCursor };
		},
		empty: async () => {
			store = [];
		},
		count: async () => store.length
	} as unknown as IEntityStorageMigrationConnector<ITestEntity>;
}

// ---------------------------------------------------------------------------
// applyEntityTransform tests
// ---------------------------------------------------------------------------

// String-indexed entity so keyof resolves to string, accepting any property name.
interface ITransformEntity {
	[key: string]: unknown;
}

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
			{
				transformEntityProperty: (_f, _t, v) => (v as string).split(",")
			}
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

	test("modified property: property renamed — value moved to new property name", () => {
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
// migratePartition tests
// ---------------------------------------------------------------------------

describe("MigrationHelper.migratePartition", () => {
	const emptyDiff: IEntitySchemaDiff<ITestEntity, ITestEntity> = {
		unchanged: [
			{ property: "id", type: EntitySchemaPropertyType.String, isPrimary: true },
			{ property: "value", type: EntitySchemaPropertyType.String }
		],
		added: [],
		removed: [],
		modified: []
	};

	test("migrates all entities from source to target", async () => {
		const source = makeConnector([
			{ id: "1", value: "a" },
			{ id: "2", value: "b" }
		]);
		const target = makeConnector([]);

		const count = await MigrationHelper.migratePartition(source, target, 1, 0, emptyDiff);

		expect(count).toBe(2);
		expect(await target.count()).toBe(2);
	});

	test("returns 0 when source is empty", async () => {
		const source = makeConnector([]);
		const target = makeConnector([]);

		const count = await MigrationHelper.migratePartition(source, target, 1, 0, emptyDiff);

		expect(count).toBe(0);
	});

	test("respects batchSize by paginating across multiple batches", async () => {
		const entities = Array.from({ length: 5 }, (_, i) => ({ id: String(i), value: `v${i}` }));
		const source = makeConnector(entities);
		const target = makeConnector([]);

		const count = await MigrationHelper.migratePartition(source, target, 1, 0, emptyDiff, {
			batchSize: 2
		});

		expect(count).toBe(5);
		expect(await target.count()).toBe(5);
	});

	test("calls onProgress with correct arguments", async () => {
		const source = makeConnector([
			{ id: "1", value: "a" },
			{ id: "2", value: "b" }
		]);
		const target = makeConnector([]);

		const calls: [number, number][] = [];
		await MigrationHelper.migratePartition(source, target, 3, 1, emptyDiff, {
			onPartitionProgress: async (rt, ri) => {
				calls.push([rt, ri]);
			}
		});

		// First call: count() runs first, so rowTotal is known; rowIndex is 0
		expect(calls[0]).toEqual([2, 0]);
		// Final call after processing the batch
		expect(calls[calls.length - 1][0]).toBe(2); // rowTotal
		expect(calls[calls.length - 1][1]).toBe(2); // rowIndex
	});

	test("onProgress rowTotal is consistent and rowIndex increments across multiple batches", async () => {
		const entities = Array.from({ length: 5 }, (_, i) => ({ id: String(i), value: `v${i}` }));
		const source = makeConnector(entities);
		const target = makeConnector([]);

		const calls: [number, number][] = [];
		await MigrationHelper.migratePartition(source, target, 1, 0, emptyDiff, {
			batchSize: 2,
			onPartitionProgress: async (rt, ri) => {
				calls.push([rt, ri]);
			}
		});

		// Initial call: count() runs first, so rowTotal (5) is already known; rowIndex is 0
		expect(calls[0]).toEqual([5, 0]);
		// 3 post-batch calls: batches of 2, 2, 1
		const postBatch = calls.slice(1);
		expect(postBatch).toHaveLength(3);
		for (const call of postBatch) {
			expect(call[0]).toBe(5); // source.count() is constant throughout
		}
		expect(postBatch[0][1]).toBe(2);
		expect(postBatch[1][1]).toBe(4);
		expect(postBatch[2][1]).toBe(5);
	});

	test("setBatch failure propagates the error out of migratePartition", async () => {
		const entities = Array.from({ length: 4 }, (_, i) => ({ id: String(i), value: `v${i}` }));
		const source = makeConnector(entities);

		let batchCallCount = 0;
		const failingTarget = {
			setBatch: async (_batch: ITestEntity[]) => {
				batchCallCount++;
				if (batchCallCount >= 2) {
					throw new Error("simulated setBatch failure");
				}
			}
		} as unknown as IEntityStorageConnector<ITestEntity>;

		await expect(
			MigrationHelper.migratePartition(source, failingTarget, 1, 0, emptyDiff, { batchSize: 2 })
		).rejects.toThrow("simulated setBatch failure");

		expect(batchCallCount).toBe(2);
	});

	test("applies schema diff: added field appears with default on migrated entities", async () => {
		const source = makeConnector([{ id: "1", value: "hello" }]);
		const target = makeConnector([]);

		const diffWithAdded: IEntitySchemaDiff<ITestEntity, ITestEntity> = {
			unchanged: [{ property: "id", type: EntitySchemaPropertyType.String, isPrimary: true }],
			added: [{ property: "value", type: EntitySchemaPropertyType.String }],
			removed: [],
			modified: []
		};

		const count = await MigrationHelper.migratePartition(source, target, 1, 0, diffWithAdded);

		expect(count).toBe(1);
		const result = await target.get("1");
		// value is in "added" with non-optional string → should default to ""
		expect(result?.value).toBe("");
	});
});

// ---------------------------------------------------------------------------
// migrate (top-level) tests
// ---------------------------------------------------------------------------

describe("MigrationHelper.migrate", () => {
	const migrationSchemaName = "MigrationTestSchema";

	const emptyDiff: IEntitySchemaDiff<ITestEntity, ITestEntity> = {
		unchanged: [
			{ property: "id", type: EntitySchemaPropertyType.String, isPrimary: true },
			{ property: "value", type: EntitySchemaPropertyType.String }
		],
		added: [],
		removed: [],
		modified: []
	};

	const singlePartition: IContextIds[] = [{ tenantId: "tenant-1" }];

	test("migrates entities across a single partition", async () => {
		const source = makeConnector([{ id: "1", value: "x" }]);
		const target = makeConnector([]);

		const total = await MigrationHelper.migrateEntities(source, target, singlePartition, emptyDiff);

		expect(total).toBe(1);
	});

	test("returns summed count across multiple partitions", async () => {
		const source = makeConnector([
			{ id: "1", value: "a" },
			{ id: "2", value: "b" }
		]);
		const target = makeConnector([]);

		const partitions: IContextIds[] = [{ tenantId: "tenant-1" }, { tenantId: "tenant-2" }];

		const total = await MigrationHelper.migrateEntities(source, target, partitions, emptyDiff);

		// 2 entities × 2 partitions = 4 total migration operations
		expect(total).toBe(4);
	});

	test("unregisters schema name after migration completes", async () => {
		const source = makeConnector([]);
		const target = makeConnector([]);

		await MigrationHelper.migrateEntities(source, target, singlePartition, emptyDiff);

		expect(() => EntitySchemaFactory.get(migrationSchemaName)).toThrow();
	});

	test("calls onProgress with initial 0/0/0/0 call before partitions", async () => {
		const source = makeConnector([]);
		const target = makeConnector([]);

		const firstCall: number[] = [];
		await MigrationHelper.migrateEntities(source, target, singlePartition, emptyDiff, {
			onPartitionProgress: async (rt, ri) => {
				if (firstCall.length === 0) {
					firstCall.push(rt, ri);
				}
			}
		});

		expect(firstCall).toEqual([0, 0]);
	});

	test("unregisters schema name even when migration throws", async () => {
		const source = makeConnector([{ id: "1", value: "test" }]);
		const target = makeConnector([]);

		// Diff that requires transformEntityProperty but none is supplied
		const badDiff: IEntitySchemaDiff<ITestEntity, ITestEntity> = {
			unchanged: [],
			added: [],
			removed: [],
			modified: [
				{
					from: { property: "value", type: EntitySchemaPropertyType.String },
					to: { property: "value", type: EntitySchemaPropertyType.Array }
				}
			]
		};

		await expect(
			MigrationHelper.migrateEntities(source, target, singlePartition, badDiff)
		).rejects.toThrow(GeneralError);

		expect(() => EntitySchemaFactory.get(migrationSchemaName)).toThrow();
	});

	test("when partitions array is empty a default partition is created and the migration loop fires", async () => {
		const source = makeConnector([
			{ id: "1", value: "x" },
			{ id: "2", value: "y" }
		]);
		const target = makeConnector([]);

		const total = await MigrationHelper.migrateEntities(source, target, [], emptyDiff);

		expect(total).toBe(2);
		expect(await target.count()).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// MigrationHelper.migrate (full lifecycle) tests
// ---------------------------------------------------------------------------

describe("MigrationHelper.migrate (full lifecycle)", () => {
	const testSchema = {
		type: "TestEntity",
		properties: [
			{ property: "id", type: EntitySchemaPropertyType.String, isPrimary: true },
			{ property: "value", type: EntitySchemaPropertyType.String }
		]
	};

	// Target schema adds an optional field so EntitySchemaDiffHelper.hasChanges returns true,
	// allowing the full migration path to be exercised.
	const targetTestSchema = {
		type: "TestEntity",
		properties: [
			{ property: "id", type: EntitySchemaPropertyType.String, isPrimary: true },
			{ property: "value", type: EntitySchemaPropertyType.String },
			{ property: "extra", type: EntitySchemaPropertyType.String, optional: true }
		]
	};

	type SpyFn = ReturnType<typeof vi.fn>;

	interface ITargetStub {
		connector: IEntityStorageConnector<ITestEntity>;
		bootstrap: SpyFn;
		start: SpyFn;
	}

	interface IMigrationStub {
		connector: IEntityStorageMigrationConnector<ITestEntity>;
		bootstrap: SpyFn;
		start: SpyFn;
		createTargetConnector: SpyFn;
		finalizeMigration: SpyFn;
		cleanupMigration: SpyFn;
		getPartitionContextIds: SpyFn;
	}

	// Return spy references alongside the connector to avoid non-null assertions in tests.
	function makeTargetStub(entities: ITestEntity[]): ITargetStub {
		const bootstrap = vi.fn().mockResolvedValue(undefined);
		const start = vi.fn().mockResolvedValue(undefined);
		const connector: IEntityStorageConnector<ITestEntity> = {
			...makeConnector(entities),
			bootstrap,
			start,
			getSchema: vi.fn().mockReturnValue(targetTestSchema)
		};
		return { connector, bootstrap, start };
	}

	function makeMigrationStub(
		entities: ITestEntity[],
		targetConnector: IEntityStorageConnector<ITestEntity>
	): IMigrationStub {
		const bootstrap = vi.fn().mockResolvedValue(undefined);
		const start = vi.fn().mockResolvedValue(undefined);
		const createTargetConnector = vi.fn().mockResolvedValue(targetConnector);
		const finalizeMigration = vi.fn().mockResolvedValue(targetConnector);
		const cleanupMigration = vi.fn().mockResolvedValue(undefined);
		const getPartitionContextIds = vi.fn().mockResolvedValue([{ tenantId: "tenant-1" }]);
		const connector: IEntityStorageMigrationConnector<ITestEntity> = {
			...makeConnector(entities),
			bootstrap,
			start,
			getSchema: vi.fn().mockReturnValue(testSchema),
			getPartitionContextIds,
			createTargetConnector,
			finalizeMigration,
			cleanupMigration
		};
		return {
			connector,
			bootstrap,
			start,
			createTargetConnector,
			finalizeMigration,
			cleanupMigration,
			getPartitionContextIds
		};
	}

	test("returns migrated count and target connector", async () => {
		const { connector: target } = makeTargetStub([]);
		const { connector: source } = makeMigrationStub(
			[
				{ id: "1", value: "a" },
				{ id: "2", value: "b" }
			],
			target
		);

		const result = await MigrationHelper.migrate(source, "TargetSchema");

		expect(result.migrated).toBe(2);
		expect(result.finalConnector).toBe(target);
	});

	test("returns 0 migrated when source is empty", async () => {
		const { connector: target } = makeTargetStub([]);
		const { connector: source } = makeMigrationStub([], target);

		const result = await MigrationHelper.migrate(source, "TargetSchema");

		expect(result.migrated).toBe(0);
	});

	test("calls bootstrap and start on source connector", async () => {
		const { connector: target } = makeTargetStub([]);
		const { connector: source, bootstrap, start } = makeMigrationStub([], target);

		await MigrationHelper.migrate(source, "TargetSchema");

		expect(bootstrap).toHaveBeenCalledOnce();
		expect(start).toHaveBeenCalledOnce();
	});

	test("calls bootstrap and start on target connector", async () => {
		const {
			connector: target,
			bootstrap: targetBootstrap,
			start: targetStart
		} = makeTargetStub([]);
		const { connector: source } = makeMigrationStub([], target);

		await MigrationHelper.migrate(source, "TargetSchema");

		expect(targetBootstrap).toHaveBeenCalledOnce();
		expect(targetStart).toHaveBeenCalledOnce();
	});

	test("calls source.createTargetConnector with targetEntitySchemaName", async () => {
		const { connector: target } = makeTargetStub([]);
		const { connector: source, createTargetConnector } = makeMigrationStub([], target);

		await MigrationHelper.migrate(source, "TargetSchema");

		expect(createTargetConnector).toHaveBeenCalledWith("TargetSchema");
	});

	test("calls finalizeMigration on source with the target connector, options, and loggingComponentType", async () => {
		const { connector: target } = makeTargetStub([]);
		const { connector: source, finalizeMigration } = makeMigrationStub([], target);

		await MigrationHelper.migrate(source, "TargetSchema");

		expect(finalizeMigration).toHaveBeenCalledOnce();
		expect(finalizeMigration).toHaveBeenCalledWith(target, undefined, undefined);
	});

	test("passes loggingComponentType to bootstrap and start on both connectors", async () => {
		const {
			connector: target,
			bootstrap: targetBootstrap,
			start: targetStart
		} = makeTargetStub([]);
		const {
			connector: source,
			bootstrap: sourceBootstrap,
			start: sourceStart
		} = makeMigrationStub([], target);
		const loggingType = "test-logger";

		await MigrationHelper.migrate(source, "TargetSchema", undefined, undefined, loggingType);

		expect(sourceBootstrap).toHaveBeenCalledWith(loggingType);
		expect(sourceStart).toHaveBeenCalledWith(loggingType);
		expect(targetBootstrap).toHaveBeenCalledWith(loggingType);
		expect(targetStart).toHaveBeenCalledWith(loggingType);
	});

	test("wraps connector errors in GeneralError", async () => {
		const { connector: target } = makeTargetStub([]);
		const { connector: source, getPartitionContextIds } = makeMigrationStub([], target);
		getPartitionContextIds.mockRejectedValue(new Error("store unavailable"));

		await expect(MigrationHelper.migrate(source, "TargetSchema")).rejects.toThrow(GeneralError);
	});

	test("cleanupMigration is called with the target connector when migration throws after createTargetConnector", async () => {
		const { connector: target } = makeTargetStub([]);
		const {
			connector: source,
			cleanupMigration,
			getPartitionContextIds
		} = makeMigrationStub([], target);
		getPartitionContextIds.mockRejectedValue(new Error("store unavailable"));

		await expect(MigrationHelper.migrate(source, "TargetSchema")).rejects.toThrow(GeneralError);

		expect(cleanupMigration).toHaveBeenCalledOnce();
		expect(cleanupMigration).toHaveBeenCalledWith(target, undefined, undefined);
	});

	test("cleanupMigration is called with undefined target when createTargetConnector itself throws", async () => {
		const { connector: target } = makeTargetStub([]);
		const {
			connector: source,
			cleanupMigration,
			createTargetConnector
		} = makeMigrationStub([], target);
		createTargetConnector.mockRejectedValue(new Error("cannot create target"));

		await expect(MigrationHelper.migrate(source, "TargetSchema")).rejects.toThrow(GeneralError);

		expect(cleanupMigration).toHaveBeenCalledOnce();
		expect(cleanupMigration).toHaveBeenCalledWith(undefined, undefined, undefined);
	});

	test("migrates all entities correctly when batchSize is smaller than entity count", async () => {
		const entities: ITestEntity[] = Array.from({ length: 5 }, (_, i) => ({
			id: String(i),
			value: `v${i}`
		}));
		const { connector: target } = makeTargetStub([]);
		const { connector: source } = makeMigrationStub(entities, target);

		const result = await MigrationHelper.migrate(source, "TargetSchema", undefined, {
			batchSize: 2
		});

		expect(result.migrated).toBe(5);
	});
});
