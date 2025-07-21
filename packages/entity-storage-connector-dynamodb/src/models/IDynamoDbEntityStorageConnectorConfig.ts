// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Configuration for the Dynamo DB Entity Storage Connector.
 */
export interface IDynamoDbEntityStorageConnectorConfig {
	/**
	 * The region for the AWS connection.
	 */
	region: string;

	/**
	 * The AWS access key.
	 */
	accessKeyId: string;

	/**
	 * The AWS secret access key.
	 */
	secretAccessKey: string;

	/**
	 * The name of the table for the storage.
	 */
	tableName: string;

	/**
	 * AWS endpoint, not usually required but could be used for local DynamoDB instance e.g. http://localhost:8500.
	 */
	endpoint?: string;
}
