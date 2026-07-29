// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ComponentFactory, GeneralError, Is, type IComponent } from "@twin.org/core";
import { EntitySchemaFactory, EntitySchemaHelper, type IEntitySchema } from "@twin.org/entity";
import {
	EntityStorageConnectorFactory,
	type IEntityStorageConnector,
	type IEntityStorageMigrationConnector,
	type IMigrationOptions,
	type IResolvedMigrationStep,
	MigrationHelper,
	SchemaMigrationFactory
} from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { SchemaVersion } from "./entities/schemaVersion.js";
import type { ISchemaVersionServiceConfig } from "./models/ISchemaVersionServiceConfig.js";
import type { ISchemaVersionServiceConstructorOptions } from "./models/ISchemaVersionServiceConstructorOptions.js";

/**
 * Service that checks and applies entity schema migrations at every node start-up.
 *
 * This service must be the first entry in coreTypeInitialisers.json. The engine iterates that
 * array in order to determine start sequence — there is no engine-level priority mechanism, so
 * registration position is the only guarantee that start() runs before any other service.
 * By the time start() is called, all component bootstraps have completed (every table already
 * exists) and EntitySchemaFactory / EntityStorageConnectorFactory are fully populated with every
 * registered schema and connector.
 *
 * Migration mechanics: old schema versions are registered in EntitySchemaFactory by naming
 * convention — current schema = "MyEntity", first history = "MyEntityV0", second = "MyEntityV1".
 * The service groups schemas by base name (strips the trailing V number suffix) and resolves the
 * migration chain automatically by diffing consecutive versioned schemas. For steps that require
 * property renames or a custom transform hook, register an optional ISchemaMigration entry in
 * SchemaMigrationFactory under the key "Base_from_to" (e.g. "MyEntity_0_1").
 *
 * Crash-window note: finalizeMigration and the subsequent version-record write are two
 * separate operations. If the process dies between them the next boot re-runs the chain
 * over already-migrated data. applyEntityTransform is NOT idempotent for structural changes
 * (newly-added optional fields would be dropped on re-run). A transaction spanning both
 * writes is a precondition for production; track this in the concurrency follow-up.
 */
export class SchemaVersionService implements IComponent {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<SchemaVersionService>();

	/**
	 * Regex to detect a versioned schema name and extract the base name and version number.
	 * Matches names like "MyEntityV0", "AuditableItemGraphV2", etc.
	 * @internal
	 */
	private static readonly _VERSION_SUFFIX_RE = /^(.+)V(\d+)$/;

	/**
	 * The connector used to read and write SchemaVersion records.
	 * Not readonly because finalizeMigration may return a replacement connector object.
	 * @internal
	 */
	private _versionConnector: IEntityStorageConnector<SchemaVersion>;

	/**
	 * Optional config passed through constructor options.
	 * @internal
	 */
	private readonly _config?: ISchemaVersionServiceConfig;

	/**
	 * Create a new SchemaVersionService.
	 * @param options Optional constructor options.
	 */
	constructor(options?: ISchemaVersionServiceConstructorOptions) {
		this._versionConnector = EntityStorageConnectorFactory.get(
			options?.schemaVersionStorageType ?? "schema-version"
		);
		this._config = options?.config;
	}

	/**
	 * Returns the class name.
	 * @returns The class name.
	 */
	public className(): string {
		return SchemaVersionService.CLASS_NAME;
	}

	/**
	 * Reads all registered entity schemas, groups versioned schemas by base name, reads the
	 * full schemaVersion table in one pass, then orchestrates chain migrations for any schema
	 * whose stored version is behind the current version declared in EntitySchemaFactory.
	 * SchemaVersion itself is processed first so the version store is migrated before any
	 * version records are written for other schemas.
	 *
	 * Runs after all component bootstraps, so every managed table already exists.
	 * @param nodeLoggingComponentType An optional logging component type.
	 */
	public async start(nodeLoggingComponentType?: string): Promise<void> {
		const logging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		const migrationOptions: IMigrationOptions = {
			batchSize: this._config?.batchSize,
			onProgress: async (progressItem, itemTotal, itemIndex) => {
				await this.logProgress(logging, progressItem, itemTotal, itemIndex);
			}
		};

		// 1. Collect all registered schema names and partition into current vs historical.
		const allNames = EntitySchemaFactory.names();

		const historicalByBase = new Map<string, Map<number, IEntitySchema>>();
		const currentSchemas = new Map<string, IEntitySchema>();

		for (const name of allNames) {
			const match = SchemaVersionService._VERSION_SUFFIX_RE.exec(name);
			if (match) {
				const baseName = match[1];
				const version = Number.parseInt(match[2], 10);
				let versions = historicalByBase.get(baseName);
				if (!versions) {
					versions = new Map();
					historicalByBase.set(baseName, versions);
				}
				versions.set(version, EntitySchemaFactory.get(name));
			} else {
				currentSchemas.set(name, EntitySchemaFactory.get(name));
			}
		}

		// 2. Read ALL stored version records, paging through the full table.
		const storedVersions = new Map<string, number>();
		let cursor: string | undefined;
		do {
			const queryResult = await this._versionConnector.query(
				undefined,
				undefined,
				undefined,
				cursor
			);
			for (const record of queryResult.entities ?? []) {
				if (Is.object<SchemaVersion>(record)) {
					storedVersions.set(record.schemaName, record.version);
				}
			}
			cursor = queryResult.cursor;
		} while (Is.stringValue(cursor));

		// 3. Process SchemaVersion first so the version store itself is fully migrated
		//    before any version records are written for other schemas.
		const schemaVersionName = nameof(SchemaVersion);
		const schemaVersionSchema = currentSchemas.get(schemaVersionName);
		if (schemaVersionSchema) {
			currentSchemas.delete(schemaVersionName);
			await this.processSchema(
				schemaVersionName,
				schemaVersionSchema,
				storedVersions,
				historicalByBase.get(schemaVersionName),
				migrationOptions,
				nodeLoggingComponentType,
				logging
			);
		}

		// 4. Process all remaining schemas.
		for (const [schemaName, schema] of currentSchemas) {
			await this.processSchema(
				schemaName,
				schema,
				storedVersions,
				historicalByBase.get(schemaName),
				migrationOptions,
				nodeLoggingComponentType,
				logging
			);
		}
	}

