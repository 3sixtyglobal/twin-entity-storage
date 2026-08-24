// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { access, mkdir, readFile, rename, rm, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	HealthCategory,
	HealthStatus,
	type IHealth,
	type IHealthProviderComponent
} from "@twin.org/api-models";
import { ContextIdHelper, ContextIdStore, type IContextIds } from "@twin.org/context";
import {
	BaseError,
	Coerce,
	ComponentFactory,
	ConflictError,
	GeneralError,
	Guards,
	Is,
	type IValidationFailure,
	Mutex,
	ObjectHelper,
	Validation
} from "@twin.org/core";
import {
	ComparisonOperator,
	type EntityCondition,
	EntityConditions,
	EntitySchemaFactory,
	EntitySchemaHelper,
	EntitySorter,
	type IEntitySchema,
	type IEntitySchemaProperty,
	LogicalOperator,
	type SortDirection
} from "@twin.org/entity";
import {
	EntityStorageHelper,
	type IEntityStorageConnector,
	type IEntityStorageMigrationConnector,
	type IMigrationOptions
} from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import type { IFileEntityStorageConnectorConstructorOptions } from "./models/IFileEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations in file.
 */
export class FileEntityStorageConnector<T = unknown>
	implements IEntityStorageMigrationConnector<T>, IHealthProviderComponent
{
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<FileEntityStorageConnector>();

	/**
	 * Default limit for number of items to return.
	 * @internal
	 */
	private static readonly _DEFAULT_LIMIT: number = 20;

	/**
	 * Partition key for the operation.
	 * @internal
	 */
	private static readonly _PARTITION_KEY: string = "partitionId";

	/**
	 * Default disk space warning threshold: 500 MB.
	 * @internal
	 */
	private static readonly _DEFAULT_DISK_WARNING_THRESHOLD_BYTES: number = 500 * 1024 * 1024;

	/**
	 * Default disk space error threshold: 100 MB.
	 * @internal
	 */
	private static readonly _DEFAULT_DISK_ERROR_THRESHOLD_BYTES: number = 100 * 1024 * 1024;

	/**
	 * The name for the schema.
	 * @internal
	 */
	private readonly _entitySchemaName: string;

	/**
	 * The schema for the entity.
	 * @internal
	 */
	private readonly _entitySchema: IEntitySchema<T>;

	/**
	 * The keys to use from the context ids to create partitions.
	 * @internal
	 */
	private readonly _partitionContextIds?: string[];

	/**
	 * The primary key.
	 * @internal
	 */
	private readonly _primaryKey: IEntitySchemaProperty<T>;

	/**
	 * The name of the version property, if any.
	 * @internal
	 */
	private readonly _versionKey?: string;

	/**
	 * The directory to use for storage.
	 * @internal
	 */
	private readonly _directory: string;

	/**
	 * Free bytes below which health reports an error.
	 * @internal
	 */
	private readonly _diskErrorThresholdBytes: number;

	/**
	 * Free bytes below which health reports a warning.
	 * @internal
	 */
	private readonly _diskWarningThresholdBytes: number;

	/**
	 * Milliseconds to wait for the directory lock before throwing.
	 * @internal
	 */
	private readonly _mutexTimeoutMs?: number;

	/**
	 * Create a new instance of FileEntityStorageConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IFileEntityStorageConnectorConstructorOptions) {
		Guards.object(FileEntityStorageConnector.CLASS_NAME, nameof(options), options);
		Guards.stringValue(
			FileEntityStorageConnector.CLASS_NAME,
			nameof(options.entitySchema),
			options.entitySchema
		);
		Guards.object(FileEntityStorageConnector.CLASS_NAME, nameof(options.config), options.config);
		Guards.stringValue(
			FileEntityStorageConnector.CLASS_NAME,
			nameof(options.config.directory),
			options.config.directory
		);
		this._entitySchemaName = options.entitySchema;
		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._partitionContextIds = options.partitionContextIds;
		this._primaryKey = EntitySchemaHelper.getPrimaryKey<T>(this._entitySchema);
		this._versionKey = EntitySchemaHelper.findVersionProperty(this._entitySchema);
		this._directory = path.resolve(options.config.directory);
		this._diskErrorThresholdBytes =
			options.config.diskErrorThresholdBytes ??
			FileEntityStorageConnector._DEFAULT_DISK_ERROR_THRESHOLD_BYTES;
		this._diskWarningThresholdBytes =
			options.config.diskWarningThresholdBytes ??
			FileEntityStorageConnector._DEFAULT_DISK_WARNING_THRESHOLD_BYTES;
		this._mutexTimeoutMs = Coerce.integer(options.config.mutexTimeoutMs);
	}

	/**
	 * Bootstrap the connector by creating and initializing any resources it needs.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the bootstrapping process was successful.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		if (!(await this.dirExists(this._directory))) {
			await nodeLogging?.log({
				level: "info",
				source: FileEntityStorageConnector.CLASS_NAME,
				message: "directoryCreating",
				data: {
					directory: this._directory
				}
			});

			try {
				await mkdir(this._directory, { recursive: true });

				await nodeLogging?.log({
					level: "info",
					source: FileEntityStorageConnector.CLASS_NAME,
					message: "directoryCreated",
					data: {
						directory: this._directory
					}
				});
			} catch (err) {
				await nodeLogging?.log({
					level: "error",
					source: FileEntityStorageConnector.CLASS_NAME,
					message: "directoryCreateFailed",
					data: {
						directory: this._directory
					},
					error: BaseError.fromError(err)
				});
				return false;
			}
		} else {
			await nodeLogging?.log({
				level: "info",
				source: FileEntityStorageConnector.CLASS_NAME,
				message: "directoryExists",
				data: {
					directory: this._directory
				}
			});
		}
		return true;
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return FileEntityStorageConnector.CLASS_NAME;
	}

	/**
	 * Returns the health status of the component.
	 * @returns The health status of the component.
	 */
	public async health(): Promise<IHealth[]> {
		try {
			const stats = await statfs(this._directory);
			const freeBytes = stats.bavail * stats.bsize;

			if (freeBytes < this._diskErrorThresholdBytes) {
				return [
					{
						source: FileEntityStorageConnector.CLASS_NAME,
						category: HealthCategory.Connectivity,
						status: HealthStatus.Error,
						description: "healthDescription",
						message: "diskSpaceError",
						data: {
							directory: this._directory,
							freeBytes,
							thresholdBytes: this._diskErrorThresholdBytes
						}
					}
				];
			} else if (freeBytes < this._diskWarningThresholdBytes) {
				return [
					{
						source: FileEntityStorageConnector.CLASS_NAME,
						category: HealthCategory.Connectivity,
						status: HealthStatus.Warning,
						description: "healthDescription",
						message: "diskSpaceWarning",
						data: {
							directory: this._directory,
							freeBytes,
							thresholdBytes: this._diskWarningThresholdBytes
						}
					}
				];
			}
			return [
				{
					source: FileEntityStorageConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Ok,
					description: "healthDescription",
					data: { directory: this._directory, freeBytes }
				}
			];
		} catch {
			return [
				{
					source: FileEntityStorageConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Error,
					description: "healthDescription",
					message: "diskSpaceCheckFailed",
					data: { directory: this._directory }
				}
			];
		}
	}

	/**
	 * Get the schema for the entities.
	 * @returns The schema for the entities.
	 */
	public getSchema(): IEntitySchema {
		return this._entitySchema as IEntitySchema;
	}

	/**
	 * Get an entity.
	 * @param id The id of the entity to get, or the index value if secondaryIndex is set.
	 * @param secondaryIndex Get the item using a secondary index.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The object if it can be found or undefined.
	 */
	public async get(
		id: string,
		secondaryIndex?: keyof T,
		conditions?: { property: keyof T; value: unknown }[]
	): Promise<T | undefined> {
		Guards.stringValue(FileEntityStorageConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const store = await this.readStoreWithLock();

		const finalConditions = conditions ? [...conditions] : [];
		if (Is.stringValue(partitionKey)) {
			finalConditions.push({
				property: FileEntityStorageConnector._PARTITION_KEY as keyof T,
				value: partitionKey
			});
		}

		const index = this.findItem(store, id, secondaryIndex, finalConditions);
		const item = store[index];

		if (Is.objectValue(item)) {
			return EntityStorageHelper.unPrepareEntity<T>(item, [
				FileEntityStorageConnector._PARTITION_KEY
			]);
		}

		return undefined;
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The id of the entity.
	 * @throws ConflictError when the entity exists but the supplied conditions or version do not match the stored state.
	 */
	public async set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void> {
		Guards.object<T>(FileEntityStorageConnector.CLASS_NAME, nameof(entity), entity);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const submittedVersion = Is.stringValue(this._versionKey)
			? ObjectHelper.propertyGet<number>(entity, this._versionKey)
			: undefined;
		const hasVersionCheck =
			!Is.empty(this._versionKey) && !Is.empty(submittedVersion) && submittedVersion > 0;

		const prepared = EntityStorageHelper.prepareEntity(
			entity,
			this._entitySchema,
			Is.stringValue(partitionKey)
				? [{ property: FileEntityStorageConnector._PARTITION_KEY, value: partitionKey }]
				: undefined,
			{ nullBehavior: "omit" }
		);

		await this.withLock(async () => {
			const store = await this.readStore();

			const baseConditions: { property: keyof T; value: unknown }[] = [];
			if (Is.stringValue(partitionKey)) {
				baseConditions.push({
					property: FileEntityStorageConnector._PARTITION_KEY as keyof T,
					value: partitionKey
				});
			}

			const fullConditions: { property: keyof T; value: unknown }[] = [
				...baseConditions,
				...(conditions ?? [])
			];
			if (hasVersionCheck) {
				fullConditions.push({ property: this._versionKey as keyof T, value: submittedVersion });
			}

			const entityId = prepared[this._primaryKey.property] as string;
			const existingIndex = this.findItem(store, entityId, undefined, fullConditions);

			if (existingIndex >= 0) {
				if (Is.stringValue(this._versionKey)) {
					const storedVersion =
						ObjectHelper.propertyGet<number>(store[existingIndex], this._versionKey) ?? 0;
					ObjectHelper.propertySet(prepared, this._versionKey, storedVersion + 1);
				}
				store[existingIndex] = prepared;
			} else {
				const existsIndex = this.findItem(store, entityId, undefined, baseConditions);
				if (existsIndex >= 0) {
					if (Is.stringValue(this._versionKey)) {
						if (hasVersionCheck) {
							throw new ConflictError(
								FileEntityStorageConnector.CLASS_NAME,
								"optimisticLockFailed",
								entityId
							);
						}
						throw new ConflictError(
							FileEntityStorageConnector.CLASS_NAME,
							"conditionFailed",
							entityId
						);
					}
					return;
				}
				if (Is.stringValue(this._versionKey)) {
					ObjectHelper.propertySet(prepared, this._versionKey, 1);
				}
				store.push(prepared);
			}

			await this.writeStore(store);
		});
	}

	/**
	 * Set multiple entities in a batch.
	 * @param entities The entities to set.
	 * @returns Nothing.
	 */
	public async setBatch(entities: T[]): Promise<void> {
		Guards.arrayValue(FileEntityStorageConnector.CLASS_NAME, nameof(entities), entities);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		await this.withLock(async () => {
			const store = await this.readStore();

			for (const entity of entities) {
				Guards.object<T>(FileEntityStorageConnector.CLASS_NAME, nameof(entity), entity);

				const prepared = EntityStorageHelper.prepareEntity(
					entity,
					this._entitySchema,
					Is.stringValue(partitionKey)
						? [{ property: FileEntityStorageConnector._PARTITION_KEY, value: partitionKey }]
						: undefined,
					{ nullBehavior: "omit" }
				);

				const existingIndex = this.findItem(
					store,
					prepared[this._primaryKey.property] as string,
					undefined,
					Is.stringValue(partitionKey)
						? [
								{
									property: FileEntityStorageConnector._PARTITION_KEY as keyof T,
									value: partitionKey
								}
							]
						: []
				);
				if (existingIndex >= 0) {
					store[existingIndex] = prepared;
				} else {
					store.push(prepared);
				}
			}

			await this.writeStore(store);
		});
	}

	/**
	 * Remove all entities from the storage.
	 * @returns Nothing.
	 */
	public async empty(): Promise<void> {
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			await this.withLock(async () => {
				const store = await this.readStore();
				const remaining = Is.stringValue(partitionKey)
					? store.filter(
							item =>
								ObjectHelper.propertyGet(
									item as object,
									FileEntityStorageConnector._PARTITION_KEY
								) !== partitionKey
						)
					: [];
				await this.writeStore(remaining);
			});
		} catch (err) {
			throw new GeneralError(FileEntityStorageConnector.CLASS_NAME, "emptyFailed", undefined, err);
		}
	}

	/**
	 * Remove multiple entities by id.
	 * @param ids The ids of the entities to remove.
	 * @returns Nothing.
	 */
	public async removeBatch(ids: string[]): Promise<void> {
		Guards.arrayValue(FileEntityStorageConnector.CLASS_NAME, nameof(ids), ids);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			await this.withLock(async () => {
				const store = await this.readStore();
				const idSet = new Set(ids);
				const remaining = store.filter(item => {
					if (
						Is.stringValue(partitionKey) &&
						ObjectHelper.propertyGet(item, FileEntityStorageConnector._PARTITION_KEY) !==
							partitionKey
					) {
						return true;
					}
					return !idSet.has(item[this._primaryKey.property] as string);
				});
				await this.writeStore(remaining);
			});
		} catch (err) {
			throw new GeneralError(
				FileEntityStorageConnector.CLASS_NAME,
				"removeBatchFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Teardown the storage by deleting the underlying store file.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the teardown process was successful.
	 */
	public async teardown(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		await nodeLogging?.log({
			level: "info",
			source: FileEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "storeTearingDown"
		});

		try {
			await rm(this._directory, { recursive: true, force: true });

			await nodeLogging?.log({
				level: "info",
				source: FileEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "storeTornDown"
			});

			return true;
		} catch (err) {
			await nodeLogging?.log({
				level: "error",
				source: FileEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "teardownFailed",
				error: BaseError.fromError(err)
			});
			return false;
		}
	}

	/**
	 * Remove the entity.
	 * @param id The id of the entity to remove.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns Nothing.
	 * @throws ConflictError when the entity exists but the supplied conditions do not match the stored state.
	 */
	public async remove(
		id: string,
		conditions?: { property: keyof T; value: unknown }[]
	): Promise<void> {
		Guards.stringValue(FileEntityStorageConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		await this.withLock(async () => {
			const store = await this.readStore();

			const baseConditions: { property: keyof T; value: unknown }[] = [];
			if (Is.stringValue(partitionKey)) {
				baseConditions.push({
					property: FileEntityStorageConnector._PARTITION_KEY as keyof T,
					value: partitionKey
				});
			}

			const fullConditions: { property: keyof T; value: unknown }[] = [
				...baseConditions,
				...(conditions ?? [])
			];
			const index = this.findItem(store, id, undefined, fullConditions);

			if (index >= 0) {
				store.splice(index, 1);
				await this.writeStore(store);
			} else if (Is.arrayValue(conditions)) {
				const existsIndex = this.findItem(store, id, undefined, baseConditions);
				if (existsIndex >= 0 && this._versionKey) {
					throw new ConflictError(FileEntityStorageConnector.CLASS_NAME, "conditionFailed", id);
				}
			}
		});
	}

	/**
	 * Find all the entities which match the conditions.
	 * @param conditions The conditions to match for the entities.
	 * @param sortProperties The optional sort order.
	 * @param properties The optional properties to return, defaults to all.
	 * @param cursor The cursor to request the next chunk of entities.
	 * @param limit The suggested number of entities to return in each chunk, in some scenarios can return a different amount.
	 * @returns All the entities for the storage matching the conditions,
	 * and a cursor which can be used to request more entities.
	 */
	public async query(
		conditions?: EntityCondition<T>,
		sortProperties?: {
			property: keyof T;
			sortDirection: SortDirection;
		}[],
		properties?: (keyof T)[],
		cursor?: string,
		limit?: number
	): Promise<{
		/**
		 * The entities, which can be partial if a limited keys list was provided.
		 */
		entities: Partial<T>[];
		/**
		 * An optional cursor, when defined can be used to call find to get more entities.
		 */
		cursor?: string;
	}> {
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		EntityStorageHelper.validateSortProperties(this._entitySchema, sortProperties);
		EntityStorageHelper.validateProperties(this._entitySchema, properties);
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);

		if (!Is.empty(limit)) {
			const validationFailures: IValidationFailure[] = [];
			Validation.integer(nameof(limit), limit, validationFailures, undefined, { minValue: 1 });
			Validation.asValidationError(
				FileEntityStorageConnector.CLASS_NAME,
				"query",
				validationFailures
			);
		}

		let allEntities = await this.readStoreWithLock();

		const finalConditions: EntityCondition<T> = {
			conditions: [],
			logicalOperator: LogicalOperator.And
		};

		if (Is.stringValue(partitionKey)) {
			finalConditions.conditions.push({
				property: FileEntityStorageConnector._PARTITION_KEY,
				comparison: ComparisonOperator.Equals,
				value: partitionKey
			});
		}

		if (!Is.empty(conditions)) {
			finalConditions.conditions.push(EntityStorageHelper.normalizeConditionValues(conditions));
		}

		const entities = [];
		const finalLimit = limit ?? FileEntityStorageConnector._DEFAULT_LIMIT;
		let nextCursor: string | undefined;

		if (allEntities.length > 0) {
			const finalSortKeys = EntitySchemaHelper.buildSortProperties<T>(
				this._entitySchema,
				sortProperties
			);
			allEntities = EntitySorter.sort(allEntities, finalSortKeys);

			const startIndex = Coerce.number(cursor) ?? 0;

			for (let i = startIndex; i < allEntities.length; i++) {
				if (
					EntityConditions.check(allEntities[i], finalConditions) &&
					entities.length < finalLimit
				) {
					const entity = Is.arrayValue(properties)
						? ObjectHelper.pick(allEntities[i], properties)
						: allEntities[i];
					entities.push(
						EntityStorageHelper.unPrepareEntity<T>(entity, [
							FileEntityStorageConnector._PARTITION_KEY
						])
					);
					if (entities.length >= finalLimit) {
						if (i < allEntities.length - 1) {
							nextCursor = (i + 1).toString();
						}
						break;
					}
				}
			}
		}

		return {
			entities,
			cursor: nextCursor
		};
	}

	/**
	 * Count all the entities which match the conditions.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The total count of entities in the storage.
	 */
	public async count(conditions?: EntityCondition<T>): Promise<number> {
		const store = await this.readStoreWithLock();

		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const finalConditions: EntityCondition<T> = {
			conditions: [],
			logicalOperator: LogicalOperator.And
		};

		if (Is.stringValue(partitionKey)) {
			finalConditions.conditions.push({
				property: FileEntityStorageConnector._PARTITION_KEY,
				comparison: ComparisonOperator.Equals,
				value: partitionKey
			});
		}

		if (!Is.empty(conditions)) {
			finalConditions.conditions.push(EntityStorageHelper.normalizeConditionValues(conditions));
		}

		if (finalConditions.conditions.length === 0) {
			return store.length;
		}

		return store.filter(item => EntityConditions.check(item, finalConditions)).length;
	}

	/**
	 * Get the connector implementation version.
	 * @returns The connector implementation version.
	 */
	public connectorVersion(): number {
		return 0;
	}

	/**
	 * Get a unique list of all the context ids from the storage.
	 * @param loggingComponentType The optional component type to use for logging skipped partition ids.
	 * @returns The list of unique context ids.
	 */
	public async getPartitionContextIds(
		loggingComponentType?: string
	): Promise<IContextIds[] | undefined> {
		if (!Is.arrayValue(this._partitionContextIds)) {
			return undefined;
		}
		const contextIds: { [id: string]: IContextIds } = {};
		const skipped = new Set<string>();

		const store = await this.readStoreWithLock();

		for (const entity of store) {
			const partitionId = ObjectHelper.propertyGet(
				entity,
				FileEntityStorageConnector._PARTITION_KEY
			);
			if (Is.stringValue(partitionId)) {
				const split = EntityStorageHelper.tryShortSplit(
					this._partitionContextIds ?? [],
					partitionId
				);
				if (Is.undefined(split)) {
					skipped.add(partitionId);
				} else {
					contextIds[partitionId] = split;
				}
			}
		}

		if (skipped.size > 0) {
			const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(loggingComponentType);
			await nodeLogging?.log({
				level: "warn",
				source: FileEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "partitionIdsSkipped",
				data: {
					expected: this._partitionContextIds?.length,
					partitionIds: Array.from(skipped).join(", ")
				}
			});
		}

		return Object.values(contextIds);
	}

	/**
	 * Create the target connector for performing the migration it will use a temporary storage location.
	 * @param newEntitySchema The name of the new entity schema to create the connector for.
	 * @returns Connector for performing the migration.
	 */
	public async createTargetConnector<U>(
		newEntitySchema: string
	): Promise<IEntityStorageConnector<U>> {
		const baseName = path.basename(this._directory);
		const parentDir = path.resolve(this._directory, "..");
		const migrationDir = path.join(parentDir, `${baseName}_migration_${Date.now()}`);

		return new FileEntityStorageConnector<U>({
			entitySchema: newEntitySchema,
			partitionContextIds: this._partitionContextIds,
			config: {
				directory: migrationDir,
				diskErrorThresholdBytes: this._diskErrorThresholdBytes,
				diskWarningThresholdBytes: this._diskWarningThresholdBytes
			}
		});
	}

	/**
	 * Finalize the migration by tearing down the old connector and replacing it with the target connector.
	 * @param targetConnector The target connector to finalize the migration with.
	 * @param options The options to control how the migration is finalized.
	 * @param loggingComponentType The optional component type to use for logging the migration progress.
	 * @returns A promise that resolves when the migration is finalized.
	 */
	public async finalizeMigration<U>(
		targetConnector: FileEntityStorageConnector<U>,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<IEntityStorageConnector<U>> {
		const originalDir = this._directory;
		const migrationDir = targetConnector._directory;

		// Teardown the original connector, removing the entire source directory.
		await this.teardown(loggingComponentType);

		// Rename the migration directory into the original location.
		await rename(migrationDir, originalDir);

		return new FileEntityStorageConnector<U>({
			entitySchema: targetConnector._entitySchemaName,
			partitionContextIds: targetConnector._partitionContextIds,
			config: {
				directory: this._directory,
				diskErrorThresholdBytes: targetConnector._diskErrorThresholdBytes,
				diskWarningThresholdBytes: targetConnector._diskWarningThresholdBytes
			}
		});
	}

	/**
	 * Cleanup the migration if a migration fails or needs to be aborted.
	 * @param targetConnector The target connector to cleanup the migration with.
	 * @param options The options to control how the migration is cleaned up.
	 * @param loggingComponentType The optional component type to use for logging the migration progress.
	 * @returns A promise that resolves when the migration is cleaned up.
	 */
	public async cleanupMigration<U>(
		targetConnector: IEntityStorageConnector<U> | undefined,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<void> {
		await targetConnector?.teardown?.(loggingComponentType);
	}

	/**
	 * Read the store from file while holding the directory mutex.
	 * Use this for standalone reads (get, query, count, getPartitionContextIds) where
	 * no outer lock is held. Do not call from inside a withLock callback -
	 * use readStore instead to avoid a re-entrant deadlock.
	 * @returns The store.
	 * @internal
	 */
	private async readStoreWithLock(): Promise<T[]> {
		return this.withLock(async () => this.readStore());
	}

	/**
	 * Read the store from file without acquiring the directory mutex.
	 * Must only be called from inside a withLock callback, where the mutex
	 * is already held. Performing the read under the held lock prevents a race with
	 * the atomic rename(tmp→store.json) window on Windows that would otherwise
	 * return ENOENT and be misinterpreted as an empty store.
	 * @returns The store.
	 * @internal
	 */
	private async readStore(): Promise<T[]> {
		const filename = path.join(this._directory, "store.json");

		let store;
		try {
			store = await readFile(filename, "utf8");
		} catch (err) {
			if (ObjectHelper.propertyGet(err, "code") === "ENOENT") {
				// The store has not been written yet, which is valid for a new store.
				return [];
			}
			throw new GeneralError(
				FileEntityStorageConnector.CLASS_NAME,
				"readStoreFailed",
				{ directory: this._directory },
				err
			);
		}

		try {
			return JSON.parse(store) as T[];
		} catch (err) {
			throw new GeneralError(
				FileEntityStorageConnector.CLASS_NAME,
				"readStoreCorrupt",
				{ directory: this._directory },
				err
			);
		}
	}

	/**
	 * Write the store to the file, atomically replacing the previous version so
	 * a reader can never observe a partially written store.
	 * @param store The store to write.
	 * @returns Nothing.
	 * @internal
	 */
	private async writeStore(store: T[]): Promise<void> {
		try {
			const filename = path.join(this._directory, "store.json");
			const tempFilename = `${filename}.tmp`;
			await writeFile(tempFilename, JSON.stringify(store, undefined, "\t"), "utf8");
			await rename(tempFilename, filename);
		} catch (err) {
			throw new GeneralError(
				FileEntityStorageConnector.CLASS_NAME,
				"writeStoreFailed",
				{ directory: this._directory },
				err
			);
		}
	}

	/**
	 * Serialize an update so that concurrent modifications cannot interleave
	 * their read-modify-write cycles, which would lose updates or tear the
	 * store file. The mutex is keyed on the storage directory, so every
	 * connector or worker using the same store serializes with the others.
	 * @param update The update operation to perform.
	 * @returns The result of the update.
	 * @internal
	 */
	private async withLock<U>(update: () => Promise<U>): Promise<U> {
		await Mutex.lock(this._directory, {
			throwOnTimeout: true,
			timeoutMs: this._mutexTimeoutMs
		});
		try {
			return await update();
		} finally {
			Mutex.unlock(this._directory);
		}
	}

	/**
	 * Check if the dir exists.
	 * @param dir The directory to check.
	 * @returns True if the dir exists.
	 * @internal
	 */
	private async dirExists(dir: string): Promise<boolean> {
		try {
			await access(dir);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Find the item in the store.
	 * @param store The store to search.
	 * @param id The id to search for.
	 * @param secondaryIndex The secondary index to search for.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The index of the item if found or -1.
	 * @internal
	 */
	private findItem(
		store: T[],
		id: string,
		secondaryIndex?: keyof T,
		conditions?: { property: keyof T; value: unknown }[]
	): number {
		const finalConditions: EntityCondition<T>[] = [];

		if (!Is.empty(secondaryIndex)) {
			finalConditions.push({
				property: secondaryIndex as string,
				comparison: ComparisonOperator.Equals,
				value: id
			});
		}

		if (Is.arrayValue(conditions)) {
			// If we haven't added a secondary index condition we need to add the primary key condition.
			if (finalConditions.length === 0) {
				finalConditions.push({
					property: this._primaryKey.property as string,
					comparison: ComparisonOperator.Equals,
					value: id
				});
			}
			finalConditions.push(
				...conditions.map(c => ({
					property: c.property as string,
					comparison: ComparisonOperator.Equals,
					value: c.value
				}))
			);
		}

		if (finalConditions.length > 0) {
			for (let i = 0; i < store.length; i++) {
				if (EntityConditions.check(store[i], { conditions: finalConditions })) {
					return i;
				}
			}
		} else {
			return store.findIndex(e => e[this._primaryKey.property] === id);
		}

		return -1;
	}
}
