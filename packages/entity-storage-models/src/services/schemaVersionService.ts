// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { GeneralError, Guards, Is, type IComponent } from "@twin.org/core";
import { EntitySchemaFactory, EntitySchemaHelper, type IEntitySchema } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { SchemaVersion } from "../entities/schemaVersion.js";
import { EntityStorageConnectorFactory } from "../factories/entityStorageConnectorFactory.js";
import { SchemaMigrationFactory } from "../factories/schemaMigrationFactory.js";
import { MigrationHelper } from "../helpers/migrationHelper.js";
import type { IEntityStorageConnector } from "../models/IEntityStorageConnector.js";
import type { IEntityStorageMigrationConnector } from "../models/IEntityStorageMigrationConnector.js";
import type { IResolvedMigrationStep } from "../models/IResolvedMigrationStep.js";

/**
 * IComponent service that checks and applies entity schema migrations at every node start-up.
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
	 * @internal
	 */
	private readonly _versionConnector: IEntityStorageConnector<SchemaVersion>;

	/**
	 * Create a new SchemaVersionService.
	 * @param versionConnector Entity-storage connector backed by the schemaVersion table.
	 */
	constructor(versionConnector: IEntityStorageConnector<SchemaVersion>) {
		Guards.object<IEntityStorageConnector<SchemaVersion>>(
			SchemaVersionService.CLASS_NAME,
			nameof(versionConnector),
			versionConnector
		);
		this._versionConnector = versionConnector;
	}

	/**
	 * Searches EntityStorageConnectorFactory for the connector whose registered schema type
	 * matches the given schema name.
	 * @param schemaName The entity type name to look up.
	 * @returns The matching connector, or undefined if none is registered.
	 * @internal
	 */
	private static findConnector(schemaName: string): IEntityStorageConnector | undefined {
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

	/**
	 * Returns the class name.
	 * @returns The class name.
	 */
	public className(): string {
		return SchemaVersionService.CLASS_NAME;
	}

	/**
	 * Bootstraps the version-store connector so the schemaVersion table exists
	 * before start() attempts to read or write version records.
	 * @param nodeLoggingComponentType An optional logging component type.
	 * @returns True on success.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const bootstrapFn = this._versionConnector.bootstrap?.bind(this._versionConnector);
		if (Is.function(bootstrapFn)) {
			return bootstrapFn(nodeLoggingComponentType);
		}
		return true;
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
		// For SchemaVersion itself, use the injected connector directly rather than re-discovering
		// it through the factory, which could resolve a different instance than _versionConnector.
		const connector =
			schemaName === nameof(SchemaVersion)
				? this._versionConnector
				: SchemaVersionService.findConnector(schemaName);
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
		await this._versionConnector.set({
			schemaName,
			version,
			updatedAt: new Date().toISOString()
		});
	}
}
