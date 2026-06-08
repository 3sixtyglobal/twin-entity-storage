// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { GeneralError, Is, type IComponent } from "@twin.org/core";
import { EntitySchemaFactory, EntitySchemaHelper, type IEntitySchema } from "@twin.org/entity";
import {
	EntityStorageConnectorFactory,
	MigrationHelper,
	SchemaMigrationFactory,
	type IEntityStorageConnector,
	type IEntityStorageMigrationConnector,
	type IResolvedMigrationStep
} from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";
import { SchemaVersion } from "./entities/schemaVersion.js";
import type { ISchemaVersionServiceConstructorOptions } from "./models/ISchemaVersionServiceConstructorOptions.js";

/**
 * Service that checks and applies entity schema migrations at every node start-up.
 *
 * This service should be registered as the first component so that its start() runs before
 * any other service. By the time start() is called, all component bootstraps have completed
 * (every table already exists) and EntitySchemaFactory / EntityStorageConnectorFactory are
 * fully populated with every registered schema and connector.
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
	 * @internal
	 */
	private readonly _schemaVersionConnector: IEntityStorageConnector<SchemaVersion>;

	/**
	 * Create a new SchemaVersionService.
	 * @param options The constructor options.
	 */
	constructor(options: ISchemaVersionServiceConstructorOptions) {
		this._schemaVersionConnector = EntityStorageConnectorFactory.get(
			options.schemaVersionStorageType ?? "schema-version"
		);
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

		// 2. Read ALL stored version records in one query.
		const queryResult = await this._schemaVersionConnector.query();
		const storedVersions = new Map<string, number>();
		for (const record of queryResult.entities ?? []) {
			if (Is.object<SchemaVersion>(record)) {
				storedVersions.set(record.schemaName, record.version);
			}
		}

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
				nodeLoggingComponentType
			);
		}

		// 4. Process all remaining schemas.
		for (const [schemaName, schema] of currentSchemas) {
			await this.processSchema(
				schemaName,
				schema,
				storedVersions,
				historicalByBase.get(schemaName),
				nodeLoggingComponentType
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
	 * @param nodeLoggingComponentType An optional logging component type.
	 * @internal
	 */
	private async processSchema(
		schemaName: string,
		schema: IEntitySchema,
		storedVersions: Map<string, number>,
		history: Map<number, IEntitySchema> | undefined,
		nodeLoggingComponentType: string | undefined
	): Promise<void> {
		const currentVersion = EntitySchemaHelper.getVersion(schema);

		// Find the entity-storage connector whose schema type matches this schema name.
		const connector = this.findConnector(schemaName);
		if (!connector) {
			// No connector registered for this schema — nothing to migrate.
			return;
		}

		// Resolve the stored version, applying the backwards-compat baseline when no record exists.
		const stored = storedVersions.get(schemaName);
		let resolvedStored: number;

		if (stored === undefined) {
			// No version record: treat as v0 regardless of whether the table has data.
			// On SQL connectors the table may have a stale column structure even when empty;
			// running the chain over zero rows still calls finalizeMigration, which reconciles
			// the table shape via a connector swap.
			// Deployment precondition: any pre-existing data is genuinely at v0. A deployment
			// that hand-applied a later schema before this service was introduced would be
			// incorrectly replayed v0→…→current and should be seeded with an explicit record.
			resolvedStored = 0;
			await this.writeVersion(schemaName, 0);
		} else {
			resolvedStored = stored;
		}

		// No-op: stored version already matches current.
		if (resolvedStored === currentVersion) {
			return;
		}

		// Downgrade — not supported.
		if (resolvedStored > currentVersion) {
			throw new GeneralError(SchemaVersionService.CLASS_NAME, "storedVersionNewer", {
				schemaName,
				stored: resolvedStored,
				current: currentVersion
			});
		}

		// Migration is needed. If the connector does not support it, throw immediately so
		// the problem surfaces at boot rather than at runtime when writes hit the wrong table shape.
		if (!("createTargetConnector" in connector)) {
			throw new GeneralError(SchemaVersionService.CLASS_NAME, "connectorNotMigrationCapable", {
				schemaName,
				stored: resolvedStored,
				current: currentVersion
			});
		}

		const migrationConnector = connector as IEntityStorageMigrationConnector;

		// Upgrade — resolve and run the chain.
		const steps: IResolvedMigrationStep[] = [];

		for (let v = resolvedStored; v < currentVersion; v++) {
			const fromSchema = history?.get(v);
			if (!fromSchema) {
				throw new GeneralError(SchemaVersionService.CLASS_NAME, "noMigrationStep", {
					schemaName,
					stored: resolvedStored,
					current: currentVersion,
					missingFromVersion: v,
					missingToVersion: v + 1
				});
			}

			const toSchema = v + 1 < currentVersion ? history?.get(v + 1) : schema;
			if (!toSchema) {
				throw new GeneralError(SchemaVersionService.CLASS_NAME, "noMigrationStepTarget", {
					schemaName,
					stored: resolvedStored,
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

		await MigrationHelper.migrateWithChain(
			migrationConnector,
			schemaName,
			steps,
			nodeLoggingComponentType
		);

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
		await this._schemaVersionConnector.set({
			schemaName,
			version,
			updatedAt: new Date().toISOString()
		});
	}

	/**
	 * Searches EntityStorageConnectorFactory for the connector whose registered schema type
	 * matches the given schema name.
	 * @param schemaName The entity type name to look up.
	 * @returns The matching connector, or undefined if none is registered.
	 * @internal
	 */
	private findConnector(schemaName: string): IEntityStorageConnector | undefined {
		for (const name of EntityStorageConnectorFactory.names()) {
			try {
				const connector = EntityStorageConnectorFactory.get(name);
				if (connector.getSchema?.().type === schemaName) {
					return connector;
				}
			} catch {
				// Connector not yet created or registration issue — skip.
			}
		}
		return undefined;
	}
}
