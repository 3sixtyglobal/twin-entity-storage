// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	EntitySchemaFactory,
	EntitySchemaPropertyType,
	type IEntitySchema
} from "@twin.org/entity";
import {
	EntityStorageConnectorFactory,
	SchemaMigrationFactory,
	type IEntityStorageConnector,
	type IEntityStorageMigrationConnector
} from "@twin.org/entity-storage-models";
import { vi } from "vitest";
import type { SchemaVersion } from "../src/entities/schemaVersion.js";
import { SchemaVersionService } from "../src/schemaVersionService.js";

// Local alias: IEntitySchema with a string-indexed T so property-name literals
// are valid (keyof { [key: string]: unknown } = string, keyof unknown = never).
type SvcSchema = IEntitySchema<{ [key: string]: unknown }>;

// ---------------------------------------------------------------------------
// Schema fixtures — use a unique prefix to avoid cross-test factory collisions
// ---------------------------------------------------------------------------

const BASE = "SvsTestEntity";
const V0_NAME = `${BASE}V0`;
const CONNECTOR_NAME = "svc-test-connector";
const VERSION_CONNECTOR_NAME = "test-schema-version";

// Current schema at version 0 (no version field → getVersion returns 0)
const v0Schema: SvcSchema = {
	type: BASE,
	properties: [
		{ property: "id", type: EntitySchemaPropertyType.String, isPrimary: true },
		{ property: "name", type: EntitySchemaPropertyType.String }
	]
};

const v0HistorySchema: SvcSchema = {
	type: V0_NAME,
	properties: [
		{ property: "id", type: EntitySchemaPropertyType.String, isPrimary: true },
		{ property: "name", type: EntitySchemaPropertyType.String }
	]
};

const v1Schema: SvcSchema = {
	type: BASE,
	version: 1,
	properties: [
		{ property: "id", type: EntitySchemaPropertyType.String, isPrimary: true },
		{ property: "name", type: EntitySchemaPropertyType.String },
		{ property: "extra", type: EntitySchemaPropertyType.String, optional: true }
	]
};

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function makeVersionConnector(): IEntityStorageConnector<SchemaVersion> {
	const store = new Map<string, SchemaVersion>();
	return {
		className: () => "StubVersionConnector",
		getSchema: () => ({ type: "SchemaVersion" }),
		bootstrap: vi.fn().mockResolvedValue(undefined),
		set: vi.fn().mockImplementation(async (e: SchemaVersion) => {
			store.set(e.schemaName, { ...e });
		}),
		setBatch: vi.fn(),
		get: vi.fn().mockImplementation(async (id: string) => store.get(id)),
		remove: vi.fn(),
		removeBatch: vi.fn(),
		query: vi.fn().mockImplementation(async () => ({ entities: [...store.values()] })),
		empty: vi.fn(),
		count: vi.fn().mockImplementation(async () => store.size)
	};
}

function makeMigrationConnector(
	entityCount: number,
	targetConnector: IEntityStorageConnector<{ [key: string]: unknown }>,
	schemaName: string
): IEntityStorageMigrationConnector<{ [key: string]: unknown }> {
	const fakeEntities: { [key: string]: unknown }[] = [];
	for (let i = 0; i < entityCount; i++) {
		fakeEntities.push({ id: String(i), name: `name-${i}` });
	}
	return {
		className: () => "StubMigConnector",
		getSchema: vi
			.fn()
			.mockReturnValue({ type: schemaName, properties: v0HistorySchema.properties }),
		bootstrap: vi.fn().mockResolvedValue(undefined),
		start: vi.fn().mockResolvedValue(undefined),
		set: vi.fn(),
		setBatch: vi.fn(),
		get: vi.fn(),
		remove: vi.fn(),
		removeBatch: vi.fn(),
		query: vi.fn().mockResolvedValue({ entities: fakeEntities }),
		empty: vi.fn(),
		count: vi.fn().mockResolvedValue(entityCount),
		getPartitionContextIds: vi.fn().mockResolvedValue([{}]),
		createTargetConnector: vi.fn().mockResolvedValue(targetConnector),
		finalizeMigration: vi.fn().mockResolvedValue(targetConnector),
		cleanupMigration: vi.fn().mockResolvedValue(undefined)
	};
}

