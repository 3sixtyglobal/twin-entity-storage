// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Options for the Memory Entity Storage Connector constructor.
 */
export interface IMemoryEntityStorageConnectorConstructorOptions {
	/**
	 * The schema for the entity.
	 */
	entitySchema: string;

	/**
	 * The keys to use from the context ids to create partitions.
	 */
	partitionContextIds?: string[];

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