	/**
	 * Checks and applies any pending migration for a single entity schema.
	 * Extracted to avoid continue statements in the outer loop.
	 * @param schemaName The base schema name.
	 * @param schema The current schema definition.
	 * @param storedVersions The full map of stored version records.
	 * @param history The versioned-schema map for this schema (historicalByBase.get(schemaName)), or undefined if none exist.
	 * @param migrationOptions The migration options to pass through to MigrationHelper.
	 * @param loggingComponentType The optional component type to use for logging the migration progress.
	 * @param logging An optional logging component to pass through to MigrationHelper for migration progress logging.
	 * @internal
	 */
	private async processSchema(
		schemaName: string,
		schema: IEntitySchema,
		storedVersions: Map<string, number>,
		history: Map<number, IEntitySchema> | undefined,
		migrationOptions: IMigrationOptions,
		loggingComponentType: string | undefined,
		logging: ILoggingComponent | undefined
	): Promise<void> {
		const currentVersion = EntitySchemaHelper.getVersion(schema);

		// Find the entity-storage connector whose schema type matches this schema name.
		// For SchemaVersion itself, use the injected connector directly rather than re-discovering
		// it through the factory, which could resolve a different instance than _versionConnector.
		const connectorEntry =
			schemaName === nameof(SchemaVersion)
				? { connector: this._versionConnector as IEntityStorageConnector, factoryKey: undefined }
				: this.findConnector(schemaName);
		if (!connectorEntry) {
			// No connector registered for this schema — nothing to migrate.
			return;
		}
		const { connector, factoryKey } = connectorEntry;

		// Resolve the stored version, applying the backwards-compat baseline when no record exists.
		const stored = storedVersions.get(schemaName);
		let resolvedStoredVersion: number;

		if (stored === undefined) {
			// No version record: check whether the table has any data.
			// Empty table → this is a fresh bootstrap; seed at the current version so the
			// migration chain never runs over an already-current-shape (or empty) table.
			// Non-empty table → pre-existing data from before version tracking was introduced;
			// treat as v0 and run the migration chain. applyEntityTransform preserves existing
			// property values so current-shape rows are not degraded (issue #185, Bug 2).
			const tableCount = await connector.count();
			if (tableCount === 0) {
				await this.writeVersion(schemaName, currentVersion);
				return;
			}
			resolvedStoredVersion = 0;
			await this.writeVersion(schemaName, 0);
		} else {
			resolvedStoredVersion = stored;
		}

		// No-op: stored version already matches current.
		if (resolvedStoredVersion === currentVersion) {
			await logging?.log({
				source: SchemaVersionService.CLASS_NAME,
				level: "info",
				message: "noMigrationRequired",
				data: {
					schemaName,
					version: resolvedStoredVersion
				}
			});
			return;
		}

		await logging?.log({
			source: SchemaVersionService.CLASS_NAME,
			level: "info",
			message: "migrationRequired",
			data: {
				schemaName,
				from: resolvedStoredVersion,
				to: currentVersion
			}
		});

		// Downgrade — not supported.
		if (resolvedStoredVersion > currentVersion) {
			throw new GeneralError(SchemaVersionService.CLASS_NAME, "storedVersionNewer", {
				schemaName,
				stored: resolvedStoredVersion,
				current: currentVersion
			});
		}

		// Migration is needed. If the connector does not support it, throw immediately so
		// the problem surfaces at boot rather than at runtime when writes hit the wrong table shape.
		if (!("createTargetConnector" in connector)) {
			throw new GeneralError(SchemaVersionService.CLASS_NAME, "connectorNotMigrationCapable", {
				schemaName,
				stored: resolvedStoredVersion,
				current: currentVersion
			});
		}

		const migrationConnector = connector as IEntityStorageMigrationConnector;

		// Upgrade — resolve and run the chain.
		const steps: IResolvedMigrationStep[] = [];

		for (let v = resolvedStoredVersion; v < currentVersion; v++) {
			const fromSchema = history?.get(v);
			if (!fromSchema) {
				throw new GeneralError(SchemaVersionService.CLASS_NAME, "noMigrationStep", {
					schemaName,
					stored: resolvedStoredVersion,
					current: currentVersion,
					missingFromVersion: v,
					missingToVersion: v + 1
				});
			}

			const toSchema = v + 1 < currentVersion ? history?.get(v + 1) : schema;
			if (!toSchema) {
				throw new GeneralError(SchemaVersionService.CLASS_NAME, "noMigrationStepTarget", {
					schemaName,
					stored: resolvedStoredVersion,
					current: currentVersion,
					missingFromVersion: v,
					missingToVersion: v + 1
				});
			}

			const overrideKey = `${schemaName}_${v}_${v + 1}`;
			const override = SchemaMigrationFactory.getIfExists(overrideKey);

			steps.push({
				fromProperties: fromSchema.properties ?? [],
				toProperties: toSchema.properties ?? [],
				renames: override?.renames,
				transformEntityProperty: override?.transformEntityProperty
			});
		}

		const { finalConnector } = await MigrationHelper.migrateWithChain(
			migrationConnector,
			schemaName,
			steps,
			migrationOptions,
			loggingComponentType
		);

		// Some connectors (e.g. in-memory) return a brand-new object from finalizeMigration
		// rather than mutating the source in place.  Re-register the factory entry so that any
		// subsequent EntityStorageConnectorFactory.get() call returns the migrated instance.
		if (finalConnector !== connector) {
			if (factoryKey) {
				EntityStorageConnectorFactory.register(factoryKey, () => finalConnector);
			}
			// For SchemaVersion keep _versionConnector in sync so writeVersion below uses
			// the migrated instance.
			if (schemaName === nameof(SchemaVersion)) {
				this._versionConnector = finalConnector as IEntityStorageConnector<SchemaVersion>;
			}
		}

		// Advance the stored version only after finalizeMigration has succeeded.
		// See crash-window note in the class comment.
		await this.writeVersion(schemaName, currentVersion);
	}

