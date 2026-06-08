// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
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
import type { IResolvedMigrationStep } from "../models/IResolvedMigrationStep.js";

/**
 * Helper class for performing entity schema migrations between two connectors.
 * The chain-based API (migrateWithChain / applyEntityChain) is the single migration
 * path: a chain of one step covers the same case as a traditional single-step migration.
 */
export class MigrationHelper {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<MigrationHelper>();

	/**
	 * Applies the entity transformation for a single diff, handling added, removed, and
	 * modified properties according to the provided schema diff and optional transform hook.
	 * @param entity The entity to transform.
	 * @param schemaDiff The schema diff between the old and new schemas.
	 * @param transformEntityProperty Optional per-property transform hook for object/array properties.
	 * @returns The transformed entity ready to be written to the new schema.
	 * @throws GeneralError if a transformation is required for an object or array property but no transformEntityProperty function is provided.
	 * @throws GeneralError if coercion of a modified property results in undefined for a non-optional target property.
	 */
	public static applyEntityTransform<T = unknown, U = unknown>(
		entity: Partial<T>,
		schemaDiff: IEntitySchemaDiff<T, U>,
		transformEntityProperty?: IMigrationOptions<T, U>["transformEntityProperty"]
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
					defValue = change.defaultValue ?? false;
				} else if (
					change.type === EntitySchemaPropertyType.Number ||
					change.type === EntitySchemaPropertyType.Integer
				) {
					defValue = change.defaultValue ?? 0;
				} else if (change.type === EntitySchemaPropertyType.String) {
					defValue = change.defaultValue ?? "";
				} else if (change.type === EntitySchemaPropertyType.Array) {
					defValue = change.defaultValue ?? [];
				} else if (change.type === EntitySchemaPropertyType.Object) {
					defValue = change.defaultValue ?? {};
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
				if (!Is.function(transformEntityProperty)) {
					throw new GeneralError(MigrationHelper.CLASS_NAME, "transformRequiredForProperty", {
						from: change.from.property,
						to: change.to.property,
						type: change.from.type
					});
				}

				newValue = transformEntityProperty(change.from, change.to, currentValue);
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

		return newEntity;
	}

	/**
	 * Transforms a single entity through an ordered chain of fully-resolved migration steps.
	 * For each step the method diffs fromProperties against toProperties, then applies
	 * applyEntityTransform. Each step's output feeds the next step's input so that
	 * per-step transformEntityProperty hooks are honoured throughout the chain.
	 * @param entity The entity to transform (at the shape described by steps[0].fromProperties).
	 * @param steps Ordered, fully-resolved migration steps from stored version to current version.
	 * Each step's fromProperties and toProperties are resolved by the caller before invocation.
	 * @returns The entity transformed to the shape described by steps[last].toProperties.
	 */
	public static applyEntityChain(entity: unknown, steps: IResolvedMigrationStep[]): unknown {
		let current: unknown = entity;
		for (const step of steps) {
			const diff = EntitySchemaDiffHelper.diff(
				step.fromProperties,
				step.toProperties,
				step.renames
			);
			current = MigrationHelper.applyEntityTransform(
				current as Partial<unknown>,
				diff,
				step.transformEntityProperty
			);
		}
		return current;
	}

	/**
	 * Performs a chain migration in a single connector swap, regardless of how many version
	 * steps the chain spans. Creates one target connector, reads all source entities, applies
	 * applyEntityChain to each, writes them to the target, then finalizes the migration.
	 * A chain of one step is equivalent to a traditional single-step migration.
	 * @param sourceConnector The connector holding data at the stored schema version.
	 * @param targetSchemaName The schema name for the current version (used to create the target connector).
	 * @param steps Ordered, fully-resolved migration steps from stored to current version.
	 * @param loggingComponentType An optional logging component type for connector startup.
	 * @param batchSize Number of entities to read and write per batch. Defaults to 100.
	 * @returns The finalized connector and the count of migrated entities.
	 */
	public static async migrateWithChain(
		sourceConnector: IEntityStorageMigrationConnector,
		targetSchemaName: string,
		steps: IResolvedMigrationStep[],
		loggingComponentType?: string,
		batchSize = 100
	): Promise<{
		finalConnector: IEntityStorageConnector;
		migrated: number;
	}> {
		let targetConnector: IEntityStorageConnector | undefined;
		try {
			targetConnector = await sourceConnector.createTargetConnector(targetSchemaName);

			await MigrationHelper.startupConnector(sourceConnector, loggingComponentType);
			await MigrationHelper.startupConnector(targetConnector, loggingComponentType);

			let partitionContextIds = await sourceConnector.getPartitionContextIds();
			if (!Is.arrayValue(partitionContextIds)) {
				partitionContextIds ??= [];
				partitionContextIds.push({});
			}

			let migrated = 0;
			const effectivePartitions = partitionContextIds.length > 0 ? partitionContextIds : [{}];

			const resolvedTarget = targetConnector;
			for (const contextIds of effectivePartitions) {
				await ContextIdStore.run(contextIds, async () => {
					migrated += await MigrationHelper.migratePartitionWithChain(
						sourceConnector,
						resolvedTarget,
						steps,
						batchSize
					);
				});
			}

			const finalConnector = await sourceConnector.finalizeMigration(
				targetConnector,
				undefined,
				loggingComponentType
			);

			return { finalConnector, migrated };
		} catch (error) {
			await sourceConnector.cleanupMigration(targetConnector, undefined, loggingComponentType);
			throw new GeneralError(MigrationHelper.CLASS_NAME, "migrationFailed", undefined, error);
		}
	}

	/**
	 * Reads all entities from one partition of the source connector, applies the migration
	 * chain to each entity, and writes the results to the target connector.
	 * @param source The connector to read from (already bootstrapped).
	 * @param target The connector to write to (already bootstrapped).
	 * @param steps Ordered, fully-resolved migration steps.
	 * @param batchSize Number of entities to read and write per batch.
	 * @returns The number of entities migrated.
	 * @internal
	 */
	private static async migratePartitionWithChain(
		source: IEntityStorageMigrationConnector,
		target: IEntityStorageConnector,
		steps: IResolvedMigrationStep[],
		batchSize: number
	): Promise<number> {
		let migrated = 0;
		let cursor: string | undefined;
		const totalEntities = await source.count();

		if (totalEntities > 0) {
			do {
				const page = await source.query(undefined, undefined, undefined, cursor, batchSize);
				cursor = page.cursor;

				if (Is.arrayValue(page.entities)) {
					const transformedBatch: unknown[] = page.entities.map(entity =>
						MigrationHelper.applyEntityChain(entity, steps)
					);
					await target.setBatch(transformedBatch);
					migrated += transformedBatch.length;
				}
			} while (Is.stringValue(cursor));
		}

		return migrated;
	}

	/**
	 * Starts the connector by calling bootstrap and start if they are defined.
	 * @param connector The connector to start.
	 * @param loggingComponentType An optional logging component type.
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
