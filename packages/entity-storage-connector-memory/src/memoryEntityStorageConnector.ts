// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	HealthCategory,
	HealthStatus,
	type IHealth,
	type IHealthProviderComponent
} from "@twin.org/api-models";
import { ContextIdHelper, ContextIdStore, type IContextIds } from "@twin.org/context";
import {
	Coerce,
	ComponentFactory,
	ConflictError,
	Guards,
	Is,
	type IValidationFailure,
	Mutex,
	ObjectHelper,
	SharedObjectBuffer,
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
import type { IMemoryEntityStorageConnectorConfig } from "./models/IMemoryEntityStorageConnectorConfig.js";
import type { IMemoryEntityStorageConnectorConstructorOptions } from "./models/IMemoryEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations in-memory backed by a shared object buffer.
 *
 * All reads and writes are serialised with a per-schema lock so that concurrent async
 * access, including across worker threads, never produces torn or lost updates.
 *
 * All connector instances that share the same entity schema name share the same underlying
 * buffer, making data written in one instance immediately visible in another, including
 * across worker threads when the main thread forwards worker messages to the lock and
 * buffer handlers.
 */
export class MemoryEntityStorageConnector<T = unknown>
	implements
		IEntityStorageConnector<T>,
		IEntityStorageMigrationConnector<T>,
		IHealthProviderComponent
{
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<MemoryEntityStorageConnector>();

	/**
	 * Default limit for the number of items to return.
	 * @internal
	 */
	private static readonly _DEFAULT_LIMIT: number = 40;

	/**
	 * Partition key for the operation.
	 * @internal
	 */
	private static readonly _PARTITION_KEY: string = "partitionId";

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
	 * The resolved storage key used as the shared buffer and lock key.
	 * @internal
	 */
	private readonly _storageKey: string;

	/**
	 * Initial capacity hint in bytes for the shared entity buffer.
	 * @internal
	 */
	private readonly _initialCapacityBytes?: number;

	/**
	 * Maximum capacity in bytes for the shared entity buffer.
	 * @internal
	 */
	private readonly _maxCapacityBytes?: number;

	/**
	 * Milliseconds to wait for optimistic-lock mutexes before throwing.
	 * @internal
	 */
	private readonly _mutexTimeoutMs?: number;

	/**
	 * Create a new instance of MemoryEntityStorageConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IMemoryEntityStorageConnectorConstructorOptions) {
		Guards.object<IMemoryEntityStorageConnectorConstructorOptions>(
			MemoryEntityStorageConnector.CLASS_NAME,
			nameof(options),
			options
		);
		Guards.stringValue(
			MemoryEntityStorageConnector.CLASS_NAME,
			nameof(options.entitySchema),
			options.entitySchema
		);
		Guards.object<IMemoryEntityStorageConnectorConfig>(
			MemoryEntityStorageConnector.CLASS_NAME,
			nameof(options.config),
			options.config
		);
		Guards.stringValue(
			MemoryEntityStorageConnector.CLASS_NAME,
			nameof(options.config.storageKey),
			options.config.storageKey
		);

		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._storageKey = options.config.storageKey;
		this._partitionContextIds = options.partitionContextIds;
		this._primaryKey = EntitySchemaHelper.getPrimaryKey<T>(this._entitySchema);
		this._versionKey = EntitySchemaHelper.findVersionProperty(this._entitySchema);
		this._initialCapacityBytes = options.config?.initialCapacityBytes;
		this._maxCapacityBytes = options.config?.maxCapacityBytes;
		this._mutexTimeoutMs = Coerce.integer(options.config.mutexTimeoutMs);
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return MemoryEntityStorageConnector.CLASS_NAME;
	}

	/**
	 * Returns the health status of the component.
	 * @returns The health status of the component.
	 */
	public async health(): Promise<IHealth[]> {
		return [
			{
				source: MemoryEntityStorageConnector.CLASS_NAME,
				category: HealthCategory.Connectivity,
				status: HealthStatus.Ok,
				description: "healthDescription",
				data: { entityType: this._storageKey }
			}
		];
	}

	/**
	 * Get the schema for the entities.
	 * @returns The schema for the entities.
	 */
	public getSchema(): IEntitySchema {
		return this._entitySchema as IEntitySchema;
	}

	/**
	 * Bootstrap the component by creating and initializing any resources it needs.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the bootstrapping process was successful.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		await SharedObjectBuffer.create(this._storageKey, {
			initialCapacityBytes: this._initialCapacityBytes,
			maxCapacityBytes: this._maxCapacityBytes
		});

		return true;
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
		Guards.stringValue(MemoryEntityStorageConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const finalConditions = conditions ? [...conditions] : [];
		if (Is.stringValue(partitionKey)) {
			finalConditions.push({
				property: MemoryEntityStorageConnector._PARTITION_KEY as keyof T,
				value: partitionKey
			});
		}

		return this.withLock(entities => {
			const index = this.findItem(entities, id, secondaryIndex, finalConditions);
			const item = entities[index];

			if (Is.objectValue(item)) {
				return {
					result: EntityStorageHelper.unPrepareEntity<T>(item, [
						MemoryEntityStorageConnector._PARTITION_KEY
					])
				};
			}
			return { result: undefined };
		});
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns Resolves when the entity has been stored.
	 * @throws ConflictError when the entity exists but the supplied conditions or version do not match the stored state.
	 */
	public async set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void> {
		Guards.object<T>(MemoryEntityStorageConnector.CLASS_NAME, nameof(entity), entity);
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
				? [{ property: MemoryEntityStorageConnector._PARTITION_KEY, value: partitionKey }]
				: undefined,
			{ nullBehavior: "omit" }
		);

		const baseConditions: { property: keyof T; value: unknown }[] = [];
		if (Is.stringValue(partitionKey)) {
			baseConditions.push({
				property: MemoryEntityStorageConnector._PARTITION_KEY as keyof T,
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

		return this.withLock(entities => {
			const entityId = prepared[this._primaryKey.property] as string;
			const existingIndex = this.findItem(entities, entityId, undefined, fullConditions);

			if (existingIndex >= 0) {
				if (Is.stringValue(this._versionKey)) {
					const storedVersion =
						ObjectHelper.propertyGet<number>(entities[existingIndex], this._versionKey) ?? 0;
					ObjectHelper.propertySet(prepared, this._versionKey, storedVersion + 1);
				}
				entities[existingIndex] = prepared;
			} else {
				const existsIndex = this.findItem(entities, entityId, undefined, baseConditions);
				if (existsIndex >= 0) {
					if (Is.stringValue(this._versionKey)) {
						throw new ConflictError(
							MemoryEntityStorageConnector.CLASS_NAME,
							hasVersionCheck ? "optimisticLockFailed" : "conditionFailed",
							entityId
						);
					}
					return { updated: undefined, result: undefined };
				}
				if (hasVersionCheck) {
					throw new ConflictError(
						MemoryEntityStorageConnector.CLASS_NAME,
						"optimisticLockFailed",
						entityId
					);
				}
				if (Is.stringValue(this._versionKey)) {
					ObjectHelper.propertySet(prepared, this._versionKey, 1);
				}
				entities.push(prepared);
			}
			return { updated: entities, result: undefined };
		});
	}

	/**
	 * Set multiple entities in a batch.
	 * @param entities The entities to set.
	 * @returns Nothing.
	 */
	public async setBatch(entities: T[]): Promise<void> {
		Guards.arrayValue(MemoryEntityStorageConnector.CLASS_NAME, nameof(entities), entities);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const preparedItems = entities.map(entity =>
			EntityStorageHelper.prepareEntity(
				entity,
				this._entitySchema,
				Is.stringValue(partitionKey)
					? [{ property: MemoryEntityStorageConnector._PARTITION_KEY, value: partitionKey }]
					: undefined,
				{ nullBehavior: "omit" }
			)
		);

		return this.withLock(store => {
			const indexMap = new Map<string, number>();
			for (let i = 0; i < store.length; i++) {
				const stored = store[i];
				const storedPartition = ObjectHelper.propertyGet(
					stored,
					MemoryEntityStorageConnector._PARTITION_KEY
				);
				if (!Is.stringValue(partitionKey) || storedPartition === partitionKey) {
					indexMap.set(stored[this._primaryKey.property] as string, i);
				}
			}

			for (const prepared of preparedItems) {
				const id = prepared[this._primaryKey.property] as string;
				const existingIndex = indexMap.get(id);
				if (existingIndex !== undefined) {
					store[existingIndex] = prepared;
				} else {
					const newIndex = store.push(prepared) - 1;
					indexMap.set(id, newIndex);
				}
			}

			return { updated: store, result: undefined };
		});
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
		Guards.stringValue(MemoryEntityStorageConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const baseConditions: { property: keyof T; value: unknown }[] = [];
		if (Is.stringValue(partitionKey)) {
			baseConditions.push({
				property: MemoryEntityStorageConnector._PARTITION_KEY as keyof T,
				value: partitionKey
			});
		}

		const fullConditions: { property: keyof T; value: unknown }[] = [
			...baseConditions,
			...(conditions ?? [])
		];

		return this.withLock(entities => {
			const index = this.findItem(entities, id, undefined, fullConditions);
			if (index >= 0) {
				entities.splice(index, 1);
			} else if (Is.arrayValue(conditions)) {
				const existsIndex = this.findItem(entities, id, undefined, baseConditions);
				if (existsIndex >= 0 && Is.stringValue(this._versionKey)) {
					throw new ConflictError(MemoryEntityStorageConnector.CLASS_NAME, "conditionFailed", id);
				}
			}
			return { updated: entities, result: undefined };
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
				MemoryEntityStorageConnector.CLASS_NAME,
				"query",
				validationFailures
			);
		}

		return this.withLock(store => {
			let allEntities = store.slice();

			const finalConditions: EntityCondition<T> = {
				conditions: [],
				logicalOperator: LogicalOperator.And
			};

			if (Is.stringValue(partitionKey)) {
				finalConditions.conditions.push({
					property: MemoryEntityStorageConnector._PARTITION_KEY,
					comparison: ComparisonOperator.Equals,
					value: partitionKey
				});
			}

			if (!Is.empty(conditions)) {
				finalConditions.conditions.push(EntityStorageHelper.normalizeConditionValues(conditions));
			}

			const resultEntities = [];
			const finalLimit = limit ?? MemoryEntityStorageConnector._DEFAULT_LIMIT;
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
						resultEntities.length < finalLimit
					) {
						const entity = Is.arrayValue(properties)
							? ObjectHelper.pick(allEntities[i], properties)
							: allEntities[i];
						resultEntities.push(
							EntityStorageHelper.unPrepareEntity<T>(entity, [
								MemoryEntityStorageConnector._PARTITION_KEY
							])
						);
						if (resultEntities.length >= finalLimit) {
							if (i < allEntities.length - 1) {
								nextCursor = (i + 1).toString();
							}
							break;
						}
					}
				}
			}

			return { result: { entities: resultEntities, cursor: nextCursor } };
		});
	}

	/**
	 * Remove all entities from the storage.
	 * @returns Nothing.
	 */
	public async empty(): Promise<void> {
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		return this.withLock(entities => {
			if (Is.stringValue(partitionKey)) {
				const filtered = entities.filter(
					item =>
						ObjectHelper.propertyGet(item, MemoryEntityStorageConnector._PARTITION_KEY) !==
						partitionKey
				);
				return { updated: filtered, result: undefined };
			}
			return { updated: [], result: undefined };
		});
	}

	/**
	 * Remove multiple entities by id.
	 * @param ids The ids of the entities to remove.
	 * @returns Nothing.
	 */
	public async removeBatch(ids: string[]): Promise<void> {
		Guards.arrayValue(MemoryEntityStorageConnector.CLASS_NAME, nameof(ids), ids);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const finalConditions: { property: keyof T; value: unknown }[] = [];
		if (Is.stringValue(partitionKey)) {
			finalConditions.push({
				property: MemoryEntityStorageConnector._PARTITION_KEY as keyof T,
				value: partitionKey
			});
		}

		return this.withLock(entities => {
			for (const id of ids) {
				const index = this.findItem(entities, id, undefined, finalConditions);
				if (index >= 0) {
					entities.splice(index, 1);
				}
			}
			return { updated: entities, result: undefined };
		});
	}

	/**
	 * Teardown the storage by clearing the underlying shared buffer for this schema.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the teardown process was successful.
	 */
	public async teardown(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		await nodeLogging?.log({
			level: "info",
			source: MemoryEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "storeTearingDown"
		});

		await Mutex.lock(this._storageKey, { throwOnTimeout: true, timeoutMs: this._mutexTimeoutMs });
		try {
			SharedObjectBuffer.remove(this._storageKey);
		} finally {
			Mutex.unlock(this._storageKey);
		}

		await nodeLogging?.log({
			level: "info",
			source: MemoryEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "storeTornDown"
		});

		return true;
	}

	/**
	 * Count all the entities which match the conditions.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The total count of entities in the storage.
	 */
	public async count(conditions?: EntityCondition<T>): Promise<number> {
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const finalConditions: EntityCondition<T> = {
			conditions: [],
			logicalOperator: LogicalOperator.And
		};

		if (Is.stringValue(partitionKey)) {
			finalConditions.conditions.push({
				property: MemoryEntityStorageConnector._PARTITION_KEY,
				comparison: ComparisonOperator.Equals,
				value: partitionKey
			});
		}

		if (!Is.empty(conditions)) {
			finalConditions.conditions.push(EntityStorageHelper.normalizeConditionValues(conditions));
		}

		return this.withLock(entities => {
			if (finalConditions.conditions.length === 0) {
				return { result: entities.length };
			}
			return {
				result: entities.filter(item => EntityConditions.check(item, finalConditions)).length
			};
		});
	}

	/**
	 * Get all entities in the memory store.
	 * @returns All stored entities with partition keys removed.
	 */
	public async getStore(): Promise<T[]> {
		return this.withLock(entities => ({
			result: entities.map(item =>
				EntityStorageHelper.unPrepareEntity<T>(item, [MemoryEntityStorageConnector._PARTITION_KEY])
			)
		}));
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
	 * @returns The list of unique context ids.
	 */
	public async getPartitionContextIds(): Promise<IContextIds[] | undefined> {
		if (!Is.arrayValue(this._partitionContextIds)) {
			return undefined;
		}
		return this.withLock(entities => {
			const contextIds: { [id: string]: IContextIds } = {};
			for (const entity of entities) {
				const partitionId = ObjectHelper.propertyGet(
					entity,
					MemoryEntityStorageConnector._PARTITION_KEY
				);
				if (Is.stringValue(partitionId)) {
					contextIds[partitionId] = ContextIdHelper.shortSplit(
						this._partitionContextIds ?? [],
						partitionId
					);
				}
			}
			return { result: Object.values(contextIds) };
		});
	}

	/**
	 * Create the target connector for performing the migration it will use a temporary storage location.
	 * @param newEntitySchema The name of the new entity schema to create the connector for.
	 * @returns Connector for performing the migration.
	 */
	public async createTargetConnector<U>(
		newEntitySchema: string
	): Promise<IEntityStorageConnector<U>> {
		// Resolve the target schema name the same way _storageKey is resolved in the constructor.
		const targetSchemaEntry = EntitySchemaFactory.get(newEntitySchema);
		const targetSchemaName = targetSchemaEntry.type ?? newEntitySchema;

		// When migrating to a different schema, wipe the target buffer so that every
		// migration starts from an empty store regardless of any previous connector
		// instances that shared the same schema name.
		if (targetSchemaName !== this._storageKey) {
			await Mutex.lock(targetSchemaName, { throwOnTimeout: true, timeoutMs: this._mutexTimeoutMs });
			try {
				SharedObjectBuffer.remove(targetSchemaName);
			} finally {
				Mutex.unlock(targetSchemaName);
			}
		}

		return new MemoryEntityStorageConnector<U>({
			entitySchema: newEntitySchema,
			partitionContextIds: this._partitionContextIds,
			config: {
				storageKey: this._storageKey,
				initialCapacityBytes: this._initialCapacityBytes,
				maxCapacityBytes: this._maxCapacityBytes
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
		targetConnector: IEntityStorageConnector<U>,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<IEntityStorageConnector<U>> {
		return targetConnector;
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
	): Promise<void> {}

	/**
	 * Acquires the schema-keyed lock, runs fn with the current entity array, optionally
	 * writes back a modified array, then releases the lock.
	 * @param fn The synchronous function to run while the lock is held.
	 * @returns The result produced by fn.
	 * @internal
	 */
	private async withLock<R>(fn: (entities: T[]) => { updated?: T[]; result: R }): Promise<R> {
		await Mutex.lock(this._storageKey, { throwOnTimeout: true, timeoutMs: this._mutexTimeoutMs });
		try {
			await SharedObjectBuffer.create(this._storageKey, {
				initialCapacityBytes: this._initialCapacityBytes,
				maxCapacityBytes: this._maxCapacityBytes
			});
			const entities = (await SharedObjectBuffer.read<T[]>(this._storageKey)) ?? [];
			const outcome = fn(entities);
			if (outcome.updated !== undefined) {
				await SharedObjectBuffer.write<T[]>(this._storageKey, outcome.updated);
			}
			return outcome.result;
		} finally {
			Mutex.unlock(this._storageKey);
		}
	}

	/**
	 * Find the item in the provided entity array.
	 * @param entities The current entity array.
	 * @param id The id to search for.
	 * @param secondaryIndex The secondary index to search for.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The index of the item if found or -1.
	 * @internal
	 */
	private findItem(
		entities: T[],
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
			for (let i = 0; i < entities.length; i++) {
				if (EntityConditions.check(entities[i], { conditions: finalConditions })) {
					return i;
				}
			}
		} else {
			return entities.findIndex(e => e[this._primaryKey.property] === id);
		}

		return -1;
	}
}