function makeTargetConnector(
	schemaName: string,
	schema: SvcSchema
): IEntityStorageConnector<{ [key: string]: unknown }> {
	const written: { [key: string]: unknown }[] = [];
	return {
		className: () => "StubTargetConnector",
		getSchema: vi.fn().mockReturnValue(schema),
		bootstrap: vi.fn().mockResolvedValue(undefined),
		start: vi.fn().mockResolvedValue(undefined),
		set: vi.fn(),
		setBatch: vi.fn().mockImplementation(async (batch: { [key: string]: unknown }[]) => {
			written.push(...batch);
		}),
		get: vi.fn(),
		remove: vi.fn(),
		removeBatch: vi.fn(),
		query: vi.fn().mockResolvedValue({ entities: written }),
		empty: vi.fn(),
		count: vi.fn().mockImplementation(async () => written.length)
	};
}

// ---------------------------------------------------------------------------
// Setup / teardown helpers
// ---------------------------------------------------------------------------

function registerSchemas(currentSchema: SvcSchema, ...history: SvcSchema[]): void {
	if (currentSchema.type) {
		EntitySchemaFactory.register(currentSchema.type, () => currentSchema as IEntitySchema);
	}
	for (const h of history) {
		if (h.type) {
			EntitySchemaFactory.register(h.type, () => h as IEntitySchema);
		}
	}
}

function unregisterSchemas(...names: string[]): void {
	for (const name of names) {
		try {
			EntitySchemaFactory.unregister(name);
		} catch {
			/* ignore */
		}
	}
}

function registerConnector(
	name: string,
	connector: IEntityStorageConnector<{ [key: string]: unknown }>
): void {
	EntityStorageConnectorFactory.register(name, () => connector);
}

function unregisterConnector(name: string): void {
	try {
		EntityStorageConnectorFactory.unregister(name);
	} catch {
		/* ignore */
	}
}

function registerVersionConnector(connector: IEntityStorageConnector<SchemaVersion>): void {
	EntityStorageConnectorFactory.register(
		VERSION_CONNECTOR_NAME,
		() => connector as unknown as IEntityStorageConnector
	);
}

