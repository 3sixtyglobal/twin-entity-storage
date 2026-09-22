// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdKeys, ContextIdStore } from "@twin.org/context";
import { ComponentFactory, GeneralError } from "@twin.org/core";
import {
	EntitySchemaFactory,
	EntitySchemaPropertyType,
	type IEntitySchema
} from "@twin.org/entity";
import { MemoryEntityStorageConnector } from "@twin.org/entity-storage-connector-memory";
import {
	EntityStorageConnectorFactory,
	type IEntityStorageConnector,
	type IEntityStorageMigrationConnector,
	type IResolvedMigrationStep,
	MigrationHelper,
	SchemaMigrationFactory
} from "@twin.org/entity-storage-models";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SchemaVersion } from "../src/entities/schemaVersion.js";
import { SchemaVersionService } from "../src/schemaVersionService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSchema(type: string, version?: number): IEntitySchema {
	return { type, properties: [], version };
}

const CONNECTOR_VERSION_KEY = "connectorVersion";

function makeConnectorVersionRecord(version: number): SchemaVersion {
	return {
		schemaName: CONNECTOR_VERSION_KEY,
		version,
		updatedAt: ""
	};
}

function makeVersionConnector(
	records: SchemaVersion[] = [],
	bootstrapResult = true,
	connectorVersion = 0
): IEntityStorageMigrationConnector<SchemaVersion> {
	return {
		className: () => "VersionConnectorStub",
		getSchema: vi.fn().mockReturnValue(makeSchema("SchemaVersion", 0)),
		bootstrap: vi.fn().mockResolvedValue(bootstrapResult),
		connectorVersion: vi.fn().mockReturnValue(connectorVersion),
		start: vi.fn().mockResolvedValue(undefined),
		query: vi.fn().mockResolvedValue({ entities: records }),
		queryJoin: vi.fn().mockResolvedValue({ entities: [] }),
		set: vi.fn().mockResolvedValue(undefined),
		get: vi.fn(),
		remove: vi.fn(),
		removeBatch: vi.fn(),
		setBatch: vi.fn(),
		count: vi.fn(),
		empty: vi.fn(),
		getPartitionContextIds: vi.fn().mockResolvedValue(undefined),
		createTargetConnector: vi.fn().mockResolvedValue(undefined),
		finalizeMigration: vi.fn().mockResolvedValue(undefined),
		cleanupMigration: vi.fn().mockResolvedValue(undefined)
	};
}

function makeMigConnector(schemaName: string, version = 0): IEntityStorageMigrationConnector {
	return {
		className: () => "MigConnectorStub",
		getSchema: vi.fn().mockReturnValue(makeSchema(schemaName, version)),
		bootstrap: vi.fn(),
		start: vi.fn(),
		query: vi.fn().mockResolvedValue({ entities: [] }),
		queryJoin: vi.fn().mockResolvedValue({ entities: [] }),
		set: vi.fn(),
		get: vi.fn(),
		remove: vi.fn(),
		removeBatch: vi.fn(),
		setBatch: vi.fn(),
		count: vi.fn().mockResolvedValue(1),
		empty: vi.fn(),
		connectorVersion: vi.fn().mockReturnValue(0),
		// Default to undefined ("not partitioned"); partitioned tests override with [] or values.
		getPartitionContextIds: vi.fn().mockResolvedValue(undefined),
		createTargetConnector: vi.fn().mockResolvedValue(undefined),
		finalizeMigration: vi.fn().mockResolvedValue(undefined),
		cleanupMigration: vi.fn().mockResolvedValue(undefined)
	};
}

