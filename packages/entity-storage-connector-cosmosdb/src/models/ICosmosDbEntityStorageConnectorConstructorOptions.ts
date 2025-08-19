// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { ICosmosDbEntityStorageConnectorConfig } from "./ICosmosDbEntityStorageConnectorConfig";

/**
 * The options for the cosmos db entity storage connector constructor.
 */
export interface ICosmosDbEntityStorageConnectorConstructorOptions {
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
	config: ICosmosDbEntityStorageConnectorConfig;
}
