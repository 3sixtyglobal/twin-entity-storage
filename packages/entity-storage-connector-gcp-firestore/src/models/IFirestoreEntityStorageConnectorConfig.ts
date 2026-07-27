// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Configuration for the Firestore Entity Storage Connector.
 */
export interface IFirestoreEntityStorageConnectorConfig {
	/**
	 * The GCP project ID.
	 */
	projectId: string;

	/**
	 * The database ID, if omitted default database will be used.
	 */
	databaseId?: string;

	/**
	 * The name of the collection for the storage.
	 */
	collectionName: string;

	/**
	 * The GCP credentials, a base64 encoded version of the JWTInput data type.
	 */
	credentials?: string;

	/**
	 * It's usually only used with an emulator (e.g., "localhost:8080").
	 */
	endpoint?: string;

	/**
	 * Optional settings for Firestore client initialization.
	 */
	settings?: {
		/**
		 * The maximum number of idle channels to keep open.
		 */
		maxIdleChannels?: number;

		/**
		 * The custom timeout for requests (in milliseconds).
		 */
		timeout?: number;
	};
}
