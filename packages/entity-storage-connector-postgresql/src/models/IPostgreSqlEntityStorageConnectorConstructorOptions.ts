// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IPostgreSqlEntityStorageConnectorConfig } from "./IPostgreSqlEntityStorageConnectorConfig.js";

/**
 * The options for the PostgreSql entity storage connector constructor.
 */
export interface IPostgreSqlEntityStorageConnectorConstructorOptions {
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
	config: IPostgreSqlEntityStorageConnectorConfig;
}
