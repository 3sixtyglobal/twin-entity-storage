// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ComponentFactory, GeneralError } from "@twin.org/core";
import { EntitySchemaFactory, type IEntitySchema } from "@twin.org/entity";
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

function makeVersionConnector(
	records: SchemaVersion[] = [],
	bootstrapResult = true
): IEntityStorageConnector<SchemaVersion> {
	return {
		className: () => "VersionConnectorStub",
		getSchema: vi.fn().mockReturnValue(makeSchema("SchemaVersion", 0)),
		bootstrap: vi.fn().mockResolvedValue(bootstrapResult),
		start: vi.fn().mockResolvedValue(undefined),
		query: vi.fn().mockResolvedValue({ entities: records }),
		set: vi.fn().mockResolvedValue(undefined),
		get: vi.fn(),
		remove: vi.fn(),
		removeBatch: vi.fn(),
		setBatch: vi.fn(),
		count: vi.fn(),
		empty: vi.fn()
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
		count: vi.fn(),
		empty: vi.fn(),
		getPartitionContextIds: vi.fn().mockResolvedValue([]),
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
			finalConnector: undefined as unknown,
			migrated: 0
		} as unknown as Awaited<ReturnType<typeof MigrationHelper.migrateWithChain>>);
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
	// start() — no-op
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
	// start() — fresh install (C8: empty table still runs chain)
	// -------------------------------------------------------------------------

	test("start() runs migration chain on fresh install even when the table is empty", async () => {
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
			expect.any(Array) as IResolvedMigrationStep[],
			expect.any(Object),
			undefined
		);
		expect(vc.set).toHaveBeenCalledWith(expect.objectContaining({ schemaName, version: 1 }));
	});

	// -------------------------------------------------------------------------
	// start() — first boot with pre-existing data assumes v0
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
	// start() — ISchemaMigration rename override
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
	// start() — storedVersionNewer
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
	// start() — noMigrationStep
	// -------------------------------------------------------------------------

	test("start() throws noMigrationStep when the source versioned schema is absent", async () => {
		const schemaName = "Widget";
		const connector = makeMigConnector(schemaName, 1);

		// currentVersion = 1 but no V0 schema registered — chain can't start
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
	// start() — noMigrationStepTarget
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
	// start() — connectorNotMigrationCapable
	// -------------------------------------------------------------------------

	test("start() throws connectorNotMigrationCapable when the connector cannot migrate", async () => {
		const schemaName = "Widget";
		const v0Schema = makeSchema(`${schemaName}V0`, 0);
		const currentSchema = makeSchema(schemaName, 1);
		const connector = makeNonMigConnector(schemaName, 1); // no createTargetConnector

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
});