function unregisterVersionConnector(): void {
	try {
		EntityStorageConnectorFactory.unregister(VERSION_CONNECTOR_NAME);
	} catch {
		/* ignore */
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SchemaVersionService", () => {
	test("throws when the schema-version connector type is not registered in the factory", () => {
		expect(
			() => new SchemaVersionService({ schemaVersionStorageType: "unregistered-type" })
		).toThrow(expect.objectContaining({ name: "GeneralError" }));
	});

	test("start is a no-op when stored version equals current version", async () => {
		const versionConnector = makeVersionConnector();
		const target = makeTargetConnector(BASE, v0Schema);
		const source = makeMigrationConnector(0, target, BASE);

		registerSchemas(v0Schema);
		registerConnector(CONNECTOR_NAME, source);
		registerVersionConnector(versionConnector);

		// Pre-stamp version 0 — matches v0Schema.version (0)
		await versionConnector.set({ schemaName: BASE, version: 0, updatedAt: "" });

		try {
			const service = new SchemaVersionService({
				schemaVersionStorageType: VERSION_CONNECTOR_NAME
			});
			await service.start();
			expect(source.createTargetConnector).not.toHaveBeenCalled();
		} finally {
			unregisterSchemas(BASE);
			unregisterConnector(CONNECTOR_NAME);
			unregisterVersionConnector();
		}
	});

	test("start runs migration chain on fresh install (no record, no data) to reconcile table shape", async () => {
		const versionConnector = makeVersionConnector();
		const target = makeTargetConnector(BASE, v1Schema);
		const source = makeMigrationConnector(0, target, BASE);

		registerSchemas({ ...v1Schema }, { ...v0HistorySchema });
		registerConnector(CONNECTOR_NAME, source);
		registerVersionConnector(versionConnector);

		try {
			const service = new SchemaVersionService({
				schemaVersionStorageType: VERSION_CONNECTOR_NAME
			});
			await service.start();

			// Migration must run even with zero rows so finalizeMigration reconciles table shape
			expect(source.createTargetConnector).toHaveBeenCalledWith(BASE);
			expect(source.finalizeMigration).toHaveBeenCalled();

			// Version record should be stamped at current (1) after migration
			const record = await versionConnector.get(BASE);
			expect(record?.version).toBe(1);
		} finally {
			unregisterSchemas(BASE, V0_NAME);
			unregisterConnector(CONNECTOR_NAME);
			unregisterVersionConnector();
		}
	});

	test("start migrates when existing data has no version record (assumes v0)", async () => {
		const versionConnector = makeVersionConnector();
		const target = makeTargetConnector(BASE, v1Schema);
		// 2 existing entities, no version record → assume v0 → migrate to v1
		const source = makeMigrationConnector(2, target, BASE);

		registerSchemas({ ...v1Schema }, { ...v0HistorySchema });
		registerConnector(CONNECTOR_NAME, source);
		registerVersionConnector(versionConnector);

		try {
			const service = new SchemaVersionService({
				schemaVersionStorageType: VERSION_CONNECTOR_NAME
			});
			await service.start();

			expect(source.createTargetConnector).toHaveBeenCalledWith(BASE);
			expect(source.finalizeMigration).toHaveBeenCalled();

			const record = await versionConnector.get(BASE);
			expect(record?.version).toBe(1);
		} finally {
			unregisterSchemas(BASE, V0_NAME);
			unregisterConnector(CONNECTOR_NAME);
			unregisterVersionConnector();
		}
	});

	test("start applies an optional ISchemaMigration rename override", async () => {
		const versionConnector = makeVersionConnector();
		const target = makeTargetConnector(BASE, v1Schema);
		const source = makeMigrationConnector(1, target, BASE);

		registerSchemas({ ...v1Schema }, { ...v0HistorySchema });
		registerConnector(CONNECTOR_NAME, source);
		registerVersionConnector(versionConnector);
		SchemaMigrationFactory.register(`${BASE}_0_1`, () => ({
			renames: [{ from: "name", to: "label" }]
		}));

		try {
			const service = new SchemaVersionService({
				schemaVersionStorageType: VERSION_CONNECTOR_NAME
			});
			await service.start();

			expect(source.finalizeMigration).toHaveBeenCalled();
		} finally {
			unregisterSchemas(BASE, V0_NAME);
			unregisterConnector(CONNECTOR_NAME);
			unregisterVersionConnector();
			try {
				SchemaMigrationFactory.unregister(`${BASE}_0_1`);
			} catch {
				/* ignore */
			}
		}
	});

	test("start throws storedVersionNewer when stored version is ahead of current", async () => {
		const versionConnector = makeVersionConnector();
		const target = makeTargetConnector(BASE, v0Schema);
		const source = makeMigrationConnector(0, target, BASE);

		registerSchemas(v0Schema);
		registerConnector(CONNECTOR_NAME, source);
		registerVersionConnector(versionConnector);

		// Store a version (99) higher than the schema's current version (0)
		await versionConnector.set({ schemaName: BASE, version: 99, updatedAt: "" });

		try {
			const service = new SchemaVersionService({
				schemaVersionStorageType: VERSION_CONNECTOR_NAME
			});
			await expect(service.start()).rejects.toThrow(
				expect.objectContaining({
					name: "GeneralError",
					message: "schemaVersionService.storedVersionNewer"
				})
			);
		} finally {
			unregisterSchemas(BASE);
			unregisterConnector(CONNECTOR_NAME);
			unregisterVersionConnector();
		}
	});

	test("start throws noMigrationStep when the source versioned schema is missing", async () => {
		const versionConnector = makeVersionConnector();
		const target = makeTargetConnector(BASE, v1Schema);
		const source = makeMigrationConnector(1, target, BASE);

		// Register only the current schema — V0_NAME (source history) is intentionally absent
		EntitySchemaFactory.register(BASE, () => ({ ...v1Schema }) as IEntitySchema);
		registerConnector(CONNECTOR_NAME, source);
		registerVersionConnector(versionConnector);

		await versionConnector.set({ schemaName: BASE, version: 0, updatedAt: "" });

		try {
			const service = new SchemaVersionService({
				schemaVersionStorageType: VERSION_CONNECTOR_NAME
			});
			await expect(service.start()).rejects.toThrow(
				expect.objectContaining({
					name: "GeneralError",
					message: "schemaVersionService.noMigrationStep"
				})
			);
		} finally {
			unregisterSchemas(BASE);
			unregisterConnector(CONNECTOR_NAME);
			unregisterVersionConnector();
		}
	});

	test("start throws noMigrationStepTarget when the target versioned schema is missing", async () => {
		const V1_NAME = `${BASE}V1`;

		// v2Schema: current schema at version 2
		const v2Schema: SvcSchema = {
			type: BASE,
			version: 2,
			properties: [
				{ property: "id", type: EntitySchemaPropertyType.String, isPrimary: true },
				{ property: "name", type: EntitySchemaPropertyType.String },
				{ property: "extra", type: EntitySchemaPropertyType.String, optional: true },
				{ property: "extra2", type: EntitySchemaPropertyType.String, optional: true }
			]
		};

		const versionConnector = makeVersionConnector();
		const target = makeTargetConnector(BASE, v2Schema);
		const source = makeMigrationConnector(1, target, BASE);

		// Register V0_NAME (source for step 0→1) but NOT V1_NAME (target for step 0→1 / source for 1→2)
		registerSchemas({ ...v2Schema }, { ...v0HistorySchema });
		registerConnector(CONNECTOR_NAME, source);
		registerVersionConnector(versionConnector);

		await versionConnector.set({ schemaName: BASE, version: 0, updatedAt: "" });

		try {
			const service = new SchemaVersionService({
				schemaVersionStorageType: VERSION_CONNECTOR_NAME
			});
			await expect(service.start()).rejects.toThrow(
				expect.objectContaining({
					name: "GeneralError",
					message: "schemaVersionService.noMigrationStepTarget"
				})
			);
		} finally {
			unregisterSchemas(BASE, V0_NAME, V1_NAME);
			unregisterConnector(CONNECTOR_NAME);
			unregisterVersionConnector();
		}
	});

	test("start throws when migration is needed but connector lacks migration capability", async () => {
		const versionConnector = makeVersionConnector();
		// Connector without migration capability (e.g. synchronised connector)
		const noMigConnector = {
			CLASS_NAME: "NoMigConnector",
			getSchema: vi.fn().mockReturnValue({ type: BASE }),
			count: vi.fn().mockResolvedValue(0),
			query: vi.fn(),
			set: vi.fn(),
			setBatch: vi.fn(),
			get: vi.fn(),
			remove: vi.fn(),
			removeBatch: vi.fn(),
			empty: vi.fn()
			// createTargetConnector intentionally absent
		} as unknown as IEntityStorageConnector<{ [key: string]: unknown }>;

		registerSchemas({ ...v1Schema }, { ...v0HistorySchema });
		registerConnector(CONNECTOR_NAME, noMigConnector);
		registerVersionConnector(versionConnector);

		await versionConnector.set({ schemaName: BASE, version: 0, updatedAt: "" });

		try {
			const service = new SchemaVersionService({
				schemaVersionStorageType: VERSION_CONNECTOR_NAME
			});
			await expect(service.start()).rejects.toThrow(
				expect.objectContaining({
					name: "GeneralError",
					message: "schemaVersionService.connectorNotMigrationCapable"
				})
			);
		} finally {
			unregisterSchemas(BASE, V0_NAME);
			unregisterConnector(CONNECTOR_NAME);
			unregisterVersionConnector();
		}
	});
});
