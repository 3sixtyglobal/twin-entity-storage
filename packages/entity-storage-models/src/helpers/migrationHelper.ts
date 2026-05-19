// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore, type IContextIds } from "@twin.org/context";
import { Coerce, GeneralError, Is, ObjectHelper } from "@twin.org/core";
import {
	EntitySchemaDiffHelper,
	EntitySchemaPropertyType,
	type IEntitySchemaDiff
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import type { IEntityStorageConnector } from "../models/IEntityStorageConnector.js";
import type { IEntityStorageMigrationConnector } from "../models/IEntityStorageMigrationConnector.js";
import type { IMigrationOptions } from "../models/IMigrationOptions.js";

/**
 * Helper class for performing schema migrations between two connectors.
 */
export class MigrationHelper {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<MigrationHelper>();

	/**
	 * Performs a migration between two connectors, using the provided options and schema diff to control the migration behaviour.
	 * @param sourceConnector The connector to migrate from to allow the migration helper to create the new connector and finalize the migration.
	 * @param targetEntitySchemaName The name of the new entity schema.
	 * @param renames An optional list of property renames to apply during migration.
	 * @param options Options controlling migration behaviour.
	 * @param loggingComponentType An optional logging component type to use for bootstrapping and starting connectors if necessary.
	 * @returns The connector for the new schema and the number of entities successfully migrated, the sourceConnector will no longer be usable, finalConnector will be undefined if no migration was necessary.
	 */
	public static async migrate<T, U>(
		sourceConnector: IEntityStorageMigrationConnector<T>,
		targetEntitySchemaName: string,
		renames?: { from: string; to: string }[],
		options?: IMigrationOptions<T, U>,
		loggingComponentType?: string
	): Promise<{
		finalConnector?: IEntityStorageConnector<U>;
		migrated: number;
	}> {
		let targetConnector: IEntityStorageConnector<U> | undefined;
		try {
			// We use the migration method to create the new connector as it will use a temporary storage location if necessary
			targetConnector = await sourceConnector.createTargetConnector<U>(targetEntitySchemaName);

			// Startup both connectors to ensure they are ready for the migration, this will call bootstrap and start if they are defined.
			await MigrationHelper.startupConnector<T>(sourceConnector, loggingComponentType);
			await MigrationHelper.startupConnector<U>(targetConnector, loggingComponentType);

			// Get the unique partition context ids to run the migration for each partition.
			let partitionContextIds = await sourceConnector.getPartitionContextIds();

			// If there are no partitions, we still want to run the migration once to handle the schema changes,
			// so we create a single empty context for the migration to run in.
			if (!Is.arrayValue(partitionContextIds)) {
				partitionContextIds ??= [];
				partitionContextIds.push({});
			}

			// Get the schemas
			const sourceSchema = sourceConnector.getSchema();
			const targetSchema = targetConnector.getSchema();

			// Get the schema diff between the source and target schemas.
			const schemaDiff = EntitySchemaDiffHelper.diff<T, U>(
				sourceSchema.properties ?? [],
				targetSchema.properties ?? [],
				renames
			);

			// Only perform a migration if the schemas have changed
			if (EntitySchemaDiffHelper.hasChanges(schemaDiff)) {
				// Perform the migration, which will read from the current store and write to the target connector's store.
				const migrated = await MigrationHelper.migrateEntities<T, U>(
					sourceConnector,
					targetConnector,
					partitionContextIds,
					schemaDiff,
					options
				);

				// The migration is now complete, finalize the migration which could entail
				// renaming of resources etc, determined by the implementation of finalizeMigration.
				// it also needs to stop and teardown any resources no longer in use after the migration,
				// such as the old connector and its underlying storage.
				const finalConnector = await sourceConnector.finalizeMigration(
					targetConnector,
					options,
					loggingComponentType
				);

				return {
					finalConnector,
					migrated
				};
			}

			return {
				finalConnector: undefined,
				migrated: 0
			};
		} catch (error) {
			await sourceConnector.cleanupMigration(targetConnector, options, loggingComponentType);

			throw new GeneralError(MigrationHelper.CLASS_NAME, "migrationFailed", undefined, error);
		}
	}

	/**
	 * Generic per-partition migration loop.
	 * @param source Connector to read from (current schema, already bootstrapped).
	 * @param target Connector to write to (new schema, already bootstrapped).
	 * @param partitionContextIds The context ids to use for the migration, used for partitioning and can be used in the transform function when `options.transformEntityProperty` is provided.
	 * @param schemaDiff The schema diff.
	 * @param options Optional migration controls (batchSize, transformEntity, onProgress).
	 * @returns The number of entities successfully migrated.
	 */
	public static async migrateEntities<T = unknown, U = T>(
		source: IEntityStorageMigrationConnector<T>,
		target: IEntityStorageConnector<U>,
		partitionContextIds: IContextIds[],
		schemaDiff: IEntitySchemaDiff<T, U>,
		options?: IMigrationOptions<T, U>
	): Promise<number> {
		let migrated = 0;

		await options?.onStepProgress?.("migrationStart", 0, 0);

		const effectivePartitions: IContextIds[] =
			partitionContextIds.length > 0 ? partitionContextIds : [{}];

		for (let i = 0; i < effectivePartitions.length; i++) {
			await ContextIdStore.run(effectivePartitions[i], async () => {
				await options?.onStepProgress?.("partitionStart", effectivePartitions.length, i);

				migrated += await MigrationHelper.migratePartition(
					source,
					target,
					effectivePartitions.length,
					i,
					schemaDiff,
					options
				);

				await options?.onStepProgress?.("partitionEnd", effectivePartitions.length, i);
			});
		}

		await options?.onStepProgress?.("migrationEnd", 0, 0);

		return migrated;
	}

	/**
	 * Generic per-partition migration loop.
	 * @param source Connector to read from (current schema, already bootstrapped).
	 * @param target Connector to write to (new schema, already bootstrapped).
	 * @param partitionTotal The total number of partitions to migrate, used for progress reporting.
	 * @param partitionIndex The index of the current partition being migrated, used for progress reporting.
	 * @param schemaDiff Schema diff used to add nullable defaults and drop removed fields when `options.transformEntity` is not provided.
	 * @param options Optional migration controls (batchSize, transformEntity, onProgress).
	 * @returns The number of entities successfully migrated.
	 */
	public static async migratePartition<T = unknown, U = unknown>(
		source: IEntityStorageConnector<T>,
		target: IEntityStorageConnector<U>,
		partitionTotal: number,
		partitionIndex: number,
		schemaDiff: IEntitySchemaDiff<T, U>,
		options?: IMigrationOptions<T, U>
	): Promise<number> {
		const batchSize = options?.batchSize ?? 100;
		let migrated = 0;
		let cursor: string | undefined;

		const totalEntities = await source.count();

		await options?.onPartitionProgress?.(totalEntities, 0);

		if (totalEntities > 0) {
			do {
				const page = await source.query(undefined, undefined, undefined, cursor, batchSize);
				cursor = page.cursor;

				if (Is.arrayValue(page.entities)) {
					const transformedBatch: U[] = [];

					for (const entity of page.entities) {
						const transformedEntity = MigrationHelper.applyEntityTransform<T, U>(
							entity,
							schemaDiff,
							options
						);
						transformedBatch.push(transformedEntity);
					}

					await target.setBatch(transformedBatch);
					migrated += transformedBatch.length;
				}

				await options?.onPartitionProgress?.(totalEntities, migrated);
			} while (Is.stringValue(cursor));
		}

		return migrated;
	}

	/**
	 * Applies the entity transformation for migration, using the provided options and schema diff.
	 * @param entity The entity to transform.
	 * @param schemaDiff The schema diff between the old and new schemas.
	 * @param options The migration options.
	 * @returns The transformed entity ready to be written to the new schema.
	 * @throws GeneralError if a transformation is required for an object or array property but no `options.transformEntityProperty` function is provided.
	 * @throws GeneralError if coercion of a modified property results in undefined for a non-optional target property.
	 */
	public static applyEntityTransform<T = unknown, U = unknown>(
		entity: Partial<T>,
		schemaDiff: IEntitySchemaDiff<T, U>,
		options?: IMigrationOptions<T, U>
	): U {
		const newEntity = {} as U;

		for (const property of schemaDiff.unchanged) {
			ObjectHelper.propertySet(
				newEntity,
				property.property as string,
				ObjectHelper.propertyGet(entity, property.property as string)
			);
		}

		for (const change of schemaDiff.added) {
			let defValue;

			if (!(change.optional ?? false)) {
				if (change.type === EntitySchemaPropertyType.Boolean) {
					defValue = false;
				} else if (
					change.type === EntitySchemaPropertyType.Number ||
					change.type === EntitySchemaPropertyType.Integer
				) {
					defValue = 0;
				} else if (change.type === EntitySchemaPropertyType.String) {
					defValue = "";
				} else if (change.type === EntitySchemaPropertyType.Array) {
					defValue = [];
				} else if (change.type === EntitySchemaPropertyType.Object) {
					defValue = {};
				}
			}

			if (Is.notEmpty(defValue)) {
				ObjectHelper.propertySet(newEntity, change.property as string, defValue);
			}
		}

		for (const change of schemaDiff.modified) {
			const currentValue = ObjectHelper.propertyGet(entity, change.from.property as string);
			let newValue;

			if (change.to.type === EntitySchemaPropertyType.Boolean) {
				newValue = Coerce.boolean(currentValue);
			} else if (
				change.to.type === EntitySchemaPropertyType.Number ||
				change.to.type === EntitySchemaPropertyType.Integer
			) {
				newValue = Coerce.number(currentValue);
			} else if (change.to.type === EntitySchemaPropertyType.String) {
				newValue = Coerce.string(currentValue);
			} else if (
				change.to.type === EntitySchemaPropertyType.Array ||
				change.to.type === EntitySchemaPropertyType.Object
			) {
				if (!Is.function(options?.transformEntityProperty)) {
					throw new GeneralError(MigrationHelper.CLASS_NAME, "transformRequiredForProperty", {
						from: change.from.property,
						to: change.to.property,
						type: change.from.type
					});
				}

				newValue = options.transformEntityProperty(change.from, change.to, currentValue);
			}

			if (newValue === undefined && !(change.to.optional ?? false)) {
				throw new GeneralError(MigrationHelper.CLASS_NAME, "coercionProducedUndefined", {
					property: change.to.property,
					type: change.to.type
				});
			}

			if (Is.notEmpty(newValue)) {
				ObjectHelper.propertySet(newEntity, change.to.property as string, newValue);
			}
		}

		// Removed properties are simply dropped.
		// for (const change of schemaDiff.removed) {
		// }

		return newEntity;
	}

	/**
	 * Startup the connector by calling bootstrap and start if they are defined.
	 * @param connector The connector to startup.
	 * @param loggingComponentType An optional logging component type to use for bootstrapping and starting the connector.
	 * @returns Nothing.
	 * @internal
	 */
	private static async startupConnector<T>(
		connector: IEntityStorageConnector<T>,
		loggingComponentType: string | undefined
	): Promise<void> {
		const bootstrap = connector.bootstrap?.bind(connector);
		if (Is.function(bootstrap)) {
			await bootstrap(loggingComponentType);
		}
		const start = connector.start?.bind(connector);
		if (Is.function(start)) {
			await start(loggingComponentType);
		}
	}
}
