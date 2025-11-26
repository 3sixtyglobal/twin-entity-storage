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
	 * The authentication mode.
	 * - "credentials": Use access key ID and secret access key.
	 * - "pod": Use IAM role attached to the pod (e.g., in EKS).
	 * @default credentials
	 */
	authMode?: "credentials" | "pod";

	/**
	 * The AWS access key ID.
	 */
	accessKeyId?: string;

	/**
	 * The AWS secret access key.
	 */
	secretAccessKey?: string;

	/**
	 * The name of the table for the storage.
	 */
	tableName: string;

	/**
	 * AWS endpoint, not usually required but could be used for local DynamoDB instance e.g. http://localhost:10000.
	 */
	endpoint?: string;

	/**
	 * The connection timeout in milliseconds.
	 */
	connectionTimeoutMs?: number;
}