	/**
	 * Upserts a SchemaVersion record for the given schema name.
	 * @param schemaName The schema type name.
	 * @param version The version to record.
	 * @internal
	 */
	private async writeVersion(schemaName: string, version: number): Promise<void> {
		await this._versionConnector.set({
			schemaName,
			version,
			updatedAt: new Date().toISOString()
		});
	}

	/**
	 * Searches EntityStorageConnectorFactory for the connector whose registered schema type
	 * matches the given schema name.
	 * @param schemaName The entity type name to look up.
	 * @returns The matching connector and its factory key, or undefined if none is registered.
	 * @internal
	 */
	private findConnector(
		schemaName: string
	): { connector: IEntityStorageConnector; factoryKey: string } | undefined {
		for (const name of EntityStorageConnectorFactory.names()) {
			try {
				const connector = EntityStorageConnectorFactory.get(name);
				if (connector.getSchema?.().type === schemaName) {
					return { connector, factoryKey: name };
				}
			} catch {
				// Connector not yet created or registration issue — skip.
			}
		}
		return undefined;
	}

	/**
	 * Logs migration progress using the provided logging component, if available.
	 * @param logging The logging component to use for logging progress, if available.
	 * @param progressItem The progress item being updated.
	 * @param itemTotal The total number of items to process for this progress item.
	 * @param itemIndex The index of the current item being processed for this progress item.
	 * @internal
	 */
	private async logProgress(
		logging: ILoggingComponent | undefined,
		progressItem: string,
		itemTotal: number,
		itemIndex: number
	): Promise<void> {
		if (progressItem === "partitionStart") {
			await logging?.log({
				source: SchemaVersionService.CLASS_NAME,
				level: "info",
				message: "partitionStart",
				data: { progressItem, itemTotal, itemIndex }
			});
		} else if (progressItem === "partitionProgress") {
			await logging?.log({
				source: SchemaVersionService.CLASS_NAME,
				level: "info",
				message: "partitionProgress",
				data: { progressItem, itemTotal, itemIndex }
			});
		} else if (progressItem === "partitionEnd") {
			await logging?.log({
				source: SchemaVersionService.CLASS_NAME,
				level: "info",
				message: "partitionEnd",
				data: { progressItem, itemTotal, itemIndex }
			});
		} else if (progressItem === "partitionItemsStart") {
			await logging?.log({
				source: SchemaVersionService.CLASS_NAME,
				level: "info",
				message: "partitionItemsStart",
				data: { progressItem, itemTotal, itemIndex }
			});
		} else if (progressItem === "partitionItemsProgress") {
			await logging?.log({
				source: SchemaVersionService.CLASS_NAME,
				level: "info",
				message: "partitionItemsProgress",
				data: { progressItem, itemTotal, itemIndex }
			});
		} else if (progressItem === "partitionItemsEnd") {
			await logging?.log({
				source: SchemaVersionService.CLASS_NAME,
				level: "info",
				message: "partitionItemsEnd",
				data: { progressItem, itemTotal, itemIndex }
			});
		}
	}
}
