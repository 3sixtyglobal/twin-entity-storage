// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdHelper, ContextIdStore } from "@twin.org/context";
import { Coerce, Guards, Is, ObjectHelper } from "@twin.org/core";
import {
	ComparisonOperator,
	EntityConditions,
	EntitySchemaFactory,
	EntitySchemaHelper,
	EntitySorter,
	LogicalOperator,
	type EntityCondition,
	type IEntitySchema,
	type IEntitySchemaProperty,
	type SortDirection
} from "@twin.org/entity";
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";
import type { IMemoryEntityStorageConnectorConstructorOptions } from "./models/IMemoryEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations in-memory.
 */
export class MemoryEntityStorageConnector<T = unknown> implements IEntityStorageConnector<T> {
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
	private readonly _store: T[];

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
		const item = index >= 0 ? ObjectHelper.clone(this._store[index]) : undefined;

		if (Is.objectValue(item)) {
			ObjectHelper.propertyDelete(item, MemoryEntityStorageConnector._PARTITION_KEY);
		}

		return item;
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

		EntitySchemaHelper.validateEntity(entity, this.getSchema());

		const finalConditions = conditions ?? [];
		const finalEntity = ObjectHelper.clone(entity);

		if (Is.stringValue(partitionKey)) {
			finalConditions.push({
				property: MemoryEntityStorageConnector._PARTITION_KEY as keyof T,
				value: partitionKey
			});
			ObjectHelper.propertySet(
				finalEntity,
				MemoryEntityStorageConnector._PARTITION_KEY,
				partitionKey
			);
		}

		const existingIndex = this.findItem(
			finalEntity[this._primaryKey.property] as string,
			undefined,
			finalConditions
		);
		if (existingIndex >= 0) {
			this._store[existingIndex] = finalEntity;
		} else {
			this._store.push(finalEntity);
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
			finalConditions.conditions.push(conditions);
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
					const entity = ObjectHelper.clone(ObjectHelper.pick(allEntities[i], properties));
					ObjectHelper.propertyDelete(entity, MemoryEntityStorageConnector._PARTITION_KEY);
					entities.push(entity);
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
	 * Get the memory store.
	 * @returns The store.
	 */
	public getStore(): T[] {
		return this._store;
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
