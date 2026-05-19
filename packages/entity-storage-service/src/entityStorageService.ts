// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { Guards, Is } from "@twin.org/core";
import { type EntityCondition, SortDirection } from "@twin.org/entity";
import {
	EntityStorageConnectorFactory,
	type IEntityStorageComponent,
	type IEntityStorageConnector
} from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";
import type { IEntityStorageServiceConstructorOptions } from "./models/IEntityStorageServiceConstructorOptions.js";

/**
 * Class for performing entity service operations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EntityStorageService<T = any> implements IEntityStorageComponent<T> {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<EntityStorageService>();

	/**
	 * The entity storage for items.
	 * @internal
	 */
	private readonly _entityStorage: IEntityStorageConnector<T>;

	/**
	 * Create a new instance of EntityStorageService.
	 * @param options The dependencies for the entity storage service.
	 */
	constructor(options: IEntityStorageServiceConstructorOptions) {
		Guards.string(
			EntityStorageService.CLASS_NAME,
			nameof(options.entityStorageType),
			options.entityStorageType
		);
		this._entityStorage = EntityStorageConnectorFactory.get<IEntityStorageConnector<T>>(
			options.entityStorageType
		);
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return EntityStorageService.CLASS_NAME;
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The id of the entity.
	 */
	public async set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void> {
		Guards.object(EntityStorageService.CLASS_NAME, nameof(entity), entity);

		return this._entityStorage.set(entity, conditions);
	}

	/**
	 * Set multiple entities in a batch.
	 * @param entities The entities to set.
	 * @returns Nothing.
	 */
	public async setBatch(entities: T[]): Promise<void> {
		Guards.arrayValue(EntityStorageService.CLASS_NAME, nameof(entities), entities);

		return this._entityStorage.setBatch(entities);
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
		Guards.stringValue(EntityStorageService.CLASS_NAME, nameof(id), id);

		return this._entityStorage.get(id, secondaryIndex, conditions);
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
		Guards.stringValue(EntityStorageService.CLASS_NAME, nameof(id), id);

		await this._entityStorage.remove(id, conditions);
	}

	/**
	 * Remove multiple entities by id.
	 * @param ids The ids of the entities to remove.
	 * @returns Nothing.
	 */
	public async removeBatch(ids: string[]): Promise<void> {
		Guards.arrayValue(EntityStorageService.CLASS_NAME, nameof(ids), ids);

		return this._entityStorage.removeBatch(ids);
	}

	/**
	 * Remove all entities from the storage.
	 * @returns Nothing.
	 */
	public async empty(): Promise<void> {
		return this._entityStorage.empty();
	}

	/**
	 * Count all the entities which match the conditions.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The total count of entities in the storage.
	 */
	public async count(conditions?: EntityCondition<T>): Promise<number> {
		return this._entityStorage.count(conditions);
	}

	/**
	 * Query all the entities which match the conditions.
	 * @param conditions The conditions to match for the entities.
	 * @param orderBy The order for the results.
	 * @param orderByDirection The direction for the order, defaults to ascending.
	 * @param properties The optional properties to return, defaults to all.
	 * @param cursor The cursor to request the next chunk of entities.
	 * @param limit The suggested number of entities to return in each chunk, in some scenarios can return a different amount.
	 * @returns All the entities for the storage matching the conditions,
	 * and a cursor which can be used to request more entities.
	 */
	public async query(
		conditions?: EntityCondition<T>,
		orderBy?: keyof T,
		orderByDirection?: SortDirection,
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
		const result = await this._entityStorage.query(
			conditions,
			Is.stringValue(orderBy)
				? [{ property: orderBy, sortDirection: orderByDirection ?? SortDirection.Ascending }]
				: undefined,
			properties,
			cursor,
			limit
		);

		return result;
	}
}
