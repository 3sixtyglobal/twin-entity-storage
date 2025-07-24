// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Configuration for the entity storage service.
 */
export interface IEntityStorageConfig {
	/**
	 * Include the user identity when performing storage operations, this allow separation of data per user.
	 * @default false
	 */
	partitionPerUser?: boolean;
}
