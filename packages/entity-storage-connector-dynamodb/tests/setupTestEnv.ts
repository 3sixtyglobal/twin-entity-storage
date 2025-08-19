// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import path from "node:path";
import { Guards } from "@twin.org/core";
import * as dotenv from "dotenv";
import type { IDynamoDbEntityStorageConnectorConfig } from "../src/models/IDynamoDbEntityStorageConnectorConfig";

dotenv.config({
	path: [path.join(__dirname, ".env"), path.join(__dirname, ".env.dev")],
	quiet: true
});

console.debug("Setting up test environment from .env and .env.dev files");

Guards.stringValue("TestEnv", "TEST_DYNAMODB_REGION", process.env.TEST_DYNAMODB_REGION);
Guards.stringValue(
	"TestEnv",
	"TEST_DYNAMODB_ACCESS_KEY_ID",
	process.env.TEST_DYNAMODB_ACCESS_KEY_ID
);
Guards.stringValue(
	"TestEnv",
	"TEST_DYNAMODB_SECRET_ACCESS_KEY",
	process.env.TEST_DYNAMODB_SECRET_ACCESS_KEY
);
Guards.stringValue("TestEnv", "TEST_DYNAMODB_TABLE_NAME", process.env.TEST_DYNAMODB_TABLE_NAME);
Guards.stringValue("TestEnv", "TEST_DYNAMODB_ENDPOINT", process.env.TEST_DYNAMODB_ENDPOINT);

export const TEST_DYNAMODB_CONFIG: IDynamoDbEntityStorageConnectorConfig = {
	region: process.env.TEST_DYNAMODB_REGION,
	accessKeyId: process.env.TEST_DYNAMODB_ACCESS_KEY_ID,
	secretAccessKey: process.env.TEST_DYNAMODB_SECRET_ACCESS_KEY,
	tableName: process.env.TEST_DYNAMODB_TABLE_NAME,
	endpoint: process.env.TEST_DYNAMODB_ENDPOINT
};
