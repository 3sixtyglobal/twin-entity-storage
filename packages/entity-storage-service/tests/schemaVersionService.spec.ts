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
		set: vi.fn(),
		get: vi.fn(),
		remove: vi.fn(),
		removeBatch: vi.fn(),
		setBatch: vi.fn(),
		// Default to 1 so "no version record" tests exercise the pre-existing-data path
		// (count > 0 → treat as v0 and run migration). Tests that need an empty table
		// override this with mockResolvedValue(0).
		count: vi.fn().mockResolvedValue(1),
		empty: vi.fn(),
		connectorVersion: vi.fn().mockReturnValue(0),
		// Default to undefined ("not partitioned") so existing tests keep exercising the
		// bare count() path they were written against. Tests exercising the partitioned
		// contract override this explicitly to [] or a populated array -
		// see the "partitioned-but-empty" / "partitioned with existing data" cases below.
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
	// start() - fresh install: empty table seeds at current, no migration
	// -------------------------------------------------------------------------

	test("start() seeds version at current and skips migration when table is empty and no version record exists", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);

		// Simulate empty table: count() returns 0
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

		// No migration should run: the table is empty, so we fast-path to current.
		expect(migrateWithChainSpy).not.toHaveBeenCalled();
		// Version record must be written at current (1), not 0.
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

		schemaNamesSpy.mockReturnValue([schemaName]);
		schemaGetSpy.mockImplementation((name: string) => {
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
	// processSchema - partition-aware fresh-vs-legacy contract
	// -------------------------------------------------------------------------

	test("falls back to bare count() when getPartitionContextIds returns undefined (un-partitioned connector, unchanged path)", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);
		(connector.getPartitionContextIds as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
		(connector.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

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

		expect(connector.count).toHaveBeenCalledTimes(1);
		expect(migrateWithChainSpy).not.toHaveBeenCalled();
		expect(vc.set).toHaveBeenCalledWith(expect.objectContaining({ schemaName, version: 1 }));
	});

	test("treats a partitioned-but-empty table as fresh bootstrap without calling count()", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeMigConnector(schemaName, 1);
		// Partitioned (unlike the stub's "not partitioned" default), but no partitions exist yet.
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
		expect(migrateWithChainSpy).not.toHaveBeenCalled();
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

	test("falls back to bare count() for a base connector with no getPartitionContextIds capability", async () => {
		const schemaName = "Widget";
		const connector = makeNonMigConnector(schemaName, 1);
		(connector.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

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

		await new SchemaVersionService().start();

		expect(connector.count).toHaveBeenCalledTimes(1);
		expect(vc.set).toHaveBeenCalledWith(expect.objectContaining({ schemaName, version: 1 }));
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
		const currentVersion = 1;
		const connectorVer = 2;
		const connector = makeMigConnector(schemaName, currentVersion);
		connector.connectorVersion = vi.fn().mockReturnValue(connectorVer);
		(connector.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

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

		expect(migrateWithChainSpy).not.toHaveBeenCalled();
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
});
