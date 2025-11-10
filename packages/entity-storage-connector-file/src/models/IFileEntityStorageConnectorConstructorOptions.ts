// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IFileEntityStorageConnectorConfig } from "./IFileEntityStorageConnectorConfig.js";

/**
 * Options for the File Entity Storage Connector constructor.
 */
export interface IFileEntityStorageConnectorConstructorOptions {
	/**
	 * The name of the entity schema.
	 */
	entitySchema: string;

	/**
	 * The keys to use from the context ids to create partitions.
	 */
	partitionContextIds?: string[];

	/**
	 * The configuration for the connector.
	 */
	config: IFileEntityStorageConnectorConfig;
}
