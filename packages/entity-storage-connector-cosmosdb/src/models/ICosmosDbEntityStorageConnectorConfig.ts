// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Configuration for the Cosmos DB Entity Storage Connector.
 */
export interface ICosmosDbEntityStorageConnectorConfig {
	/**
	 * The endpoint for the Cosmos DB instance.
	 */
	endpoint: string;

	/**
	 * The primary key for the Cosmos DB instance.
	 */
	key: string;

	/**
	 * The ID of the database to be used.
	 */
	databaseId: string;

	/**
	 * The ID of the container for the storage.
	 */
	containerId: string;

	/**
	 * The offer throughput for the container.
	 */
	offerThroughput?: number;
}
