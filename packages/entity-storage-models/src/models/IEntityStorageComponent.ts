// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IComponent } from "@twin.org/core";
import type { EntityCondition, SortDirection } from "@twin.org/entity";

/**
 * Interface describing an entity storage component.
 */
export interface IEntityStorageComponent<T = unknown> extends IComponent {
	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @param userIdentity The user identity to use with storage operations.
	 * @returns The id of the entity.
	 */
	set(entity: T, userIdentity?: string): Promise<void>;

	/**
	 * Get an entity.
	 * @param id The id of the entity to get, or the index value if secondaryIndex is set.
	 * @param secondaryIndex Get the item using a secondary index.
	 * @param userIdentity The user identity to use with storage operations.
	 * @returns The object if it can be found or undefined.
	 */
	get(id: string, secondaryIndex?: keyof T, userIdentity?: string): Promise<T | undefined>;

	/**
	 * Remove the entity.
	 * @param id The id of the entity to remove.
	 * @param userIdentity The user identity to use with storage operations.
	 * @returns Nothing.
	 */
	remove(id: string, userIdentity?: string): Promise<void>;

	/**
	 * Query all the entities which match the conditions.
	 * @param conditions The conditions to match for the entities.
	 * @param orderBy The order for the results.
	 * @param orderByDirection The direction for the order, defaults to ascending.
	 * @param properties The optional properties to return, defaults to all.
	 * @param cursor The cursor to request the next chunk of entities.
	 * @param limit The suggested number of entities to return in each chunk, in some scenarios can return a different amount.
	 * @param userIdentity The user identity to use with storage operations.
	 * @returns All the entities for the storage matching the conditions,
	 * and a cursor which can be used to request more entities.
	 */
	query(
		conditions?: EntityCondition<T>,
		orderBy?: keyof T,
		orderByDirection?: SortDirection,
		properties?: (keyof T)[],
		cursor?: string,
		limit?: number,
		userIdentity?: string
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
}
