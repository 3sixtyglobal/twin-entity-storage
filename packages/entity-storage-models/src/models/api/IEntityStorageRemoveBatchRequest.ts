// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Remove multiple entries from entity storage by id.
 */
export interface IEntityStorageRemoveBatchRequest {
	/**
	 * The ids of the entities to remove.
	 */
	body: string[];
}
