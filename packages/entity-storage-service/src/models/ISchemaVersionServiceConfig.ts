// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Constructor options config for SchemaVersionService.
 */
export interface ISchemaVersionServiceConfig {
	/**
	 * Whether schema migration is enabled. When false the service detects pending migrations
	 * and logs a warning for each lagging schema but does not apply any changes.
	 * @default true
	 */
	enabled?: boolean;

	/**
	 * The batch size for processing schema versions.
	 */
	batchSize?: number;
}
