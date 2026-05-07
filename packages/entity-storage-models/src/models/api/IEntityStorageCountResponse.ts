// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * The response for counting entries in entity storage.
 */
export interface IEntityStorageCountResponse {
	/**
	 * The body of the response.
	 */
	body: {
		/**
		 * The total count of entities.
		 */
		count: number;
	};
}
