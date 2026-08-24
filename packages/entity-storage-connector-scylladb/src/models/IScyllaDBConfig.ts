// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * ScyllaDB Configuration.
 */
export interface IScyllaDBConfig {
	/**
	 * The host to contact to.
	 */
	hosts: string[];

	/**
	 * The local data center.
	 */
	localDataCenter: string;

	/**
	 * The keyspace to use.
	 */
	keyspace: string;

	/**
	 * The port to connect to.
	 * @default 9042
	 */
	port?: number;

	/**
	 * Optional connection pool configuration.
	 */
	pool?: {
		/**
		 * Number of connections per local host.
		 * @default 1
		 */
		coreConnectionsPerHost?: number;

		/**
		 * Maximum number of requests per connection.
		 * @default 1024
		 */
		maxRequestsPerConnection?: number;
	};

	/**
	 * Milliseconds to wait for connector mutex locks before throwing.
	 */
	mutexTimeoutMs?: number;
}
