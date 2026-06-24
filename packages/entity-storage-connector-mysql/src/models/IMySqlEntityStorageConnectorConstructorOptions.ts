// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IMySqlEntityStorageConnectorConfig } from "./IMySqlEntityStorageConnectorConfig.js";

/**
 * The options for the MySql entity storage connector constructor.
 */
export interface IMySqlEntityStorageConnectorConstructorOptions {
	/**
	 * The schema for the entity.
	 */
	entitySchema: string;

	/**
	 * The keys to use from the context ids to create partitions.
	 */
	partitionContextIds?: string[];

	/**
	 * The type of logging component to use.
	 */
	loggingComponentType?: string;

	/**
	 * The configuration for the connector.
	 */
	config: IMySqlEntityStorageConnectorConfig;
}
