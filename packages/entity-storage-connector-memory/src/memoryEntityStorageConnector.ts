// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdHelper, ContextIdStore, type IContextIds } from "@twin.org/context";
import {
	Coerce,
	ComponentFactory,
	Guards,
	HealthStatus,
	type IHealth,
	Is,
	ObjectHelper
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
	EntityHelper,
	type IEntityStorageConnector,
	type IEntityStorageMigrationConnector,
	type IMigrationOptions
} from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import type { IMemoryEntityStorageConnectorConstructorOptions } from "./models/IMemoryEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations in-memory.
 */
export class MemoryEntityStorageConnector<T = unknown>
	implements IEntityStorageConnector<T>, IEntityStorageMigrationConnector
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
	 * The storage for the in-memory items.
	 * @internal
	 */
	private _store: T[];

	/**
	 * Create a new instance of MemoryEntityStorageConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IMemoryEntityStorageConnectorConstructorOptions) {
		Guards.object(MemoryEntityStorageConnector.CLASS_NAME, nameof(options), options);
		Guards.stringValue(
			MemoryEntityStorageConnector.CLASS_NAME,
			nameof(options.entitySchema),
			options.entitySchema
		);
		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._partitionContextIds = options.partitionContextIds;
		this._primaryKey = EntitySchemaHelper.getPrimaryKey<T>(this._entitySchema);
		this._store = [];
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
				status: HealthStatus.Ok,
				description: "healthDescription",
				data: { entityType: this._entitySchema.type }
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

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const finalConditions = conditions ?? [];
		if (Is.stringValue(partitionKey)) {
			finalConditions.push({
				property: MemoryEntityStorageConnector._PARTITION_KEY as keyof T,
				value: partitionKey
			});
		}

		const index = this.findItem(id, secondaryIndex, finalConditions);
		const item = index >= 0 ? this._store[index] : undefined;

		if (Is.objectValue(item)) {
			return EntityHelper.unPrepareEntity<T>(item, [MemoryEntityStorageConnector._PARTITION_KEY]);
		}

		return undefined;
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The id of the entity.
	 */
	public async set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void> {
		Guards.object<T>(MemoryEntityStorageConnector.CLASS_NAME, nameof(entity), entity);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const finalConditions = conditions ?? [];

		const prepared = EntityHelper.prepareEntity(
			entity,
			this._entitySchema,
			Is.stringValue(partitionKey)
				? [{ property: MemoryEntityStorageConnector._PARTITION_KEY, value: partitionKey }]
				: undefined
		);

		if (Is.stringValue(partitionKey)) {
			finalConditions.push({
				property: MemoryEntityStorageConnector._PARTITION_KEY as keyof T,
				value: partitionKey
			});
		}

		const existingIndex = this.findItem(
			prepared[this._primaryKey.property] as string,
			undefined,
			finalConditions
		);
		if (existingIndex >= 0) {
			this._store[existingIndex] = prepared;
		} else {
			this._store.push(prepared);
		}
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

		const indexMap = new Map<string, number>();
		for (let i = 0; i < this._store.length; i++) {
			const stored = this._store[i];
			const storedPartition = ObjectHelper.propertyGet(
				stored,
				MemoryEntityStorageConnector._PARTITION_KEY
			);
			if (!Is.stringValue(partitionKey) || storedPartition === partitionKey) {
				indexMap.set(stored[this._primaryKey.property] as string, i);
			}
		}

		for (const entity of entities) {
			const prepared = EntityHelper.prepareEntity(
				entity,
				this._entitySchema,
				Is.stringValue(partitionKey)
					? [{ property: MemoryEntityStorageConnector._PARTITION_KEY, value: partitionKey }]
					: undefined
			);
			const id = prepared[this._primaryKey.property] as string;
			const existingIndex = indexMap.get(id);
			if (existingIndex !== undefined) {
				this._store[existingIndex] = prepared;
			} else {
				const newIndex = this._store.push(prepared) - 1;
				indexMap.set(id, newIndex);
			}
		}
	}

	/**
	 * Remove the entity.
	 * @param id The id of the entity to remove.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns Nothing.
	 */
	public async remove(
		id: string,
		conditions?: { property: keyof T; value: unknown }[]
	): Promise<void> {
		Guards.stringValue(MemoryEntityStorageConnector.CLASS_NAME, nameof(id), id);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const finalConditions = conditions ?? [];
		if (Is.stringValue(partitionKey)) {
			finalConditions.push({
				property: MemoryEntityStorageConnector._PARTITION_KEY as keyof T,
				value: partitionKey
			});
		}

		const index = this.findItem(id, undefined, finalConditions);

		if (index >= 0) {
			this._store.splice(index, 1);
		}
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

		let allEntities = this._store.slice();

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
			finalConditions.conditions.push(EntityHelper.normalizeConditionValues(conditions));
		}

		const entities = [];
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
					entities.length < finalLimit
				) {
					const entity = Is.arrayValue(properties)
						? ObjectHelper.pick(allEntities[i], properties)
						: allEntities[i];
					entities.push(
						EntityHelper.unPrepareEntity<T>(entity, [MemoryEntityStorageConnector._PARTITION_KEY])
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
	 * Remove all entities from the storage.
	 * @returns Nothing.
	 */
	public async empty(): Promise<void> {
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		if (Is.stringValue(partitionKey)) {
			for (let i = this._store.length - 1; i >= 0; i--) {
				if (
					ObjectHelper.propertyGet(this._store[i], MemoryEntityStorageConnector._PARTITION_KEY) ===
					partitionKey
				) {
					this._store.splice(i, 1);
				}
			}
		} else {
			this._store.splice(0, this._store.length);
		}
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

		for (const id of ids) {
			const index = this.findItem(id, undefined, finalConditions);
			if (index >= 0) {
				this._store.splice(index, 1);
			}
		}
	}

	/**
	 * Teardown the storage by clearing the underlying store.
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

		this._store.splice(0, this._store.length);

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
			finalConditions.conditions.push(EntityHelper.normalizeConditionValues(conditions));
		}

		if (finalConditions.conditions.length === 0) {
			return this._store.length;
		}

		return this._store.filter(item => EntityConditions.check(item, finalConditions)).length;
	}

	/**
	 * Get the memory store.
	 * @returns The store.
	 */
	public getStore(): T[] {
		return this._store.map(item =>
			EntityHelper.unPrepareEntity<T>(item, [MemoryEntityStorageConnector._PARTITION_KEY])
		);
	}

	/**
	 * Get a unique list of all the context ids from the storage.
	 * @returns The list of unique context ids.
	 */
	public async getPartitionContextIds(): Promise<IContextIds[]> {
		const contextIds: { [id: string]: IContextIds } = {};

		for (const entity of this._store) {
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
		// No resources to manipulate for in-memory, just return a new connector with the new store and the new schema.
		return new MemoryEntityStorageConnector<U>({
			entitySchema: newEntitySchema,
			partitionContextIds: this._partitionContextIds
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
		options?: IMigrationOptions<T, U>,
		loggingComponentType?: string
	): Promise<IEntityStorageConnector<U>> {
		// Nothing to do for in-memory as the new connector is already using the correct store and schema.
		// And there is nothing to teardown for the old connector as it is in-memory and will be garbage
		// collected when there are no references to it.
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
		options?: IMigrationOptions<T, U>,
		loggingComponentType?: string
	): Promise<void> {
		// Nothing to do for in-memory as there are no resources to cleanup.
	}

	/**
	 * Find the item in the store.
	 * @param id The id to search for.
	 * @param secondaryIndex The secondary index to search for.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The index of the item if found or -1.
	 * @internal
	 */
	private findItem(
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
			for (let i = 0; i < this._store.length; i++) {
				if (EntityConditions.check(this._store[i], { conditions: finalConditions })) {
					return i;
				}
			}
		} else {
			return this._store.findIndex(e => e[this._primaryKey.property] === id);
		}

		return -1;
	}
}
