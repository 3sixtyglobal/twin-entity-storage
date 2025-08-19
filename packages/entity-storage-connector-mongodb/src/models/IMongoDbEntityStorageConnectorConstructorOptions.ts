// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IMongoDbEntityStorageConnectorConfig } from "./IMongoDbEntityStorageConnectorConfig";

/**
 * The options for the MongoDb entity storage connector constructor.
 */
export interface IMongoDbEntityStorageConnectorConstructorOptions {
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
	config: IMongoDbEntityStorageConnectorConfig;
}
