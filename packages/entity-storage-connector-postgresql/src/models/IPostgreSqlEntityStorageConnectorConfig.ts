// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Configuration for the PostgreSql Entity Storage Connector.
 */
export interface IPostgreSqlEntityStorageConnectorConfig {
	/**
	 * The host for the PostgreSql instance.
	 */
	host: string;

	/**
	 * The port for the PostgreSql instance.
	 */
	port?: number;

	/**
	 * The user for the PostgreSql instance.
	 */
	user: string;

	/**
	 * The password for the PostgreSql instance.
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
	 * Milliseconds to wait for connector mutex locks before throwing.
	 */
	mutexTimeoutMs?: number;
}
