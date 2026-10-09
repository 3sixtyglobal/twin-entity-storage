// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdHelper, ContextIdStore, type IContextIds } from "@3sixty/context";
import {
	BaseError,
	Coerce,
	ComponentFactory,
	Converter,
	GeneralError,
	Guards,
	Is,
	ObjectHelper
} from "@3sixty/core";
import { Blake2b } from "@3sixty/crypto";
import {
	EntitySchemaDiffHelper,
	EntitySchemaHelper,
	EntitySchemaPropertyType,
	type IEntitySchemaDiff
} from "@3sixty/entity";
import type { ILoggingComponent } from "@3sixty/logging-models";
import { nameof } from "@3sixty/nameof";
import type { EntityPropertyRemover } from "../models/entityPropertyRemover.js";
import type { EntityPropertyTransformer } from "../models/entityPropertyTransformer.js";
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
	 * Marker between the base name and the hash in a generated target name.
	 * @internal
	 */
	private static readonly _TARGET_MARKER: string = "Migration";

	/**
	 * Hex characters of the hash kept in a generated target name.
	 * @internal
	 */
	private static readonly _TARGET_HASH_LENGTH: number = 12;

	/**
	 * Performs a chain migration in a single connector swap, regardless of how many version
	 * steps the chain spans. Creates one target connector, reads all source entities, applies
	 * applyEntityChain to each, writes them to the target, then finalizes the migration.
	 * A chain of one step is equivalent to a traditional single-step migration.
	 * @param sourceConnector The connector holding data at the stored schema version.
	 * @param targetSchemaName The schema name for the current version (used to create the target connector).
	 * @param partitions The partitions to migrate.
	 * @param steps Ordered, fully-resolved migration steps from stored to current version.
	 * @param options Optional migration options.
	 * @param loggingComponentType The optional component type to use for logging the migration progress.
	 * @returns The finalized connector and the count of migrated entities.
	 */
	public static async migrateWithChain(
		sourceConnector: IEntityStorageMigrationConnector,
		targetSchemaName: string,
		partitions: IContextIds[] | undefined,
		steps: IResolvedMigrationStep[],
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<{
		finalConnector: IEntityStorageConnector;
		migrated: number;
	}> {
		let targetConnector: IEntityStorageConnector | undefined;
		const logging = ComponentFactory.getIfExists<ILoggingComponent>(loggingComponentType);

		try {
			await logging?.log({
				source: MigrationHelper.CLASS_NAME,
				level: "info",
				message: "migrateSchemaStarting",
				data: {
					schemaName: targetSchemaName
				}
			});

			targetConnector = await sourceConnector.createTargetConnector(targetSchemaName);

			await MigrationHelper.startupConnector(
				sourceConnector,
				sourceConnector.getSchema().type ?? "",
				loggingComponentType
			);
			await MigrationHelper.startupConnector(
				targetConnector,
				targetSchemaName,
				loggingComponentType
			);

			// undefined → not partitioned: run one pass with empty context.
			// []        → partitioned but table is empty: skip all passes (count() never called).
			// [{…}, …]  → partitioned with data: expand short-form values to long form and iterate.
			let effectivePartitions: IContextIds[];
			if (partitions === undefined) {
				effectivePartitions = [{}];
			} else if (partitions.length === 0) {
				effectivePartitions = [];
			} else {
				effectivePartitions = partitions.map(ctx => ContextIdHelper.longAll(ctx, Object.keys(ctx)));
			}

			let migrated = 0;

			await options?.onProgress?.("partitionStart", effectivePartitions.length, 0);

			const resolvedTarget = targetConnector;
			for (let i = 0; i < effectivePartitions.length; i++) {
				await options?.onProgress?.("partitionProgress", effectivePartitions.length, i);

				await ContextIdStore.run(effectivePartitions[i], async () => {
					migrated += await MigrationHelper.migratePartitionWithChain(
						sourceConnector,
						resolvedTarget,
						steps,
						options
					);
				});
			}

			await options?.onProgress?.(
				"partitionEnd",
				effectivePartitions.length,
				effectivePartitions.length
			);

			await logging?.log({
				source: MigrationHelper.CLASS_NAME,
				level: "info",
				message: "migrateSchemaFinalizing",
				data: {
					schemaName: targetSchemaName
				}
			});

			await options?.onFinalizing?.();

			const finalConnector = await sourceConnector.finalizeMigration(
				targetConnector,
				options,
				loggingComponentType
			);

			await logging?.log({
				source: MigrationHelper.CLASS_NAME,
				level: "info",
				message: "migrateSchemaComplete",
				data: {
					schemaName: targetSchemaName
				}
			});

			return { finalConnector, migrated };
		} catch (error) {
			await sourceConnector.cleanupMigration(targetConnector, options, loggingComponentType);

			const failedEntity = MigrationHelper.failedEntityProperties(error);

			await logging?.log({
				source: MigrationHelper.CLASS_NAME,
				level: "error",
				message: "migrateSchemaFailed",
				data: {
					schemaName: targetSchemaName,
					...failedEntity
				},
				error: BaseError.fromError(error)
			});
			throw new GeneralError(
				MigrationHelper.CLASS_NAME,
				"migrateSchemaFailed",
				{ schemaName: targetSchemaName, ...failedEntity },
				error
			);
		}
	}

	/**
	 * Reads all entities from one partition of the source connector, applies the migration
	 * chain to each entity, and writes the results to the target connector.
	 * @param source The connector to read from (already bootstrapped).
	 * @param target The connector to write to (already bootstrapped).
	 * @param steps Ordered, fully-resolved migration steps.
	 * @param options Optional migration options (batchSize, progress callbacks).
	 * @returns The number of entities migrated.
	 */
	public static async migratePartitionWithChain(
		source: IEntityStorageMigrationConnector,
		target: IEntityStorageConnector,
		steps: IResolvedMigrationStep[],
		options?: IMigrationOptions
	): Promise<number> {
		let migrated = 0;
		let cursor: string | undefined;
		const totalEntities = await source.count();

		if (totalEntities > 0) {
			await options?.onProgress?.("partitionItemsStart", totalEntities, 0);

			do {
				const page = await source.query(
					undefined,
					undefined,
					undefined,
					cursor,
					options?.batchSize
				);
				cursor = page.cursor;

				if (Is.arrayValue(page.entities)) {
					const transformedBatch: unknown[] = [];

					for (const entity of page.entities) {
						try {
							transformedBatch.push(await MigrationHelper.applyEntityChain(entity, steps));
						} catch (error) {
							throw await MigrationHelper.entityFailure(error, source, entity);
						}
					}

					try {
						await target.setBatch(transformedBatch);
					} catch (error) {
						throw await MigrationHelper.entityFailure(
							error,
							target,
							MigrationHelper.findRejectedEntity(target, transformedBatch)
						);
					}
					migrated += transformedBatch.length;
				}

				await options?.onProgress?.("partitionItemsProgress", totalEntities, migrated);
			} while (Is.stringValue(cursor));

			await options?.onProgress?.("partitionItemsEnd", totalEntities, totalEntities);
		}

		return migrated;
	}

	/**
	 * Transforms a single entity through an ordered chain of fully-resolved migration steps.
	 * For each step the method applies transformEntity, if present, to the source entity, then
	 * diffs fromProperties against toProperties and applies applyEntityTransform, feeding each
	 * step's output to the next.
	 * @param entity The entity to transform (at the shape described by steps[0].fromProperties).
	 * @param steps Ordered, fully-resolved migration steps from stored version to current version.
	 * Each step's fromProperties and toProperties are resolved by the caller before invocation.
	 * @returns The entity transformed to the shape described by steps[last].toProperties.
	 */
	public static async applyEntityChain(
		entity: unknown,
		steps: IResolvedMigrationStep[]
	): Promise<unknown> {
		let current: unknown = entity;
		for (const step of steps) {
			if (Is.function(step.transformEntity)) {
				current = await step.transformEntity(current);
			}

			const diff = EntitySchemaDiffHelper.diff(
				step.fromProperties,
				step.toProperties,
				step.renames
			);
			current = await MigrationHelper.applyEntityTransform(
				current as Partial<unknown>,
				diff,
				step.transformEntityProperty,
				step.removeEntityProperty
			);
		}
		return current;
	}

	/**
	 * Applies the entity transformation for a single diff, handling added, removed, and
	 * modified properties according to the provided schema diff and optional transform hook.
	 * @param entity The entity to transform.
	 * @param schemaDiff The schema diff between the old and new schemas.
	 * @param transformEntityProperty Optional transform hook called for every modified property when
	 * supplied; scalar targets fall back to coercion when it returns undefined or it is not supplied.
	 * @param removeEntityProperty Optional hook called with the entity and dropped property schemas.
	 * @returns The transformed entity ready to be written to the new schema.
	 * @throws GeneralError if a transformation is required for an object or array property but no transformEntityProperty function is provided.
	 * @throws GeneralError if coercion of a modified property results in undefined for a non-optional target property.
	 */
	public static async applyEntityTransform<T = unknown, U = unknown>(
		entity: Partial<T>,
		schemaDiff: IEntitySchemaDiff<T, U>,
		transformEntityProperty?: EntityPropertyTransformer<T, U>,
		removeEntityProperty?: EntityPropertyRemover<T>
	): Promise<U> {
		const newEntity = {} as U;

		for (const property of schemaDiff.unchanged) {
			ObjectHelper.propertySet(
				newEntity,
				property.property as string,
				ObjectHelper.propertyGet(entity, property.property as string)
			);
		}

		for (const change of schemaDiff.added) {
			const existingValue = ObjectHelper.propertyGet(entity, change.property as string);
			if (!Is.undefined(existingValue)) {
				ObjectHelper.propertySet(newEntity, change.property as string, existingValue);
			} else {
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
		}

		for (const change of schemaDiff.modified) {
			const currentValue = ObjectHelper.propertyGet(entity, change.from.property as string);
			const isObjectOrArray =
				change.to.type === EntitySchemaPropertyType.Array ||
				change.to.type === EntitySchemaPropertyType.Object;

			let newValue: unknown;
			if (Is.function(transformEntityProperty)) {
				newValue = await transformEntityProperty(entity as T, change.from, change.to, currentValue);
			} else if (isObjectOrArray) {
				throw new GeneralError(MigrationHelper.CLASS_NAME, "transformRequiredForProperty", {
					from: change.from.property,
					to: change.to.property,
					type: change.from.type
				});
			}

			if (Is.undefined(newValue) && !isObjectOrArray) {
				if (change.to.type === EntitySchemaPropertyType.Boolean) {
					newValue = Coerce.boolean(currentValue);
				} else if (
					change.to.type === EntitySchemaPropertyType.Number ||
					change.to.type === EntitySchemaPropertyType.Integer
				) {
					newValue = Coerce.number(currentValue);
				} else if (change.to.type === EntitySchemaPropertyType.String) {
					newValue = Coerce.string(currentValue);
				}
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

		if (Is.arrayValue(schemaDiff.removed) && Is.function(removeEntityProperty)) {
			await removeEntityProperty(entity as T, schemaDiff.removed);
		}

		return newEntity;
	}

	/**
	 * Generate a length-bounded name for a migration's temporary target storage. The marker and
	 * hash are always appended, as finalizeMigration swaps the target into the source name.
	 * @param baseName The name of the source storage.
	 * @param maxIdentifierLength The maximum identifier length allowed by the backend.
	 * @returns The target name, at most maxIdentifierLength characters.
	 * @throws GeneralError if maxIdentifierLength cannot fit the marker and hash.
	 */
	public static generateTargetName(baseName: string, maxIdentifierLength: number): string {
		Guards.stringValue(MigrationHelper.CLASS_NAME, nameof(baseName), baseName);
		Guards.integer(MigrationHelper.CLASS_NAME, nameof(maxIdentifierLength), maxIdentifierLength);

		const suffixLength =
			MigrationHelper._TARGET_MARKER.length + MigrationHelper._TARGET_HASH_LENGTH;
		if (maxIdentifierLength <= suffixLength) {
			throw new GeneralError(MigrationHelper.CLASS_NAME, "maxIdentifierLengthTooSmall", {
				maxIdentifierLength,
				minimum: suffixLength + 1
			});
		}

		const hash = Blake2b.sum256(Converter.utf8ToBytes(`${baseName}_${Date.now()}`));
		const hex = Converter.bytesToHex(hash);
		const headLength = maxIdentifierLength - suffixLength;

		return `${baseName.slice(0, headLength)}${MigrationHelper._TARGET_MARKER}${hex.slice(0, MigrationHelper._TARGET_HASH_LENGTH)}`;
	}

	/**
	 * Starts the connector by calling bootstrap and start if they are defined.
	 * @param connector The connector to start.
	 * @param schemaName The schema name reported if bootstrap fails.
	 * @param loggingComponentType The optional component type to use for logging the migration progress.
	 * @throws GeneralError if the connector's bootstrap reports failure.
	 * @internal
	 */
	private static async startupConnector<T>(
		connector: IEntityStorageConnector<T>,
		schemaName: string,
		loggingComponentType?: string
	): Promise<void> {
		const bootstrap = connector.bootstrap?.bind(connector);
		if (Is.function(bootstrap)) {
			const bootstrapped = await bootstrap(loggingComponentType);
			if (!bootstrapped) {
				throw new GeneralError(MigrationHelper.CLASS_NAME, "connectorBootstrapFailed", {
					schemaName,
					className: connector.className()
				});
			}
		}
		const start = connector.start?.bind(connector);
		if (Is.function(start)) {
			await start(loggingComponentType);
		}
	}

	/**
	 * Extract the row identity from a failure raised by entityFailure, wherever it sits in the
	 * cause chain.
	 * @param error The error caught by the migration.
	 * @returns The partition and row properties, empty when the failure names no row.
	 * @internal
	 */
	private static failedEntityProperties(error: unknown): {
		partitionId?: string;
		id?: string;
	} {
		const rowError = BaseError.flatten(error).find(
			e => e.source === MigrationHelper.CLASS_NAME && Is.stringValue(e.properties?.id)
		);

		const properties: { partitionId?: string; id?: string } = {};
		if (Is.stringValue(rowError?.properties?.id)) {
			properties.id = rowError.properties.id;
		}
		if (Is.stringValue(rowError?.properties?.partitionId)) {
			properties.partitionId = rowError.properties.partitionId;
		}
		return properties;
	}

	/**
	 * Resolve the partition currently being migrated as the key connectors store against a row.
	 * @param connector The connector whose partition key format to use.
	 * @returns The combined partition key, or undefined when the table is not partitioned.
	 * @internal
	 */
	private static async currentPartitionId(
		connector: IEntityStorageConnector
	): Promise<string | undefined> {
		try {
			const contextIds = await ContextIdStore.getContextIds();
			const separator = connector.getPartitionKeySeparator?.() ?? "/";
			return ContextIdHelper.shortCombined(contextIds, Object.keys(contextIds ?? {}), separator);
		} catch {
			return undefined;
		}
	}

	/**
	 * Read the primary key value from a row.
	 * @param connector The connector whose schema declares the primary key.
	 * @param entity The row to read.
	 * @returns The primary key value, or undefined if the schema or the row does not yield one.
	 * @internal
	 */
	private static entityId(connector: IEntityStorageConnector, entity: unknown): string | undefined {
		try {
			const primaryKey = EntitySchemaHelper.getPrimaryKey(connector.getSchema());
			return Coerce.string(ObjectHelper.propertyGet(entity, primaryKey.property));
		} catch {
			return undefined;
		}
	}

	/**
	 * Wrap a failure that can be attributed to a single row so the error names the row and its
	 * partition. Returns the original error untouched when neither can be resolved, so this can
	 * never mask the failure it is describing.
	 * @param error The error thrown while transforming or writing the row.
	 * @param connector The connector whose schema declares the primary key of the row.
	 * @param entity The row the failure was attributed to, if one was identified.
	 * @returns The error to throw in place of the original.
	 * @internal
	 */
	private static async entityFailure(
		error: unknown,
		connector: IEntityStorageConnector,
		entity: unknown
	): Promise<unknown> {
		const id = Is.empty(entity) ? undefined : MigrationHelper.entityId(connector, entity);
		if (!Is.stringValue(id)) {
			return error;
		}

		const partitionId = await MigrationHelper.currentPartitionId(connector);

		return Is.stringValue(partitionId)
			? new GeneralError(
					MigrationHelper.CLASS_NAME,
					"migrateEntityPartitionFailed",
					{ partitionId, id },
					error
				)
			: new GeneralError(MigrationHelper.CLASS_NAME, "migrateEntityFailed", { id }, error);
	}

	/**
	 * Find the row in a batch that the target connector's validation rejects. The connector
	 * validates the whole batch before writing anything, so the first row that fails here is the
	 * row it failed on.
	 * @param target The connector the batch was written to.
	 * @param batch The transformed rows handed to setBatch.
	 * @returns The offending row, or undefined when the failure was not a validation failure.
	 * @internal
	 */
	private static findRejectedEntity(target: IEntityStorageConnector, batch: unknown[]): unknown {
		const schema = target.getSchema();
		for (const entity of batch) {
			try {
				EntitySchemaHelper.validateEntity(entity, schema);
			} catch {
				return entity;
			}
		}
		return undefined;
	}
}
