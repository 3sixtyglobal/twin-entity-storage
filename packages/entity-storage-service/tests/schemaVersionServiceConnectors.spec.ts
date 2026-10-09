// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdKeys, ContextIdStore } from "@3sixty/context";
import {
	EntitySchemaFactory,
	EntitySchemaPropertyType,
	SortDirection,
	type IEntitySchema,
	type IEntitySchemaProperty
} from "@3sixty/entity";
import { MemoryEntityStorageConnector } from "@3sixty/entity-storage-connector-memory";
import { MySqlEntityStorageConnector } from "@3sixty/entity-storage-connector-mysql";
import {
	EntityStorageConnectorFactory,
	SchemaMigrationFactory,
	type IEntityStorageConnector,
	type IEntityStorageMigrationConnector,
	type ISchemaMigration
} from "@3sixty/entity-storage-models";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TEST_MYSQL_CONFIG } from "./setupTestEnv.js";
import type { SchemaVersion } from "../src/entities/schemaVersion.js";
import { initSchema } from "../src/schema.js";
import { SchemaVersionService } from "../src/schemaVersionService.js";

interface Widget {
	id: string;
	type: string;
	value?: string;
	valueHash?: string;
	label?: string;
}

interface ITestConnectorType {
	name: string;
	reportsMissingColumns: boolean;
	create: (
		entitySchema: string,
		storageId: string,
		partitionContextIds?: string[]
	) => IEntityStorageMigrationConnector;
}

const CONNECTOR_TYPES: ITestConnectorType[] = [
	{
		name: "memory",
		reportsMissingColumns: false,
		create: (entitySchema, storageId, partitionContextIds) =>
			new MemoryEntityStorageConnector({
				entitySchema,
				partitionContextIds,
				config: { storageKey: storageId }
			})
	},
	{
		name: "mysql",
		reportsMissingColumns: true,
		create: (entitySchema, storageId, partitionContextIds) =>
			new MySqlEntityStorageConnector({
				entitySchema,
				partitionContextIds,
				config: { ...TEST_MYSQL_CONFIG, tableName: `${TEST_MYSQL_CONFIG.tableName}_${storageId}` }
			})
	}
];

const WIDGET = "Widget";
const WIDGET_V0 = `${WIDGET}V0`;
const WIDGET_V1 = `${WIDGET}V1`;
const WIDGET_STORAGE_TYPE = "widget";
const VERSION_STORAGE_TYPE = "schema-version";
const CONNECTOR_VERSION_KEY = "connectorVersion";
const SEED_ROW: Widget = { id: "1", type: "alias", value: "Acme" };
const HASH = "h".repeat(27);

const ID_PROPERTY: IEntitySchemaProperty<Widget> = {
	property: "id",
	type: EntitySchemaPropertyType.String,
	isPrimary: true,
	maxLength: 64
};

// An index group needs at least two members, so a shape without value or valueHash uses this.
const UNINDEXED_TYPE_PROPERTY: IEntitySchemaProperty<Widget> = {
	property: "type",
	type: EntitySchemaPropertyType.String,
	maxLength: 32
};

const TYPE_PROPERTY: IEntitySchemaProperty<Widget> = {
	...UNINDEXED_TYPE_PROPERTY,
	indexGroup: [{ name: "typeValue", direction: SortDirection.Ascending, index: 0 }]
};

const VALUE_PROPERTY: IEntitySchemaProperty<Widget> = {
	property: "value",
	type: EntitySchemaPropertyType.String,
	maxLength: 255
};

const INDEXED_VALUE_PROPERTY: IEntitySchemaProperty<Widget> = {
	...VALUE_PROPERTY,
	indexGroup: [{ name: "typeValue", direction: SortDirection.Ascending, index: 1 }]
};

const VALUE_HASH_PROPERTY: IEntitySchemaProperty<Widget> = {
	property: "valueHash",
	type: EntitySchemaPropertyType.String,
	maxLength: 27,
	optional: true,
	indexGroup: [{ name: "typeValue", direction: SortDirection.Ascending, index: 1 }]
};

const LABEL_PROPERTY: IEntitySchemaProperty<Widget> = {
	property: "label",
	type: EntitySchemaPropertyType.String,
	maxLength: 255,
	optional: true
};

// The original shape: type and value form the composite index.
const UNHASHED_SHAPE = [ID_PROPERTY, TYPE_PROPERTY, INDEXED_VALUE_PROPERTY];

