// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Configuration for the MySql Entity Storage Connector.
 */
export interface IMySqlEntityStorageConnectorConfig {
	/**
	 * The host for the MySql instance.
	 */
	host: string;

	/**
	 * The port for the MySql instance.
	 */
	port?: number;

	/**
	 * The user for the MySql instance.
	 */
	user: string;

	/**
	 * The password for the MySql instance.
	 */
	password: string;

	/**
	 * The name of the database to be used.
	 */
	database: string;

	/**
	 * The name of the table to be used.
	 */
	tableName: string;

	/**
	 * Optional connection pool configuration.
	 */
	pool?: {
		/**
		 * Maximum number of connections in pool.
		 * @default 10
		 */
		connectionLimit?: number;

		/**
		 * Maximum number of idle connections.
		 * @default 10
		 */
		maxIdle?: number;

		/**
		 * Time in ms before removing idle connection.
		 * @default 60000 (1 minute)
		 */
		idleTimeout?: number;

		/**
		 * Enable TCP keep-alive.
		 * @default true
		 */
		enableKeepAlive?: boolean;

		/**
		 * Wait for available connection when pool is full.
		 * @default true
		 */
		waitForConnections?: boolean;

		/**
		 * Maximum queued requests (0 = unlimited).
		 * @default 0
		 */
		queueLimit?: number;
	};

	/**
	 * Maximum milliseconds to wait for optimistic-lock mutexes before throwing.
	 */
	mutexTimeoutMs?: number;
}
