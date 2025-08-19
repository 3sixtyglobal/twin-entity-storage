// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IPostgreSqlEntityStorageConnectorConfig } from "./IPostgreSqlEntityStorageConnectorConfig";

/**
 * The options for the PostgreSql entity storage connector constructor.
 */
export interface IPostgreSqlEntityStorageConnectorConstructorOptions {
	/**
	 * The schema for the entity.
	 */
	entitySchema: string;

	/**
	 * The type of logging component to use.
	 * @default logging
	 */
	loggingComponentType?: string;

	/**
	 * The configuration for the connector.
	 */
	config: IPostgreSqlEntityStorageConnectorConfig;
}
