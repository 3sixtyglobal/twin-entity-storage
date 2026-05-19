// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Get an entry from entity storage.
 */
export interface IEntityStorageGetRequest {
	/**
	 * The parameters from the path.
	 */
	pathParams: {
		/**
		 * The id of the entity to get.
		 */
		id: string;
	};

	/**
	 * The query parameters.
	 */
	query?: {
		/**
		 * The secondary index to query with the id.
		 */
		secondaryIndex?: string;

		/**
		 * The optional conditions to match for the entity, JSON encoded array of property/value pairs.
		 */
		conditions?: string;
	};
}
