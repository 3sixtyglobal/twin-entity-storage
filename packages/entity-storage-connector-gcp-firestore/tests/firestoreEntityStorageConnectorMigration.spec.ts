// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore, type IContextIds } from "@twin.org/context";
import { ComponentFactory } from "@twin.org/core";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@twin.org/entity";
import {
	MigrationHelper,
	type IEntityStorageConnector,
	type IEntityStorageMigrationConnector,
	type IResolvedMigrationStep
} from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";
import { TEST_FIRESTORE_CONFIG } from "./setupTestEnv.js";
import { FirestoreEntityStorageConnector } from "../src/firestoreEntityStorageConnector.js";

// These tests are duplicated across all connectors, if you modify anything make sure to apply
// to all other connectors as well, to keep them in sync.
// createConnectors it the only code that should differ

/**
 * Partition/migration V1 entity - used for both getPartitionContextIds and migration tests.
 */
@entity()
class MigV1 {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public legacyField!: string;
}

/**
 * V2 migration entity - drops legacyField, adds optional newField.
 */
@entity()
class MigV2 {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", optional: true })
	public newField?: string;
}

/**
 * V3 migration entity - changes legacyField type from string to integer.
 */
@entity()
class MigV3TypeChange {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "integer" })
	public legacyField!: number;
}

/**
 * V1 with a plain string info field - used to test transformEntityProperty for object target types.
 */
@entity()
class MigV1WithStr {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public info!: string;
}

/**
 * V2 with an object info field - changing from string triggers the transformEntityProperty requirement.
 */
@entity()
class MigV2WithObj {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "object" })
	public info!: object;
}

/**
 * Optional-field variant of MigV3TypeChange - legacyField is integer but optional.
 */
@entity()
class MigV3OptionalTypeChange {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "integer", optional: true })
	public legacyField?: number;
}

/**
 * Minimal source entity with only the primary key - used to test added-field defaults.
 */
@entity()
class MigJustId {
	@property({ type: "string", isPrimary: true })
	public id!: string;
}

/**
 * Target entity with one non-optional field for every primitive schema type.
 * All fields are added during migration, testing each type's default value.
 */
@entity()
class MigAllAddedDefaults {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "boolean" })
	public boolField!: boolean;

	@property({ type: "integer" })
	public intField!: number;

	@property({ type: "number" })
	public numField!: number;

	@property({ type: "string" })
	public strField!: string;

	@property({ type: "array" })
	public arrField!: unknown[];

	@property({ type: "object" })
	public objField!: object;
}

/**
 * V3 entity - changes legacyField type from string to boolean.
 */
@entity()
class MigV3BoolChange {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "boolean" })
	public legacyField!: boolean;
}

/**
 * V3 entity - changes legacyField type from integer to string.
 */
@entity()
class MigV3ToStr {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public legacyField!: string;
}

/**
 * Multi-field source entity - used to test multiple field renames in one migration.
 */
@entity()
class MigMultiFieldA {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public fieldA!: string;

	@property({ type: "string" })
	public fieldB!: string;
}

/**
 * Multi-field target entity - fieldA and fieldB are renamed.
 */
@entity()
class MigMultiFieldB {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public renamedA!: string;

	@property({ type: "string" })
	public renamedB!: string;
}

let currentUser = "user";
let currentConnector: IEntityStorageMigrationConnector | undefined;
const originalMigrateWithChain = MigrationHelper.migrateWithChain.bind(MigrationHelper);
let trackedConnectors: IEntityStorageConnector[] = [];

// Swap this factory to run these tests against a different connector implementation.
// It receives the entity schema name, optional partition context ids and an optional
// storage id, and must return a fresh, bootstrapped IEntityStorageMigrationConnector
// configured for those settings. Calls sharing a storageId must resolve to the same
// underlying storage.
let createConnector: (
	entitySchema: string,
	partitionContextIds?: string[],
	storageId?: string
) => Promise<IEntityStorageMigrationConnector>;

