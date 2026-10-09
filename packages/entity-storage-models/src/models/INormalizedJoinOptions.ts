// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { EntityCondition } from "@3sixty/entity";

/**
 * Interface describing the parts of a set of join options which decide where a page starts and
 * ends, reduced to a stable form so two queries which page the same way normalise to the same
 * value.
 */
export interface INormalizedJoinOptions<T = unknown, U = unknown> {
	/**
	 * The property on the primary entity which holds the value to join from.
	 */
	property: string;

	/**
	 * The property on the joined entity which holds the value to join to.
	 */
	joinProperty: string;

	/**
	 * The property the primary entities are grouped by, absent when they are not grouped.
	 */
	groupProperty?: string;

	/**
	 * The sort order of the primary entities, each entry holding the property and its direction.
	 */
	sortProperties: string[];

	/**
	 * The conditions to match for the primary entities.
	 */
	conditions?: EntityCondition<T>;

	/**
	 * The conditions every group must satisfy.
	 */
	groupConditions?: EntityCondition<T>[];

	/**
	 * The conditions to match for the joined entities.
	 */
	joinConditions?: EntityCondition<U>;

	/**
	 * Whether a primary entity is required to have at least one joined entity.
	 */
	joinRequired: boolean;
}