function makeNonMigConnector(schemaName: string, version = 0): IEntityStorageConnector {
	return {
		className: () => "NonMigConnectorStub",
		getSchema: vi.fn().mockReturnValue(makeSchema(schemaName, version)),
		bootstrap: vi.fn(),
		start: vi.fn(),
		query: vi.fn().mockResolvedValue({ entities: [] }),
		queryJoin: vi.fn().mockResolvedValue({ entities: [] }),
		set: vi.fn(),
		get: vi.fn(),
		remove: vi.fn(),
		removeBatch: vi.fn(),
		setBatch: vi.fn(),
		count: vi.fn(),
		empty: vi.fn()
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SchemaVersionService", () => {
	let schemaNamesSpy: ReturnType<typeof vi.spyOn>;
	let schemaGetSpy: ReturnType<typeof vi.spyOn>;
	let connectorNamesSpy: ReturnType<typeof vi.spyOn>;
	let connectorGetSpy: ReturnType<typeof vi.spyOn>;
	let migrateWithChainSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		schemaNamesSpy = vi.spyOn(EntitySchemaFactory, "names").mockReturnValue([]);
		schemaGetSpy = vi.spyOn(EntitySchemaFactory, "get").mockReturnValue(makeSchema("Unknown"));
		connectorNamesSpy = vi.spyOn(EntityStorageConnectorFactory, "names").mockReturnValue([]);
		connectorGetSpy = vi
			.spyOn(EntityStorageConnectorFactory, "get")
			.mockImplementation((name: string) => {
				if (name === "schema-version") {
					return makeVersionConnector([]);
				}
				return makeNonMigConnector("Unknown");
			});
		migrateWithChainSpy = vi.spyOn(MigrationHelper, "migrateWithChain").mockResolvedValue({
			finalConnector: makeNonMigConnector("Unknown"),
			migrated: 0
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -------------------------------------------------------------------------
	// constructor
	// -------------------------------------------------------------------------

	test("throws when constructed without a version connector", () => {
		connectorGetSpy.mockImplementation(() => {
			throw new GeneralError("EntityStorageConnectorFactory", "notFound", {
				name: "schema-version"
			});
		});
		expect(() => new SchemaVersionService()).toThrow(GeneralError);
	});

	// -------------------------------------------------------------------------
	// start() - no-op
	// -------------------------------------------------------------------------

	test("start() does not migrate when stored version equals current version", async () => {
		const schemaName = "Widget";
		const currentVersion = 2;
		const connector = makeMigConnector(schemaName, currentVersion);

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(makeSchema(schemaName, currentVersion));
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([{ schemaName, version: currentVersion, updatedAt: "" }]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await new SchemaVersionService().start();

		expect(migrateWithChainSpy).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// start() - no version record: always resolve as v0 and run the chain
	// -------------------------------------------------------------------------

	test("start() treats an empty table as v0 and runs migration when no version record exists", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);

		// Empty table: count() would return 0, but the decision no longer reads it.
		(connector.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([]); // no stored version record
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await new SchemaVersionService().start();

		expect(connector.count).not.toHaveBeenCalled();
		expect(migrateWithChainSpy).toHaveBeenCalledWith(
			connector,
			schemaName,
			undefined,
			expect.any(Array) as IResolvedMigrationStep[],
			expect.any(Object),
			undefined
		);
		expect(vc.set).toHaveBeenCalledWith(expect.objectContaining({ schemaName, version: 0 }));
		expect(vc.set).toHaveBeenCalledWith(expect.objectContaining({ schemaName, version: 1 }));
	});

	// -------------------------------------------------------------------------
	// start() - pre-existing data: no version record → treat as v0, run chain
	// -------------------------------------------------------------------------

	test("start() treats non-empty table as v0 and runs migration when no version record exists", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1); // count defaults to 1 (non-empty)

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([]); // no stored version record
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await new SchemaVersionService().start();

		expect(migrateWithChainSpy).toHaveBeenCalledWith(
			connector,
			schemaName,
			undefined,
			expect.any(Array) as IResolvedMigrationStep[],
			expect.any(Object),
			undefined
		);
		expect(vc.set).toHaveBeenCalledWith(expect.objectContaining({ schemaName, version: 1 }));
	});

	// -------------------------------------------------------------------------
	// start() - first boot with pre-existing data assumes v0
	// -------------------------------------------------------------------------

	test("start() assumes stored version is 0 when no version record exists", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await new SchemaVersionService().start();

		expect(migrateWithChainSpy).toHaveBeenCalled();
		expect(vc.set).toHaveBeenCalledWith(expect.objectContaining({ schemaName, version: 1 }));
	});

	test("start() logs migrationRequired with the stored version as from and the current as to", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		const logSpy = vi.fn();
		ComponentFactory.register("test-logging", () => ({
			className: () => "TestLogging",
			log: logSpy
		}));

		try {
			await new SchemaVersionService().start("test-logging");

			expect(logSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "migrationRequired",
					data: { schemaName, from: 0, to: 1 }
				})
			);
		} finally {
			ComponentFactory.unregister("test-logging");
		}
	});

	// -------------------------------------------------------------------------
	// start() - ISchemaMigration rename override
	// -------------------------------------------------------------------------

	test("start() applies ISchemaMigration rename override from SchemaMigrationFactory", async () => {
		const schemaName = "Widget";
		const overrideKey = `${schemaName}_0_1`;
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		SchemaMigrationFactory.register(overrideKey, () => ({
			renames: [{ from: "oldField", to: "newField" }]
		}));

		try {
			await new SchemaVersionService().start();

			expect(migrateWithChainSpy).toHaveBeenCalledWith(
				connector,
				schemaName,
				undefined,
				expect.arrayContaining([
					expect.objectContaining({ renames: [{ from: "oldField", to: "newField" }] })
				]),
				expect.any(Object),
				undefined
			);
		} finally {
			try {
				SchemaMigrationFactory.unregister(overrideKey);
			} catch {
				/* ignore */
			}
		}
	});

	test("start() passes the transformEntity override through to the migration step", async () => {
		const schemaName = "Widget";
		const overrideKey = `${schemaName}_0_1`;
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		const hook = vi.fn().mockImplementation(entity => entity);
		SchemaMigrationFactory.register(overrideKey, () => ({
			transformEntity: hook
		}));

		try {
			await new SchemaVersionService().start();

			expect(migrateWithChainSpy).toHaveBeenCalledWith(
				connector,
				schemaName,
				undefined,
				expect.arrayContaining([expect.objectContaining({ transformEntity: hook })]),
				expect.any(Object),
				undefined
			);
		} finally {
			try {
				SchemaMigrationFactory.unregister(overrideKey);
			} catch {
				/* ignore */
			}
		}
	});

	// -------------------------------------------------------------------------
	// start() - storedVersionNewer
	// -------------------------------------------------------------------------

	test("start() throws storedVersionNewer when stored version exceeds current", async () => {
		const schemaName = "Widget";
		const connector = makeMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(makeSchema(schemaName, 1));
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([{ schemaName, version: 5, updatedAt: "" }]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await expect(new SchemaVersionService().start()).rejects.toThrow(GeneralError);
	});

	// -------------------------------------------------------------------------
	// start() - noMigrationStep
	// -------------------------------------------------------------------------

	test("start() throws noMigrationStep when the source versioned schema is absent", async () => {
		const schemaName = "Widget";
		const connector = makeMigConnector(schemaName, 1);

		// currentVersion = 1 but no V0 schema registered - chain can't start
		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(makeSchema(schemaName, 1));
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		// No stored record → treated as v0 → needs V0 schema to build step
		await expect(new SchemaVersionService().start()).rejects.toThrow(GeneralError);
	});

	// -------------------------------------------------------------------------
	// start() - noMigrationStepTarget
	// -------------------------------------------------------------------------

	test("start() throws noMigrationStepTarget when an intermediate versioned schema is absent", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 2); // chain: 0→1→2, V1 is missing
		const connector = makeMigConnector(schemaName, 2);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await expect(new SchemaVersionService().start()).rejects.toThrow(GeneralError);
	});

	// -------------------------------------------------------------------------
	// start() - connectorNotMigrationCapable
	// -------------------------------------------------------------------------

	test("start() throws connectorNotMigrationCapable when the connector cannot migrate", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeNonMigConnector(schemaName, 1); // no createTargetConnector
		// Pre-existing data, so a migration is actually attempted (and then rejected for
		// lacking migration capability) rather than short-circuiting as a fresh bootstrap.
		(connector.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await expect(new SchemaVersionService().start()).rejects.toThrow(GeneralError);
	});

	// -------------------------------------------------------------------------
	// start(): tenant-partitioned connector, no tenant in startup context
	// -------------------------------------------------------------------------

	test("start() succeeds for a tenant-partitioned connector when the startup context has no tenant", async () => {
		const schemaName = "ReproEntity";
		const currentVersion = 1;
		const reproSchema: IEntitySchema = {
			type: schemaName,
			properties: [
				{ property: "id", type: EntitySchemaPropertyType.String, isPrimary: true }
			] as unknown as IEntitySchema["properties"],
			version: currentVersion
		};

		const reproV0Schema: IEntitySchema = {
			...reproSchema,
			type: `${schemaName}V0`,
			version: 0
		};

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return reproV0Schema;
			}
			if (name === schemaName) {
				return reproSchema;
			}
			return makeSchema("Unknown");
		});

		// A real connector, not a stub - partitioned exactly as the engine partitions
		// tenant-scoped entity storage (twin-engine component builders pick [Node, Tenant]
		// as partitionContextIds whenever TWIN_TENANT_ENABLED=true).
		const connector = new MemoryEntityStorageConnector({
			entitySchema: schemaName,
			partitionContextIds: [ContextIdKeys.Node, ContextIdKeys.Tenant],
			config: { storageKey: `repro-${schemaName}` }
		});

		connectorNamesSpy.mockReturnValue([schemaName]);
		const vc = makeVersionConnector([]); // no stored version record - first boot
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		// Mirrors EngineCore.start(): only "node" is present in the ambient context - "tenant"
		// is a per-request value resolved by the tenant route processor, never present at
		// startup (twin-node start.ts:162/170).
		await ContextIdStore.run({ [ContextIdKeys.Node]: "test-node" }, async () => {
			await new SchemaVersionService().start();
		});

		expect(vc.set).toHaveBeenCalledWith(
			expect.objectContaining({ schemaName, version: currentVersion })
		);
	});

	// -------------------------------------------------------------------------
	// processSchema - partitioned tables with no version record
	// -------------------------------------------------------------------------

	test("runs the migration chain with no partitions when a partitioned table has no version record", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);
		// Partitioned (unlike the stub's "not partitioned" default), with no matching partitions:
		// an empty table and one whose rows all live in legacy-depth partitions look identical here.
		(connector.getPartitionContextIds as ReturnType<typeof vi.fn>).mockResolvedValue([]);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await new SchemaVersionService().start();

		expect(connector.count).not.toHaveBeenCalled();
		expect(migrateWithChainSpy).toHaveBeenCalledWith(
			connector,
			schemaName,
			[],
			expect.any(Array) as IResolvedMigrationStep[],
			expect.any(Object),
			undefined
		);
		expect(vc.set).toHaveBeenCalledWith(expect.objectContaining({ schemaName, version: 0 }));
		expect(vc.set).toHaveBeenCalledWith(expect.objectContaining({ schemaName, version: 1 }));
	});

	test("treats a partitioned table with existing partitions as legacy v0 data without calling count()", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);
		(connector.getPartitionContextIds as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ node: "n1", tenant: "t1" }
		]);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await new SchemaVersionService().start();

		expect(connector.count).not.toHaveBeenCalled();
		expect(migrateWithChainSpy).toHaveBeenCalledWith(
			connector,
			schemaName,
			[{ node: "n1", tenant: "t1" }],
			expect.any(Array) as IResolvedMigrationStep[],
			expect.any(Object),
			undefined
		);
		expect(vc.set).toHaveBeenCalledWith(expect.objectContaining({ schemaName, version: 1 }));
	});

	test("throws for a non-migration-capable connector when a versioned schema has no version record", async () => {
		const schemaName = "Widget";
		const connector = makeNonMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(makeSchema(schemaName, 1));
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await expect(new SchemaVersionService().start()).rejects.toMatchObject({
			message: "schemaVersionService.connectorNotMigrationCapable"
		});
		expect(vc.set).toHaveBeenCalledWith(expect.objectContaining({ schemaName, version: 0 }));
	});

	// -------------------------------------------------------------------------
	// start() - connector version tracking
	// -------------------------------------------------------------------------

	test("start() does not re-bootstrap when connector version matches stored connector version", async () => {
		const schemaName = "Widget";
		const currentVersion = 2;
		const connectorVer = 3;
		const connector = makeMigConnector(schemaName, currentVersion);
		connector.connectorVersion = vi.fn().mockReturnValue(connectorVer);

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(makeSchema(schemaName, currentVersion));
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector(
			[
				{ schemaName, version: currentVersion, updatedAt: "" },
				makeConnectorVersionRecord(connectorVer)
			],
			true,
			connectorVer
		);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await new SchemaVersionService().start();

		expect(connector.bootstrap).not.toHaveBeenCalled();
		expect(migrateWithChainSpy).not.toHaveBeenCalled();
		expect(vc.set).not.toHaveBeenCalled();
	});

	test("start() re-migrates when connector version has changed without a schema migration", async () => {
		const schemaName = "Widget";
		const currentVersion = 2;
		const newConnectorVer = 2;
		const connector = makeMigConnector(schemaName, currentVersion);
		connector.connectorVersion = vi.fn().mockReturnValue(newConnectorVer);

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(makeSchema(schemaName, currentVersion));
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector(
			[{ schemaName, version: currentVersion, updatedAt: "" }, makeConnectorVersionRecord(1)],
			true,
			newConnectorVer
		);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await new SchemaVersionService().start();

		expect(migrateWithChainSpy).toHaveBeenCalledTimes(1);
		expect(vc.set).toHaveBeenCalledWith(
			expect.objectContaining({
				schemaName,
				version: currentVersion
			})
		);
		expect(vc.set).toHaveBeenCalledWith(
			expect.objectContaining({
				schemaName: CONNECTOR_VERSION_KEY,
				version: newConnectorVer
			})
		);
	});

	test("start() logs connectorVersionUpdated when connector version changes", async () => {
		const schemaName = "Widget";
		const currentVersion = 1;
		const connector = makeMigConnector(schemaName, currentVersion);
		connector.connectorVersion = vi.fn().mockReturnValue(2);
		(connector.bootstrap as ReturnType<typeof vi.fn>).mockResolvedValue(true);

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(makeSchema(schemaName, currentVersion));
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector(
			[{ schemaName, version: currentVersion, updatedAt: "" }, makeConnectorVersionRecord(1)],
			true,
			2
		);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		const logSpy = vi.fn();
		ComponentFactory.register("test-logging", () => ({
			className: () => "TestLogging",
			log: logSpy
		}));

		try {
			await new SchemaVersionService().start("test-logging");

			expect(logSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "connectorVersionUpdated",
					data: { from: 1, to: 2 }
				})
			);
		} finally {
			ComponentFactory.unregister("test-logging");
		}
	});

	test("start() forces connector migration for all schemas when any connector version changes", async () => {
		const schemaA = "WidgetA";
		const schemaB = "WidgetB";
		const currentVersion = 1;

		const connectorA = makeMigConnector(schemaA, currentVersion);
		const connectorB = makeMigConnector(schemaB, currentVersion);
		connectorA.connectorVersion = vi.fn().mockReturnValue(2);
		connectorB.connectorVersion = vi.fn().mockReturnValue(1);

		schemaNamesSpy.mockReturnValue([schemaA, schemaB]);
		schemaGetSpy.mockImplementation((name: string) => makeSchema(name, currentVersion));
		connectorNamesSpy.mockReturnValue([schemaA, schemaB]);

		const vc = makeVersionConnector(
			[
				{ schemaName: schemaA, version: currentVersion, updatedAt: "" },
				{ schemaName: schemaB, version: currentVersion, updatedAt: "" },
				makeConnectorVersionRecord(1)
			],
			true,
			2
		);

		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			if (name === schemaA) {
				return connectorA;
			}
			return connectorB;
		});

		await new SchemaVersionService().start();

		expect(migrateWithChainSpy).toHaveBeenCalledTimes(2);
		expect(vc.set).toHaveBeenCalledWith(
			expect.objectContaining({ schemaName: CONNECTOR_VERSION_KEY, version: 2 })
		);
	});

	test("start() stores connector version in a separate schema-version entry on fresh install", async () => {
		const schemaName = "Widget";
		const currentVersion = 0;
		const connectorVer = 2;
		const connector = makeMigConnector(schemaName, currentVersion);
		connector.connectorVersion = vi.fn().mockReturnValue(connectorVer);

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(makeSchema(schemaName, currentVersion));
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([], true, connectorVer);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await new SchemaVersionService().start();

		// The changed connector version forces the chain even for a freshly-seeded schema.
		expect(migrateWithChainSpy).toHaveBeenCalledTimes(1);
		expect(vc.set).toHaveBeenCalledWith(
			expect.objectContaining({
				schemaName,
				version: currentVersion
			})
		);
		expect(vc.set).toHaveBeenCalledWith(
			expect.objectContaining({
				schemaName: CONNECTOR_VERSION_KEY,
				version: connectorVer
			})
		);
	});

	test("start() stores connector version in a separate schema-version entry after migration", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connectorVer = 3;
		const connector = makeMigConnector(schemaName, 1); // count() defaults to 1 (non-empty)
		connector.connectorVersion = vi.fn().mockReturnValue(connectorVer);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([], true, connectorVer); // no stored record; count > 0 triggers legacy v0 path
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await new SchemaVersionService().start();

		expect(migrateWithChainSpy).toHaveBeenCalled();
		expect(vc.set).toHaveBeenCalledWith(expect.objectContaining({ schemaName, version: 1 }));
		expect(vc.set).toHaveBeenCalledWith(
			expect.objectContaining({
				schemaName: CONNECTOR_VERSION_KEY,
				version: connectorVer
			})
		);
	});

	test("start() does not force re-bootstrap when no connector-version entry exists", async () => {
		const schemaName = "Widget";
		const currentVersion = 2;
		const connector = makeMigConnector(schemaName, currentVersion);

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(makeSchema(schemaName, currentVersion));
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([{ schemaName, version: currentVersion, updatedAt: "" }]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await new SchemaVersionService().start();

		expect(connector.bootstrap).not.toHaveBeenCalled();
		expect(migrateWithChainSpy).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// start() - enabled: false (detect-only mode)
	// -------------------------------------------------------------------------

	test("start() with enabled:false does not migrate when a schema needs migration", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([{ schemaName, version: 0, updatedAt: "" }]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await new SchemaVersionService({ config: { enabled: false } }).start();

		expect(migrateWithChainSpy).not.toHaveBeenCalled();
		expect(vc.set).not.toHaveBeenCalled();
	});

	test("start() with enabled:false logs migrationDisabled for each schema with a pending migration", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([{ schemaName, version: 0, updatedAt: "" }]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		const logSpy = vi.fn();
		ComponentFactory.register("test-logging", () => ({
			className: () => "TestLogging",
			log: logSpy
		}));

		try {
			await new SchemaVersionService({ config: { enabled: false } }).start("test-logging");

			expect(logSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					level: "warn",
					message: "migrationDisabled",
					data: { schemaName, from: 0, to: 1 }
				})
			);
		} finally {
			ComponentFactory.unregister("test-logging");
		}
	});

	test("start() with enabled:false skips schemas with no stored version record", async () => {
		const schemaName = "Widget";
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(currentSchema);
		connectorNamesSpy.mockReturnValue([schemaName]);

		// No stored version record for the schema.
		const vc = makeVersionConnector([]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		const logSpy = vi.fn();
		ComponentFactory.register("test-logging", () => ({
			className: () => "TestLogging",
			log: logSpy
		}));

		try {
			await new SchemaVersionService({ config: { enabled: false } }).start("test-logging");

			expect(logSpy).not.toHaveBeenCalledWith(
				expect.objectContaining({ message: "migrationDisabled" })
			);
		} finally {
			ComponentFactory.unregister("test-logging");
		}
	});

	test("start() with enabled:false does not warn for schemas already at current version", async () => {
		const schemaName = "Widget";
		const currentVersion = 2;
		const currentSchema = makeSchema(schemaName, currentVersion);
		const connector = makeMigConnector(schemaName, currentVersion);

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(currentSchema);
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([{ schemaName, version: currentVersion, updatedAt: "" }]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		const logSpy = vi.fn();
		ComponentFactory.register("test-logging", () => ({
			className: () => "TestLogging",
			log: logSpy
		}));

		try {
			await new SchemaVersionService({ config: { enabled: false } }).start("test-logging");

			expect(logSpy).not.toHaveBeenCalled();
		} finally {
			ComponentFactory.unregister("test-logging");
		}
	});

	// -------------------------------------------------------------------------
	// start() - finalizing marker
	// -------------------------------------------------------------------------

	test("start() throws migrationInterrupted when a finalizing marker record exists", async () => {
		const schemaName = "Widget";
		const connector = makeMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(makeSchema(schemaName, 1));
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([
			{ schemaName, version: 0, updatedAt: "" },
			{ schemaName: `${schemaName}:finalizing`, version: 1, updatedAt: "" }
		]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await expect(new SchemaVersionService().start()).rejects.toMatchObject({
			properties: { schemaName, version: 1, marker: `${schemaName}:finalizing` }
		});
		expect(migrateWithChainSpy).not.toHaveBeenCalled();
		expect(vc.set).not.toHaveBeenCalled();
	});

	test("start() with enabled:false throws migrationInterrupted when a finalizing marker record exists", async () => {
		const schemaName = "Widget";
		const connector = makeMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockReturnValue(makeSchema(schemaName, 1));
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([
			{ schemaName, version: 1, updatedAt: "" },
			{ schemaName: `${schemaName}:finalizing`, version: 1, updatedAt: "" }
		]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});

		await expect(new SchemaVersionService({ config: { enabled: false } }).start()).rejects.toThrow(
			GeneralError
		);
	});

	test("start() writes the finalizing marker before finalize and removes it after the version is stamped", async () => {
		const schemaName = "Widget";
		const marker = `${schemaName}:finalizing`;
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([{ schemaName, version: 0, updatedAt: "" }]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});
		migrateWithChainSpy.mockImplementation(
			async (...args: Parameters<typeof MigrationHelper.migrateWithChain>) => {
				await args[4]?.onFinalizing?.();
				return { finalConnector: connector, migrated: 0 };
			}
		);

		await new SchemaVersionService().start();

		const setCalls = vi.mocked(vc.set).mock.calls;
		const markerIndex = setCalls.findIndex(call => call[0].schemaName === marker);
		const versionIndex = setCalls.findIndex(
			call => call[0].schemaName === schemaName && call[0].version === 1
		);
		expect(setCalls[markerIndex][0]).toEqual(
			expect.objectContaining({ schemaName: marker, version: 1 })
		);
		expect(markerIndex).toBeLessThan(versionIndex);
		expect(vc.remove).toHaveBeenCalledWith(marker);
		expect(vi.mocked(vc.remove).mock.invocationCallOrder[0]).toBeGreaterThan(
			vi.mocked(vc.set).mock.invocationCallOrder[versionIndex]
		);
	});

	test("start() keeps the finalizing marker when finalize fails", async () => {
		const schemaName = "Widget";
		const marker = `${schemaName}:finalizing`;
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);

		schemaNamesSpy.mockReturnValue([`${schemaName}V0`, schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
			if (name === `${schemaName}V0`) {
				return v0Schema;
			}
			return currentSchema;
		});
		connectorNamesSpy.mockReturnValue([schemaName]);

		const vc = makeVersionConnector([{ schemaName, version: 0, updatedAt: "" }]);
		connectorGetSpy.mockImplementation((name: string) => {
			if (name === "schema-version") {
				return vc;
			}
			return connector;
		});
		migrateWithChainSpy.mockImplementation(
			async (...args: Parameters<typeof MigrationHelper.migrateWithChain>) => {
				await args[4]?.onFinalizing?.();
				throw new GeneralError("test", "finalizeFailed");
			}
		);

		await expect(new SchemaVersionService().start()).rejects.toThrow(GeneralError);

		expect(vc.set).toHaveBeenCalledWith(
			expect.objectContaining({ schemaName: marker, version: 1 })
		);
		expect(vc.remove).not.toHaveBeenCalled();
	});
});
