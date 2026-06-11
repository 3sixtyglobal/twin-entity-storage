// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { ICosmosDbEntityStorageConnectorConfig } from "./ICosmosDbEntityStorageConnectorConfig.js";

/**
 * The options for the cosmos db entity storage connector constructor.
 */
export interface ICosmosDbEntityStorageConnectorConstructorOptions {
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
	config: ICosmosDbEntityStorageConnectorConfig;
}
