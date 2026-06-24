// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Set an entry in entity storage.
 */
export interface IEntityStorageSetRequest {
	/**
	 * The data to be used in the entity.
	 */
	body: unknown;

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
