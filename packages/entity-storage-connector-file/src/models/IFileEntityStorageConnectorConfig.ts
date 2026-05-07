// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Configuration for the File Entity Storage Connector.
 */
export interface IFileEntityStorageConnectorConfig {
	/**
	 * The directory to use for storage.
	 */
	directory: string;

	/**
	 * The number of free bytes below which the health check reports an error.
	 * Defaults to 100 MB.
	 */
	diskErrorThresholdBytes?: number;

	/**
	 * The number of free bytes below which the health check reports a warning.
	 * Defaults to 500 MB.
	 */
	diskWarningThresholdBytes?: number;
}
