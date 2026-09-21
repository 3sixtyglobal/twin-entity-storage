// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IComponent } from "@twin.org/core";
import type { EntityCondition, IEntitySchema, SortDirection } from "@twin.org/entity";
import type { IEntityStorageJoinOptions } from "./IEntityStorageJoinOptions.js";

/**
 * Interface describing an entity storage connector.
 */
export interface IEntityStorageConnector<T = unknown> extends IComponent {
	/**
	 * Get the schema for the entities.
	 * @returns The schema for the entities.
	 */
	getSchema(): IEntitySchema;

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The id of the entity.
	 * @throws ConflictError when the entity exists but the supplied conditions or version do not match the stored state.
	 */
	set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void>;

	/**
	 * Set multiple entities in a batch.
	 * @param entities The entities to set.
	 * @returns Nothing.
	 */
	setBatch(entities: T[]): Promise<void>;

	/**
	 * Get an entity.
	 * @param id The id of the entity to get, or the index value if secondaryIndex is set.
	 * @param secondaryIndex Get the item using a secondary index.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The object if it can be found or undefined.
	 */
	get(
		id: string,
		secondaryIndex?: keyof T,
		conditions?: { property: keyof T; value: unknown }[]
	): Promise<T | undefined>;

	/**
	 * Remove the entity.
	 * @param id The id of the entity to remove.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns Nothing.
	 * @throws ConflictError when the entity exists but the supplied conditions or version do not match the stored state.
	 */
	remove(id: string, conditions?: { property: keyof T; value: unknown }[]): Promise<void>;

	/**
	 * Remove multiple entities by id.
	 * @param ids The ids of the entities to remove.
	 * @returns Nothing.
	 */
	removeBatch(ids: string[]): Promise<void>;

	/**
	 * Query all the entities which match the conditions.
	 * @param conditions The conditions to match for the entities.
	 * @param sortProperties The optional sort order.
	 * @param properties The optional properties to return, defaults to all.
	 * @param cursor The cursor to request the next chunk of entities.
	 * @param limit The suggested number of entities to return in each chunk, in some scenarios can return a different amount.
	 * @returns All the entities for the storage matching the conditions,
	 * and a cursor which can be used to request more entities.
	 */
	query(
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
	}>;

	/**
	 * Query all the entities which match the conditions, attaching to each one the entities from a
	 * second storage connector whose join property matches. The join behaves like a left join by
	 * default, a primary entity with no matches is still returned with an empty joined list, unless
	 * joinRequired asks for an inner join and those entities are left out altogether.
	 * @param joinConnector The connector holding the entities to join to.
	 * @param joinOptions The properties to join on, the conditions, sort order, projection and
	 * paging for the primary entities, the optional grouping and group conditions, and the optional
	 * conditions, sort order and projection for the joined entities.
	 * @returns All the entities for the storage matching the conditions with their joined entities,
	 * and a cursor which can be used to request more entities.
	 */
	queryJoin<U>(
		joinConnector: IEntityStorageConnector<U>,
		joinOptions: IEntityStorageJoinOptions<T, U>
	): Promise<{
		/**
		 * The entities, which can be partial if a limited keys list was provided, each with the
		 * list of entities joined to it.
		 */
		entities: (Partial<T> & { joined: Partial<U>[] })[];
		/**
		 * An optional cursor, when defined can be used to call queryJoin to get more entities.
		 */
		cursor?: string;
	}>;

	/**
	 * Remove all entities from the storage.
	 * @returns Nothing.
	 */
	empty(): Promise<void>;

	/**
	 * Count all the entities which match the conditions.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The total count of entities in the storage.
	 */
	count(conditions?: EntityCondition<T>): Promise<number>;
}
