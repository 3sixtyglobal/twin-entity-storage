// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { SortDirection } from "@3sixty/entity";

/**
 * Query the entries from entity storage.
 */
export interface IEntityStorageListRequest {
	/**
	 * The parameters from the query.
	 */
	query?: {
		/**
		 * The condition for the query as JSON version of EntityCondition type.
		 */
		conditions?: string;

		/**
		 * The order property for the results.
		 */
		orderBy?: string;

		/**
		 * The direction for the order, defaults to desc.
		 */
		orderByDirection?: SortDirection;

		/**
		 * The properties to return in the response as a comma separated list, by default returns all properties.
		 */
		properties?: string;

		/**
		 * Limit the number of entities to return.
		 */
		limit?: string;

		/**
		 * The cursor to get next chunk of data, returned in previous response.
		 */
		cursor?: string;
	};
}
