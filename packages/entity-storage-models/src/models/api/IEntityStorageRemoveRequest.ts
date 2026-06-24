// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Remove an entry from entity storage.
 */
export interface IEntityStorageRemoveRequest {
	/**
	 * The parameters from the path.
	 */
	pathParams: {
		/**
		 * The id of the entity to remove.
		 */
		id: string;
	};

	/**
	 * The query parameters.
	 */
	query?: {
		/**
		 * The optional conditions to match for the entity, JSON encoded array of property/value pairs.
		 */
		conditions?: string;
	};
}