// valueHash replaces value in the composite index.
const HASHED_SHAPE = [ID_PROPERTY, TYPE_PROPERTY, VALUE_PROPERTY, VALUE_HASH_PROPERTY];

/**
 * Register a Widget schema shape under a name and version.
 * @param name The schema name, the base name for the current shape or a versioned name for history.
 * @param version The schema version.
 * @param properties The schema properties.
 */
function registerWidgetSchema(
	name: string,
	version: number,
	properties: IEntitySchemaProperty<Widget>[]
): void {
	const schema: IEntitySchema<Widget> = { type: name, version, properties };
	EntitySchemaFactory.register(name, () => schema as IEntitySchema);
}

/**
 * Register a migration override for a step.
 * @param fromVersion The version the step migrates from.
 * @param migration The override.
 */
function registerWidgetMigration(fromVersion: number, migration: ISchemaMigration<Widget>): void {
	SchemaMigrationFactory.register(
		`${WIDGET}_${fromVersion}_${fromVersion + 1}`,
		() => migration as ISchemaMigration
	);
}

/**
 * A storage id unique to this test run.
 * @returns The storage id.
 */
function uniqueStorageId(): string {
	return `svs${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

describe.each(CONNECTOR_TYPES)("SchemaVersionService with the $name connector", connectorType => {
	let createdConnectors: IEntityStorageConnector[];

	/**
	 * Create and bootstrap a connector, as the engine does before the service starts.
	 * @param entitySchema The schema name to create the connector for.
	 * @param storageId The storage the connector uses, shared by connectors given the same id.
	 * @param partitionContextIds The context ids the storage is partitioned by.
	 * @returns The bootstrapped connector.
	 */
	async function createStorage<T>(
		entitySchema: string,
		storageId: string,
		partitionContextIds?: string[]
	): Promise<IEntityStorageMigrationConnector<T>> {
		const connector = connectorType.create(entitySchema, storageId, partitionContextIds);
		expect(await connector.bootstrap?.()).toBe(true);
		createdConnectors.push(connector);
		return connector as IEntityStorageMigrationConnector<T>;
	}

	/**
	 * Seed an existing Widget storage with rows written under the original shape.
	 * @param storageId The storage to seed.
	 * @param rows The rows to write.
	 * @returns The connector that wrote the rows.
	 */
	async function seedWidgetStorage(
		storageId: string,
		rows: Widget[] = [SEED_ROW]
	): Promise<IEntityStorageMigrationConnector<Widget>> {
		const seeder = await createStorage<Widget>(WIDGET_V0, storageId);
		for (const row of rows) {
			await seeder.set(row);
		}
		return seeder;
	}

	/**
	 * Create the version store holding the given records and register it for the service.
	 * @param storageId The storage id for the version store.
	 * @param records The stored versions, keyed by schema name.
	 * @param connectorVersion Whether the connector version record matches the connector, is the
	 * previous version, which forces a rebuild, or is absent.
	 * @returns The version store.
	 */
	async function createVersionStore(
		storageId: string,
		records: { [schemaName: string]: number },
		connectorVersion: "current" | "previous" | "none" = "current"
	): Promise<IEntityStorageMigrationConnector<SchemaVersion>> {
		const versionStore = await createStorage<SchemaVersion>("SchemaVersion", `${storageId}v`);
		const allRecords = { ...records };
		if (connectorVersion !== "none") {
			allRecords[CONNECTOR_VERSION_KEY] =
				versionStore.connectorVersion() - (connectorVersion === "previous" ? 1 : 0);
		}
		for (const [schemaName, version] of Object.entries(allRecords)) {
			await versionStore.set({ schemaName, version, updatedAt: new Date().toISOString() });
		}
		EntityStorageConnectorFactory.register(VERSION_STORAGE_TYPE, () => versionStore);
		return versionStore;
	}

	/**
	 * Read every stored version record.
	 * @param versionStore The version store to read.
	 * @returns The stored versions, keyed by schema name.
	 */
	async function readVersions(
		versionStore: IEntityStorageConnector<SchemaVersion>
	): Promise<{ [schemaName: string]: number }> {
		const result = await versionStore.query();
		return Object.fromEntries(result.entities.map(record => [record.schemaName, record.version]));
	}

	/**
	 * Create the Widget connector over the given storage and register it for the service.
	 * @param storageId The storage the connector uses.
	 * @param partitionContextIds The context ids the storage is partitioned by.
	 * @returns The connector.
	 */
	async function registerWidgetStorage(
		storageId: string,
		partitionContextIds?: string[]
	): Promise<IEntityStorageMigrationConnector<Widget>> {
		const connector = await createStorage<Widget>(WIDGET, storageId, partitionContextIds);
		EntityStorageConnectorFactory.register(WIDGET_STORAGE_TYPE, () => connector);
		return connector;
	}

	/**
	 * Get the Widget connector the service left registered, which a migration replaces.
	 * @returns The connector.
	 */
	function registeredWidgetStorage(): IEntityStorageConnector<Widget> {
		return EntityStorageConnectorFactory.get<IEntityStorageConnector<Widget>>(WIDGET_STORAGE_TYPE);
	}

	/**
	 * Check a new row carrying valueHash can be written and read back.
	 * @param connector The connector to write through.
	 */
	async function expectHashWritable(connector: IEntityStorageConnector<Widget>): Promise<void> {
		const row: Widget = { id: "2", type: "alias", value: "Other", valueHash: HASH };
		await connector.set(row);
		expect(await connector.get("2")).toEqual(row);
	}

	beforeEach(() => {
		createdConnectors = [];
		EntitySchemaFactory.clear();
		EntityStorageConnectorFactory.clear();
		SchemaMigrationFactory.clear();
		initSchema();
	});

	afterEach(async () => {
		// A migration replaces the registered connector, so tear down those too.
		const connectors = new Set(createdConnectors);
		for (const name of EntityStorageConnectorFactory.names()) {
			connectors.add(EntityStorageConnectorFactory.get(name));
		}
		for (const connector of connectors) {
			await connector.teardown?.();
		}
		for (const connector of connectors) {
			await connector.stop?.();
		}
		EntitySchemaFactory.clear();
		EntityStorageConnectorFactory.clear();
		SchemaMigrationFactory.clear();
	});

	test("records the current versions on a fresh install", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET, 0, HASHED_SHAPE);
		const versionStore = await createVersionStore(storageId, {}, "none");
		const widgets = await registerWidgetStorage(storageId);

		await new SchemaVersionService().start();

		expect(await readVersions(versionStore)).toEqual({
			[WIDGET]: 0,
			SchemaVersion: 0,
			[CONNECTOR_VERSION_KEY]: versionStore.connectorVersion()
		});
		await expectHashWritable(widgets);
	});

	test("migrates existing rows when a version bump adds an indexed property", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 1, HASHED_SHAPE);
		await seedWidgetStorage(storageId);
		const versionStore = await createVersionStore(storageId, { [WIDGET]: 0, SchemaVersion: 0 });
		const widgets = await registerWidgetStorage(storageId);
		expect(widgets.getMissingColumns?.() ?? []).toEqual(
			connectorType.reportsMissingColumns ? ["valueHash"] : []
		);

		await new SchemaVersionService().start();

		expect((await readVersions(versionStore))[WIDGET]).toEqual(1);
		expect(await registeredWidgetStorage().get("1")).toEqual(SEED_ROW);
		await expectHashWritable(registeredWidgetStorage());
	});

	test("fails at start when a property is added without a version bump", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 0, HASHED_SHAPE);
		await seedWidgetStorage(storageId);
		await createVersionStore(storageId, { [WIDGET]: 0, SchemaVersion: 0 });
		await registerWidgetStorage(storageId);

		const started = new SchemaVersionService().start();

		if (connectorType.reportsMissingColumns) {
			await expect(started).rejects.toMatchObject({
				message: "schemaVersionService.columnsMissingWithoutMigration",
				properties: { schemaName: WIDGET, missingColumns: "valueHash" }
			});
		} else {
			await expect(started).resolves.toBeUndefined();
		}
	});

	test("fails at start in detect-only mode when a version bump adds a property", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 1, HASHED_SHAPE);
		await seedWidgetStorage(storageId);
		const versionStore = await createVersionStore(storageId, { [WIDGET]: 0, SchemaVersion: 0 });
		await registerWidgetStorage(storageId);

		const started = new SchemaVersionService({ config: { enabled: false } }).start();

		if (connectorType.reportsMissingColumns) {
			await expect(started).rejects.toMatchObject({
				message: "schemaVersionService.columnsMissingWithoutMigration",
				properties: { schemaName: WIDGET, missingColumns: "valueHash" }
			});
		} else {
			await expect(started).resolves.toBeUndefined();
		}
		expect((await readVersions(versionStore))[WIDGET]).toEqual(0);
	});

	test("rebuilds storage missing a property when the connector version changes", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 0, HASHED_SHAPE);
		await seedWidgetStorage(storageId);
		const versionStore = await createVersionStore(
			storageId,
			{ [WIDGET]: 0, SchemaVersion: 0 },
			"previous"
		);
		await registerWidgetStorage(storageId);

		await new SchemaVersionService().start();

		expect(await readVersions(versionStore)).toEqual({
			[WIDGET]: 0,
			SchemaVersion: 0,
			[CONNECTOR_VERSION_KEY]: versionStore.connectorVersion()
		});
		expect(await registeredWidgetStorage().get("1")).toEqual(SEED_ROW);
		await expectHashWritable(registeredWidgetStorage());
	});

	test("applies every step when the stored version is several versions behind", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET_V1, 1, HASHED_SHAPE);
		registerWidgetSchema(WIDGET, 2, [...HASHED_SHAPE, LABEL_PROPERTY]);
		await seedWidgetStorage(storageId);
		const versionStore = await createVersionStore(storageId, { [WIDGET]: 0, SchemaVersion: 0 });
		await registerWidgetStorage(storageId);

		await new SchemaVersionService().start();

		expect((await readVersions(versionStore))[WIDGET]).toEqual(2);
		const migrated = registeredWidgetStorage();
		expect(await migrated.get("1")).toEqual(SEED_ROW);
		const row: Widget = { id: "2", type: "alias", value: "Other", valueHash: HASH, label: "Label" };
		await migrated.set(row);
		expect(await migrated.get("2")).toEqual(row);
	});

	test("renames a property through a registered migration", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 1, [ID_PROPERTY, UNINDEXED_TYPE_PROPERTY, LABEL_PROPERTY]);
		registerWidgetMigration(0, { renames: [{ from: "value", to: "label" }] });
		await seedWidgetStorage(storageId);
		await createVersionStore(storageId, { [WIDGET]: 0, SchemaVersion: 0 });
		await registerWidgetStorage(storageId);

		await new SchemaVersionService().start();

		expect(await registeredWidgetStorage().get("1")).toEqual({
			id: "1",
			type: "alias",
			label: "Acme"
		});
	});

	test("fills a new property through a registered transform", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 1, HASHED_SHAPE);
		registerWidgetMigration(0, {
			transformEntity: entity => ({ ...entity, valueHash: entity.value?.toLowerCase() })
		});
		await seedWidgetStorage(storageId);
		await createVersionStore(storageId, { [WIDGET]: 0, SchemaVersion: 0 });
		await registerWidgetStorage(storageId);

		await new SchemaVersionService().start();

		expect(await registeredWidgetStorage().get("1")).toEqual({ ...SEED_ROW, valueHash: "acme" });
	});

	test("drops a removed property from the migrated rows and storage", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 1, [ID_PROPERTY, UNINDEXED_TYPE_PROPERTY]);
		await seedWidgetStorage(storageId);
		await createVersionStore(storageId, { [WIDGET]: 0, SchemaVersion: 0 });
		await registerWidgetStorage(storageId);

		await new SchemaVersionService().start();

		expect(await registeredWidgetStorage().get("1")).toEqual({ id: "1", type: "alias" });

		// A connector for the original shape finds the rebuilt storage no longer has the column.
		const probe = await createStorage<Widget>(WIDGET_V0, storageId);
		expect(probe.getMissingColumns?.() ?? []).toEqual(
			connectorType.reportsMissingColumns ? ["value"] : []
		);
	});

	test("migrates existing storage that has no version record", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 1, HASHED_SHAPE);
		await seedWidgetStorage(storageId);
		const versionStore = await createVersionStore(storageId, {}, "none");
		await registerWidgetStorage(storageId);

		await new SchemaVersionService().start();

		expect((await readVersions(versionStore))[WIDGET]).toEqual(1);
		expect(await registeredWidgetStorage().get("1")).toEqual(SEED_ROW);
		await expectHashWritable(registeredWidgetStorage());
	});

	test("leaves the storage untouched when a migration step is missing", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 1, HASHED_SHAPE);
		const seeder = await seedWidgetStorage(storageId);
		EntitySchemaFactory.unregister(WIDGET_V0);
		const versionStore = await createVersionStore(storageId, { [WIDGET]: 0, SchemaVersion: 0 });
		await registerWidgetStorage(storageId);

		await expect(new SchemaVersionService().start()).rejects.toMatchObject({
			message: "schemaVersionService.noMigrationStep",
			properties: { schemaName: WIDGET, missingFromVersion: 0 }
		});

		expect((await readVersions(versionStore))[WIDGET]).toEqual(0);
		expect(await seeder.get("1")).toEqual(SEED_ROW);
	});

	test("leaves the storage untouched when the stored version is newer", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 1, UNHASHED_SHAPE);
		await seedWidgetStorage(storageId);
		const versionStore = await createVersionStore(storageId, { [WIDGET]: 2, SchemaVersion: 0 });
		const widgets = await registerWidgetStorage(storageId);

		await expect(new SchemaVersionService().start()).rejects.toMatchObject({
			message: "schemaVersionService.storedVersionNewer",
			properties: { schemaName: WIDGET, stored: 2, current: 1 }
		});

		expect((await readVersions(versionStore))[WIDGET]).toEqual(2);
		expect(await widgets.get("1")).toEqual(SEED_ROW);
	});

	test("refuses to start after an interrupted migration", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 1, HASHED_SHAPE);
		const seeder = await seedWidgetStorage(storageId);
		const versionStore = await createVersionStore(storageId, {
			[WIDGET]: 0,
			[`${WIDGET}:finalizing`]: 1,
			SchemaVersion: 0
		});
		await registerWidgetStorage(storageId);

		await expect(new SchemaVersionService().start()).rejects.toMatchObject({
			message: "schemaVersionService.migrationInterrupted",
			properties: { schemaName: WIDGET, version: 1 }
		});

		expect((await readVersions(versionStore))[WIDGET]).toEqual(0);
		expect(await seeder.get("1")).toEqual(SEED_ROW);
	});

	test("changes nothing when started again after a migration", async () => {
		const storageId = uniqueStorageId();
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 1, HASHED_SHAPE);
		await seedWidgetStorage(storageId);
		const versionStore = await createVersionStore(storageId, { [WIDGET]: 0, SchemaVersion: 0 });
		await registerWidgetStorage(storageId);

		await new SchemaVersionService().start();
		const migrated = registeredWidgetStorage();
		const versions = await readVersions(versionStore);

		await new SchemaVersionService().start();

		expect(registeredWidgetStorage()).toBe(migrated);
		expect(await readVersions(versionStore)).toEqual(versions);
		expect(await migrated.get("1")).toEqual(SEED_ROW);
	});

	test("migrates the rows of every partition", async () => {
		const storageId = uniqueStorageId();
		const partitionContextIds = [ContextIdKeys.Node, ContextIdKeys.Tenant];
		const partitions = [
			{ [ContextIdKeys.Node]: "node1", [ContextIdKeys.Tenant]: "tenant1" },
			{ [ContextIdKeys.Node]: "node1", [ContextIdKeys.Tenant]: "tenant2" }
		];
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 1, HASHED_SHAPE);
		const seeder = await createStorage<Widget>(WIDGET_V0, storageId, partitionContextIds);
		for (const partition of partitions) {
			await ContextIdStore.run(partition, async () =>
				seeder.set({ ...SEED_ROW, value: partition[ContextIdKeys.Tenant] })
			);
		}
		await createVersionStore(storageId, { [WIDGET]: 0, SchemaVersion: 0 });
		await registerWidgetStorage(storageId, partitionContextIds);

		// Only the node is in context at start-up, as in the engine.
		await ContextIdStore.run({ [ContextIdKeys.Node]: "node1" }, async () =>
			new SchemaVersionService().start()
		);

		const migrated = registeredWidgetStorage();
		for (const partition of partitions) {
			expect(await ContextIdStore.run(partition, async () => migrated.get("1"))).toEqual({
				...SEED_ROW,
				value: partition[ContextIdKeys.Tenant]
			});
		}
	});

	test("migrates every row when the rows span several batches", async () => {
		const storageId = uniqueStorageId();
		const rows = [1, 2, 3, 4, 5].map(rowNumber => ({
			...SEED_ROW,
			id: `${rowNumber}`,
			value: `Value ${rowNumber}`
		}));
		registerWidgetSchema(WIDGET_V0, 0, UNHASHED_SHAPE);
		registerWidgetSchema(WIDGET, 1, HASHED_SHAPE);
		await seedWidgetStorage(storageId, rows);
		await createVersionStore(storageId, { [WIDGET]: 0, SchemaVersion: 0 });
		await registerWidgetStorage(storageId);

		await new SchemaVersionService({ config: { batchSize: 2 } }).start();

		const migrated = await registeredWidgetStorage().query();
		expect(migrated.entities.map(row => row.id).sort()).toEqual(rows.map(row => row.id).sort());
		expect(migrated.entities).toEqual(expect.arrayContaining(rows));
	});
});
