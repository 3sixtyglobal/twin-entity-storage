// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Configuration for the Synchronised Entity Storage Connector.
 */
export interface ISynchronisedEntityStorageConnectorConfig {
	/**
	 * The storage key for the synchronised entity storage connector.
	 * Will default to kebab cased entity schema name.
	 */
	storageKey?: string;
}
