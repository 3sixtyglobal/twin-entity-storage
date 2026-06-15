// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IMemoryEntityStorageConnectorConfig } from "./IMemoryEntityStorageConnectorConfig.js";

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
	 * Configuration for storage key and capacity settings.
	 */
	config: IMemoryEntityStorageConnectorConfig;
}
