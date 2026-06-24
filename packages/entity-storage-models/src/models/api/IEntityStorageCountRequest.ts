// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Count the entries in entity storage.
 */
export interface IEntityStorageCountRequest {
	/**
	 * The query parameters.
	 */
	query?: {
		/**
		 * The optional conditions to filter the count, JSON encoded EntityCondition.
		 */
		conditions?: string;
	};
}
