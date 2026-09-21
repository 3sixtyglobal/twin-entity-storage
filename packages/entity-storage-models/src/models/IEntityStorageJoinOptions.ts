// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { EntityCondition, SortDirection } from "@twin.org/entity";

/**
 * Interface describing how a primary entity is joined to the entities of a second connector.
 * The properties without a join prefix apply to the primary entities and mirror the parameters of
 * query, the ones with a join prefix apply to the entities being joined to.
 */
export interface IEntityStorageJoinOptions<T = unknown, U = unknown> {
	/**
	 * The property on the primary entity which holds the value to join from.
	 */
	property: keyof T;

	/**
	 * The property on the joined entity which holds the value to join to.
	 */
	joinProperty: keyof U;

	/**
	 * The optional property on the primary entity to group the results by. When supplied a single
	 * result is returned for each distinct value of the property, taking its values from the first
	 * primary entity of the group in the sort order, with the joined entities of every primary
	 * entity in the group combined into one deduplicated list. Primary entities whose group
	 * property is null or undefined are excluded. Grouping places no restriction on the sort order
	 * or the projection, the groups are ordered by the position of the entity they took their
	 * values from.
	 */
	groupProperty?: keyof T;

	/**
	 * The optional conditions to match for the primary entities.
	 */
	conditions?: EntityCondition<T>;

	/**
	 * The optional sort order for the primary entities. When a group property is supplied this also
	 * decides which entity of each group the result takes its values from.
	 */
	sortProperties?: {
		property: keyof T;
		sortDirection: SortDirection;
	}[];

	/**
	 * The optional properties to return for the primary entities, defaults to all.
	 */
	properties?: (keyof T)[];

	/**
	 * The cursor to request the next chunk of entities. A cursor is opaque, holds a key set rather
	 * than an offset, and is bound to the query which produced it, so one produced by a query with
	 * different conditions, sorting or grouping is rejected rather than silently restarting the
	 * page somewhere else.
	 */
	cursor?: string;

	/**
	 * The suggested number of entities to return in each chunk, in some scenarios can return a
	 * different amount. The limit counts primary entities, or groups when a group property is
	 * supplied, not the joined entities attached to them.
	 */
	limit?: number;

	/**
	 * The optional conditions which every group must satisfy, each one by at least one of the
	 * primary entities it holds. A group where no entity matches one of them is left out
	 * altogether. Only valid alongside a group property.
	 */
	groupConditions?: EntityCondition<T>[];

	/**
	 * The optional conditions to match for the joined entities. By default these filter which
	 * entities appear in the joined list without removing primary entities which have no matches.
	 */
	joinConditions?: EntityCondition<U>;

	/**
	 * Require every primary entity to have at least one joined entity, turning the left join into
	 * an inner join. A primary entity with no match, or whose only matches are removed by the join
	 * conditions, is left out of the page entirely rather than returned with an empty joined list,
	 * so the join conditions narrow the page and the limit counts entities which really have
	 * matches.
	 */
	joinRequired?: boolean;

	/**
	 * The optional sort order for the joined entities.
	 */
	joinSortProperties?: {
		property: keyof U;
		sortDirection: SortDirection;
	}[];

	/**
	 * The optional properties to return for the joined entities, defaults to all.
	 */
	joinProperties?: (keyof U)[];
}
