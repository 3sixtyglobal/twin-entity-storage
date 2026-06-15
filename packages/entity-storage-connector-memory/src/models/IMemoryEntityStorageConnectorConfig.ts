// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Configuration for the Memory Entity Storage Connector.
 */
export interface IMemoryEntityStorageConnectorConfig {
	/**
	 * Key to use for the shared buffer instead of the entity schema type.
	 * Use this to give two connectors with the same entitySchema separate storage.
	 */
	storageKey: string;

	/**
	 * Initial capacity in bytes for the shared entity buffer.
	 * @default 16 MiB.
	 */
	initialCapacityBytes?: number;

	/**
	 * Maximum JSON payload size in bytes for the shared entity buffer.
	 * @default 256 MiB.
	 */
	maxCapacityBytes?: number;
}
