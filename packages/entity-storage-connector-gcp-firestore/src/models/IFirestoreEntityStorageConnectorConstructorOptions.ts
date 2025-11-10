// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IFirestoreEntityStorageConnectorConfig } from "./IFirestoreEntityStorageConnectorConfig.js";

/**
 * Options for the Firestore Entity Storage Connector constructor.
 */
export interface IFirestoreEntityStorageConnectorConstructorOptions {
	/**
	 * The schema for the entity.
	 */
	entitySchema: string;

	/**
	 * The keys to use from the context ids to create partitions.
	 */
	partitionContextIds?: string[];

	/**
	 * The type of logging component to use, defaults to no logging.
	 */
	loggingComponentType?: string;

	/**
	 * The configuration for the connector.
	 */
	config: IFirestoreEntityStorageConnectorConfig;
}