describe("FirestoreEntityStorageConnector - partitioning and migration", () => {
	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<MigV1>(), () => EntitySchemaHelper.getSchema(MigV1));
		EntitySchemaFactory.register(nameof<MigV2>(), () => EntitySchemaHelper.getSchema(MigV2));
		EntitySchemaFactory.register(nameof<MigV3TypeChange>(), () =>
			EntitySchemaHelper.getSchema(MigV3TypeChange)
		);
		EntitySchemaFactory.register(nameof<MigV1WithStr>(), () =>
			EntitySchemaHelper.getSchema(MigV1WithStr)
		);
		EntitySchemaFactory.register(nameof<MigV2WithObj>(), () =>
			EntitySchemaHelper.getSchema(MigV2WithObj)
		);
		EntitySchemaFactory.register(nameof<MigV3OptionalTypeChange>(), () =>
			EntitySchemaHelper.getSchema(MigV3OptionalTypeChange)
		);
		EntitySchemaFactory.register(nameof<MigJustId>(), () =>
			EntitySchemaHelper.getSchema(MigJustId)
		);
		EntitySchemaFactory.register(nameof<MigAllAddedDefaults>(), () =>
			EntitySchemaHelper.getSchema(MigAllAddedDefaults)
		);
		EntitySchemaFactory.register(nameof<MigV3BoolChange>(), () =>
			EntitySchemaHelper.getSchema(MigV3BoolChange)
		);
		EntitySchemaFactory.register(nameof<MigV3ToStr>(), () =>
			EntitySchemaHelper.getSchema(MigV3ToStr)
		);
		EntitySchemaFactory.register(nameof<MigMultiFieldA>(), () =>
			EntitySchemaHelper.getSchema(MigMultiFieldA)
		);
		EntitySchemaFactory.register(nameof<MigMultiFieldB>(), () =>
			EntitySchemaHelper.getSchema(MigMultiFieldB)
		);

		createConnector = async (entitySchema, partitionContextIds, storageId) => {
			currentConnector = new FirestoreEntityStorageConnector({
				entitySchema,
				partitionContextIds,
				config: {
					...TEST_FIRESTORE_CONFIG,
					collectionName: `${TEST_FIRESTORE_CONFIG.collectionName}_${storageId ?? Date.now()}`
				}
			});
			await currentConnector.bootstrap?.();
			trackedConnectors.push(currentConnector);
			return currentConnector;
		};

		ContextIdStore.getContextIds = vi
			.fn()
			.mockImplementation(() => ({ node: "node", tenant: "tenant", user: currentUser }));
	});

	afterEach(async () => {
		currentUser = "user";

		for (const connector of trackedConnectors) {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
		}
		trackedConnectors = [];
	});

	describe("getPartitionContextIds", () => {
		test("returns empty array when the store is empty", async () => {
			const entityStorage = (await createConnector(nameof<MigV1>(), [
				"node",
				"tenant",
				"user"
			])) as IEntityStorageMigrationConnector<MigV1>;
			const result = await entityStorage.getPartitionContextIds();
			expect(result).toEqual([]);
		});

		test("returns undefined when no partition context ids are configured", async () => {
			const entityStorage = (await createConnector(
				nameof<MigV1>()
			)) as IEntityStorageMigrationConnector<MigV1>;
			await entityStorage.set({ id: "1", legacyField: "a" });
			await entityStorage.set({ id: "2", legacyField: "b" });
			const result = await entityStorage.getPartitionContextIds();
			expect(result).toBeUndefined();
		});

		test("returns a single entry when all entities share the same partition", async () => {
			const entityStorage = (await createConnector(nameof<MigV1>(), [
				"node",
				"tenant",
				"user"
			])) as IEntityStorageMigrationConnector<MigV1>;
			currentUser = "user1";
			await entityStorage.set({ id: "1", legacyField: "a" });
			await entityStorage.set({ id: "2", legacyField: "b" });
			await entityStorage.set({ id: "3", legacyField: "c" });
			const result = await entityStorage.getPartitionContextIds();
			expect(result).toHaveLength(1);
			expect((result as IContextIds[])[0]).toEqual({
				node: "node",
				tenant: "tenant",
				user: "user1"
			});
		});

		test("returns one entry per unique partition", async () => {
			const entityStorage = (await createConnector(nameof<MigV1>(), [
				"node",
				"tenant",
				"user"
			])) as IEntityStorageMigrationConnector<MigV1>;
			currentUser = "user1";
			await entityStorage.set({ id: "1", legacyField: "a" });
			currentUser = "user2";
			await entityStorage.set({ id: "2", legacyField: "b" });
			currentUser = "user3";
			await entityStorage.set({ id: "3", legacyField: "c" });
			const result = await entityStorage.getPartitionContextIds();
			expect(result).toHaveLength(3);
			expect(result).toEqual(
				expect.arrayContaining([
					{ node: "node", tenant: "tenant", user: "user1" },
					{ node: "node", tenant: "tenant", user: "user2" },
					{ node: "node", tenant: "tenant", user: "user3" }
				])
			);
		});

		test("deduplicates when multiple entities share the same partition", async () => {
			const entityStorage = (await createConnector(nameof<MigV1>(), [
				"node",
				"tenant",
				"user"
			])) as IEntityStorageMigrationConnector<MigV1>;
			currentUser = "user1";
			await entityStorage.set({ id: "1", legacyField: "a" });
			await entityStorage.set({ id: "2", legacyField: "b" });
			currentUser = "user2";
			await entityStorage.set({ id: "3", legacyField: "c" });
			await entityStorage.set({ id: "4", legacyField: "d" });
			const result = await entityStorage.getPartitionContextIds();
			expect(result).toHaveLength(2);
		});

		test("skips partition ids whose depth does not match the configured partition keys", async () => {
			const storageId = `ms${Date.now().toString(36)}`;
			const legacyStorage = (await createConnector(
				nameof<MigV1>(),
				["user"],
				storageId
			)) as IEntityStorageMigrationConnector<MigV1>;
			await legacyStorage.set({ id: "1", legacyField: "a" });

			const entityStorage = (await createConnector(
				nameof<MigV1>(),
				["tenant", "user"],
				storageId
			)) as IEntityStorageMigrationConnector<MigV1>;
			currentUser = "user1";
			await entityStorage.set({ id: "2", legacyField: "b" });

			const logSpy = vi.fn();
			ComponentFactory.register("test-logging", () => ({
				className: () => "TestLogging",
				log: logSpy
			}));
			try {
				const result = await entityStorage.getPartitionContextIds("test-logging");
				expect(result).toEqual([{ tenant: "tenant", user: "user1" }]);
				expect(logSpy).toHaveBeenCalledWith(
					expect.objectContaining({
						level: "warn",
						message: "partitionIdsSkipped",
						data: expect.objectContaining({ partitionIds: "user" })
					})
				);
			} finally {
				ComponentFactory.unregister("test-logging");
			}
		});
	});

	// -----------------------------------------------------------------------
	// Step builder - creates a single IResolvedMigrationStep from the source
	// connector's live schema and the named target schema in EntitySchemaFactory.
	// -----------------------------------------------------------------------

	function makeStep(
		source: IEntityStorageMigrationConnector,
		targetSchemaName: string,
		renames?: { from: string; to: string }[],
		transformEntityProperty?: IResolvedMigrationStep["transformEntityProperty"]
	): IResolvedMigrationStep {
		return {
			fromProperties: EntitySchemaFactory.get(source.getSchema().type ?? "").properties ?? [],
			toProperties: EntitySchemaFactory.get(targetSchemaName).properties ?? [],
			renames,
			transformEntityProperty
		};
	}

	describe("migration using MigrationHelper", () => {
		// Propagate the context from ContextIdStore.run into the mocked getContextIds so that
		// partition-scoped queries inside MigrationHelper resolve to the correct partition.
		beforeEach(() => {
			vi.spyOn(ContextIdStore, "run").mockImplementation(
				async (contextIds: IContextIds, fn: () => unknown) => {
					const prevUser = currentUser;
					const ctxUser = (contextIds as { [key: string]: string }).user;
					if (typeof ctxUser === "string") {
						currentUser = ctxUser;
					}
					try {
						return await fn();
					} finally {
						currentUser = prevUser;
					}
				}
			);
			vi.spyOn(MigrationHelper, "migrateWithChain").mockImplementation(
				async (...args: Parameters<typeof MigrationHelper.migrateWithChain>) => {
					const result = await originalMigrateWithChain(...args);
					trackedConnectors.push(result.finalConnector);
					return result;
				}
			);
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		async function makeV1Connector(
			partitionContextIds: string[] = ["user"],
			storageId?: string
		): Promise<IEntityStorageMigrationConnector<MigV1>> {
			return (await createConnector(
				nameof<MigV1>(),
				partitionContextIds,
				storageId
			)) as IEntityStorageMigrationConnector<MigV1>;
		}

		test("migrates entities to new schema dropping old field and adding new optional one", async () => {
			const source = await makeV1Connector();
			await source.set({ id: "1", legacyField: "hello" });
			await source.set({ id: "2", legacyField: "world" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())]
			);

			expect(migrated).toBe(2);
			const item1 = await finalConnector.get("1");
			expect(item1).toBeDefined();
			expect((item1 as { legacyField?: string }).legacyField).toBeUndefined();
			expect((item1 as MigV2).newField).toBeUndefined();
			const item2 = await finalConnector.get("2");
			expect(item2).toBeDefined();
		});

		test("preserves entity count across migration", async () => {
			const source = await makeV1Connector();
			await source.set({ id: "1", legacyField: "a" });
			await source.set({ id: "2", legacyField: "b" });
			await source.set({ id: "3", legacyField: "c" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())]
			);

			expect(migrated).toBe(3);
			expect(await finalConnector.count()).toBe(3);
		});

		test("discards entities in partitions whose depth does not match during migration", async () => {
			const storageId = `md${Date.now().toString(36)}`;
			const legacySource = await makeV1Connector(["user"], storageId);
			await legacySource.set({ id: "1", legacyField: "legacy" });

			const source = await makeV1Connector(["tenant", "user"], storageId);
			currentUser = "user1";
			await source.set({ id: "2", legacyField: "a" });
			currentUser = "user2";
			await source.set({ id: "3", legacyField: "b" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())]
			);

			expect(migrated).toBe(2);
			currentUser = "user1";
			expect(await finalConnector.get("2")).toBeDefined();
			currentUser = "user2";
			expect(await finalConnector.get("3")).toBeDefined();
			currentUser = "user";
			expect(await finalConnector.get("1")).toBeUndefined();
		});

		test("migrates with coercible string-to-integer type change", async () => {
			const source = await makeV1Connector();
			await source.set({ id: "1", legacyField: "42" });
			await source.set({ id: "2", legacyField: "7" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV3TypeChange>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV3TypeChange>())]
			);

			expect(migrated).toBe(2);
			expect(((await finalConnector.get("1")) as MigV3TypeChange).legacyField).toBe(42);
			expect(((await finalConnector.get("2")) as MigV3TypeChange).legacyField).toBe(7);
		});

		test("throws when type coercion cannot produce a value for a required field", async () => {
			const source = await makeV1Connector();
			await source.set({ id: "1", legacyField: "not-a-number" });

			await expect(
				MigrationHelper.migrateWithChain(
					source,
					nameof<MigV3TypeChange>(),
					await source.getPartitionContextIds(),
					[makeStep(source, nameof<MigV3TypeChange>())]
				)
			).rejects.toMatchObject({
				name: "GeneralError",
				message: "migrationHelper.migrateSchemaFailed"
			});
		});

		test("rename: value is carried to the new field name", async () => {
			const source = await makeV1Connector();
			await source.set({ id: "1", legacyField: "hello" });
			await source.set({ id: "2", legacyField: "world" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>(), [{ from: "legacyField", to: "newField" }])]
			);

			expect(migrated).toBe(2);
			expect(((await finalConnector.get("1")) as MigV2).newField).toBe("hello");
			expect(((await finalConnector.get("2")) as MigV2).newField).toBe("world");
		});

		test("rename: old field name is absent on migrated entity", async () => {
			const source = await makeV1Connector();
			await source.set({ id: "1", legacyField: "hello" });

			const { finalConnector } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>(), [{ from: "legacyField", to: "newField" }])]
			);

			const item = await finalConnector.get("1");
			expect((item as { legacyField?: string }).legacyField).toBeUndefined();
			expect((item as MigV2).newField).toBe("hello");
		});

		test("rename: without renames the field value is dropped", async () => {
			const source = await makeV1Connector();
			await source.set({ id: "1", legacyField: "hello" });

			const { finalConnector } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())]
			);

			expect(((await finalConnector.get("1")) as MigV2).newField).toBeUndefined();
		});

		test("rename: with renames the field value is preserved", async () => {
			const source = await makeV1Connector();
			await source.set({ id: "1", legacyField: "hello" });

			const { finalConnector } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>(), [{ from: "legacyField", to: "newField" }])]
			);

			expect(((await finalConnector.get("1")) as MigV2).newField).toBe("hello");
		});

		test("rename: value is carried correctly across multiple partitions", async () => {
			const source = await makeV1Connector(["user"]);

			currentUser = "userA";
			await source.set({ id: "1", legacyField: "alpha" });

			currentUser = "userB";
			await source.set({ id: "1", legacyField: "beta" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>(), [{ from: "legacyField", to: "newField" }])]
			);

			expect(migrated).toBe(2);

			currentUser = "userA";
			expect(((await finalConnector.get("1")) as MigV2).newField).toBe("alpha");

			currentUser = "userB";
			expect(((await finalConnector.get("1")) as MigV2).newField).toBe("beta");
		});

		test("migrates entities across all partitions and returns total migrated count", async () => {
			const source = await makeV1Connector(["user"]);

			currentUser = "userA";
			await source.set({ id: "a1", legacyField: "alpha" });
			await source.set({ id: "a2", legacyField: "beta" });

			currentUser = "userB";
			await source.set({ id: "b1", legacyField: "gamma" });
			await source.set({ id: "b2", legacyField: "delta" });

			currentUser = "userA";
			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())]
			);

			expect(migrated).toBe(4);

			currentUser = "userA";
			const a1 = await finalConnector.get("a1");
			expect(a1).toBeDefined();
			expect((a1 as { legacyField?: string }).legacyField).toBeUndefined();
			const a2 = await finalConnector.get("a2");
			expect(a2).toBeDefined();

			currentUser = "userB";
			const b1 = await finalConnector.get("b1");
			expect(b1).toBeDefined();
			expect((b1 as { legacyField?: string }).legacyField).toBeUndefined();
			const b2 = await finalConnector.get("b2");
			expect(b2).toBeDefined();
		});

		test("migrates entities with the same id across different partitions independently", async () => {
			const source = await makeV1Connector(["user"]);

			currentUser = "alice";
			await source.set({ id: "1", legacyField: "aliceVal" });

			currentUser = "bob";
			await source.set({ id: "1", legacyField: "bobVal" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())]
			);

			expect(migrated).toBe(2);

			currentUser = "alice";
			expect(await finalConnector.get("1")).toBeDefined();

			currentUser = "bob";
			expect(await finalConnector.get("1")).toBeDefined();
		});

		test("migrates correctly with a custom batchSize", async () => {
			const source = await makeV1Connector();
			for (let i = 0; i < 5; i++) {
				await source.set({ id: String(i + 1), legacyField: `val${i + 1}` });
			}

			const { migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())],
				{ batchSize: 2 }
			);

			expect(migrated).toBe(5);
		});

		test("migrates a single entity end to end", async () => {
			const source = await makeV1Connector();
			await source.set({ id: "1", legacyField: "hello" });

			const { migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())]
			);

			expect(migrated).toBe(1);
		});

		test("respects batchSize and migrates all entities regardless of chunk boundaries", async () => {
			const source = await makeV1Connector();
			for (let i = 0; i < 10; i++) {
				await source.set({ id: String(i + 1), legacyField: `val${i + 1}` });
			}

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())],
				{ batchSize: 3 }
			);

			expect(migrated).toBe(10);
			expect(await finalConnector.count()).toBe(10);
		});

		test("transformEntityProperty: converts a string field to an object using the provided function", async () => {
			const source = (await createConnector(nameof<MigV1WithStr>(), [
				"user"
			])) as IEntityStorageMigrationConnector<MigV1WithStr>;
			await source.set({ id: "1", info: "hello" });
			await source.set({ id: "2", info: "world" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2WithObj>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2WithObj>(), undefined, (f, t, v) => ({ label: v as string }))]
			);

			expect(migrated).toBe(2);
			expect(((await finalConnector.get("1")) as MigV2WithObj).info).toEqual({
				label: "hello"
			});
			expect(((await finalConnector.get("2")) as MigV2WithObj).info).toEqual({
				label: "world"
			});
		});

		test("transformEntityProperty: throws when missing and target property type is object", async () => {
			const source = (await createConnector(nameof<MigV1WithStr>(), [
				"user"
			])) as IEntityStorageMigrationConnector<MigV1WithStr>;
			await source.set({ id: "1", info: "hello" });

			await expect(
				MigrationHelper.migrateWithChain(
					source,
					nameof<MigV2WithObj>(),
					await source.getPartitionContextIds(),
					[makeStep(source, nameof<MigV2WithObj>())]
				)
			).rejects.toMatchObject({
				name: "GeneralError",
				message: "migrationHelper.migrateSchemaFailed"
			});
		});

		test("coercion: optional field silently becomes undefined when value is not coercible", async () => {
			const source = await makeV1Connector();
			await source.set({ id: "1", legacyField: "not-a-number" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV3OptionalTypeChange>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV3OptionalTypeChange>())]
			);

			expect(migrated).toBe(1);
			expect(
				((await finalConnector.get("1")) as MigV3OptionalTypeChange).legacyField
			).toBeUndefined();
		});

		test("added non-optional fields receive type-appropriate defaults", async () => {
			const source = (await createConnector(nameof<MigJustId>(), [
				"user"
			])) as IEntityStorageMigrationConnector<MigJustId>;
			await source.set({ id: "1" });
			await source.set({ id: "2" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigAllAddedDefaults>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigAllAddedDefaults>())]
			);

			expect(migrated).toBe(2);
			const item = (await finalConnector.get("1")) as MigAllAddedDefaults;
			expect(item.boolField).toBe(false);
			expect(item.intField).toBe(0);
			expect(item.numField).toBe(0);
			expect(item.strField).toBe("");
			expect(item.arrField).toEqual([]);
			expect(item.objField).toEqual({});
		});

		test("migrates with coercible string-to-boolean type change", async () => {
			const source = await makeV1Connector();
			await source.set({ id: "1", legacyField: "true" });
			await source.set({ id: "2", legacyField: "false" });
			await source.set({ id: "3", legacyField: "TRUE" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV3BoolChange>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV3BoolChange>())]
			);

			expect(migrated).toBe(3);
			expect(((await finalConnector.get("1")) as MigV3BoolChange).legacyField).toBe(true);
			expect(((await finalConnector.get("2")) as MigV3BoolChange).legacyField).toBe(false);
			expect(((await finalConnector.get("3")) as MigV3BoolChange).legacyField).toBe(true);
		});

		test("migrates with coercible integer-to-string type change", async () => {
			const source = (await createConnector(nameof<MigV3TypeChange>(), [
				"user"
			])) as IEntityStorageMigrationConnector<MigV3TypeChange>;
			await source.set({ id: "1", legacyField: 42 });
			await source.set({ id: "2", legacyField: 0 });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV3ToStr>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV3ToStr>())]
			);

			expect(migrated).toBe(2);
			expect(((await finalConnector.get("1")) as MigV3ToStr).legacyField).toBe("42");
			expect(((await finalConnector.get("2")) as MigV3ToStr).legacyField).toBe("0");
		});

		test("rename: multiple fields can be renamed in a single migration", async () => {
			const source = (await createConnector(nameof<MigMultiFieldA>(), [
				"user"
			])) as IEntityStorageMigrationConnector<MigMultiFieldA>;
			await source.set({ id: "1", fieldA: "alpha", fieldB: "beta" });
			await source.set({ id: "2", fieldA: "gamma", fieldB: "delta" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigMultiFieldB>(),
				await source.getPartitionContextIds(),
				[
					makeStep(source, nameof<MigMultiFieldB>(), [
						{ from: "fieldA", to: "renamedA" },
						{ from: "fieldB", to: "renamedB" }
					])
				]
			);

			expect(migrated).toBe(2);
			const item1 = (await finalConnector.get("1")) as MigMultiFieldB;
			expect(item1.renamedA).toBe("alpha");
			expect(item1.renamedB).toBe("beta");
			expect((item1 as { fieldA?: string }).fieldA).toBeUndefined();
			expect((item1 as { fieldB?: string }).fieldB).toBeUndefined();
			const item2 = (await finalConnector.get("2")) as MigMultiFieldB;
			expect(item2.renamedA).toBe("gamma");
			expect(item2.renamedB).toBe("delta");
		});

		test("migrates empty source and returns zero migrated count", async () => {
			const source = await makeV1Connector();

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())]
			);

			expect(migrated).toBe(0);
			expect(await finalConnector.count()).toBe(0);
		});

		test("schema unchanged: entities are preserved with identical data after migration", async () => {
			const source = await makeV1Connector();
			await source.set({ id: "1", legacyField: "hello" });
			await source.set({ id: "2", legacyField: "world" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV1>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV1>())]
			);

			expect(migrated).toBe(2);
			expect(((await finalConnector.get("1")) as MigV1).legacyField).toBe("hello");
			expect(((await finalConnector.get("2")) as MigV1).legacyField).toBe("world");
		});

		test("migrates entities across multiple partitions", async () => {
			const source = await makeV1Connector(["user"]);

			currentUser = "userA";
			await source.set({ id: "1", legacyField: "a" });

			currentUser = "userB";
			await source.set({ id: "2", legacyField: "b" });

			currentUser = "userC";
			await source.set({ id: "3", legacyField: "c" });

			currentUser = "userA";
			const { migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())]
			);

			expect(migrated).toBe(3);
		});

		test("finalizeMigration: migrates all entities when connector has no partitionContextIds configured", async () => {
			const source = (await createConnector(
				nameof<MigV1>()
			)) as IEntityStorageMigrationConnector<MigV1>;
			await source.set({ id: "1", legacyField: "a" });
			await source.set({ id: "2", legacyField: "b" });
			await source.set({ id: "3", legacyField: "c" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())]
			);

			expect(migrated).toBe(3);
			expect(await finalConnector.count()).toBe(3);
			expect(await finalConnector.get("1")).toBeDefined();
			expect(await finalConnector.get("2")).toBeDefined();
			expect(await finalConnector.get("3")).toBeDefined();
		});

		test("finalizeMigration: skips copy when source is empty and partitionContextIds are configured", async () => {
			const source = await makeV1Connector(["user"]);

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>())]
			);

			expect(migrated).toBe(0);
			expect(await finalConnector.count()).toBe(0);
		});

		test("finalizeMigration: migrates all entities across each partition when partitionContextIds are configured", async () => {
			const source = await makeV1Connector(["user"]);

			currentUser = "alice";
			await source.set({ id: "1", legacyField: "a1" });
			await source.set({ id: "2", legacyField: "a2" });

			currentUser = "bob";
			await source.set({ id: "1", legacyField: "b1" });
			await source.set({ id: "2", legacyField: "b2" });

			const { finalConnector, migrated } = await MigrationHelper.migrateWithChain(
				source,
				nameof<MigV2>(),
				await source.getPartitionContextIds(),
				[makeStep(source, nameof<MigV2>(), [{ from: "legacyField", to: "newField" }])]
			);

			expect(migrated).toBe(4);

			currentUser = "alice";
			expect(((await finalConnector.get("1")) as MigV2).newField).toBe("a1");
			expect(((await finalConnector.get("2")) as MigV2).newField).toBe("a2");

			currentUser = "bob";
			expect(((await finalConnector.get("1")) as MigV2).newField).toBe("b1");
			expect(((await finalConnector.get("2")) as MigV2).newField).toBe("b2");
		});
	});
});
