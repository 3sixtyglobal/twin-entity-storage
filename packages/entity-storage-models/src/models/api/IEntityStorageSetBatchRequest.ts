// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Set multiple entries in entity storage.
 */
export interface IEntityStorageSetBatchRequest {
	/**
	 * The entities to set.
	 */
	body: unknown[];
}
