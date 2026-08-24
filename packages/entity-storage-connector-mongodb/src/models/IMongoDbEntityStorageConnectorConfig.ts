// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Configuration for the MongoDb Entity Storage Connector.
 */
export interface IMongoDbEntityStorageConnectorConfig {
	/**
	 * The host for the MongoDb instance.
	 */
	host: string;

	/**
	 * The port for the MongoDb instance.
	 */
	port?: number;

	/**
	 * The user for the MongoDb instance.
	 */
	user?: string;

	/**
	 * The password for the MongoDb instance.
	 */
	password?: string;

	/**
	 * The name of the database to be used.
	 */
	database: string;

	/**
	 * The name of the collection to be used.
	 */
	collection: string;

	/**
	 * Optional connection pool configuration.
	 */
	pool?: {
		/**
		 * Maximum number of connections in the pool.
		 * @default 100
		 */
		maxPoolSize?: number;

		/**
		 * Minimum number of connections to maintain in the pool.
		 * @default 0
		 */
		minPoolSize?: number;

		/**
		 * Milliseconds a connection can remain idle before being removed.
		 */
		maxIdleTimeMs?: number;

		/**
		 * Milliseconds to wait for a connection before throwing.
		 */
		waitQueueTimeoutMs?: number;
	};

	/**
	 * Milliseconds to wait for connector mutex locks before throwing.
	 */
	mutexTimeoutMs?: number;
}
