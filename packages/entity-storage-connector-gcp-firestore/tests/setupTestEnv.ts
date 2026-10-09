// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import path from "node:path";
import { Coerce, Guards, Is } from "@3sixty/core";
import * as dotenv from "dotenv";
import type { IFirestoreEntityStorageConnectorConfig } from "../src/models/IFirestoreEntityStorageConnectorConfig.js";

dotenv.config({
	path: [path.join(__dirname, ".env.dev"), path.join(__dirname, ".env")],
	quiet: true
});

console.debug("Setting up test environment from .env and .env.dev files");

Guards.stringValue("TestEnv", "TEST_FIRESTORE_PROJECT_ID", process.env.TEST_FIRESTORE_PROJECT_ID);
Guards.stringValue(
	"TestEnv",
	"TEST_FIRESTORE_COLLECTION_NAME",
	process.env.TEST_FIRESTORE_COLLECTION_NAME
);
Guards.stringValue("TestEnv", "TEST_FIRESTORE_ENDPOINT", process.env.TEST_FIRESTORE_ENDPOINT);
Guards.stringValue(
	"TestEnv",
	"TEST_FIRESTORE_MAX_IDLE_CHANNELS",
	process.env.TEST_FIRESTORE_MAX_IDLE_CHANNELS
);
Guards.stringValue("TestEnv", "TEST_FIRESTORE_TIMEOUT", process.env.TEST_FIRESTORE_TIMEOUT);

export const TEST_FIRESTORE_CONFIG: IFirestoreEntityStorageConnectorConfig = {
	projectId: process.env.TEST_FIRESTORE_PROJECT_ID,
	collectionName: process.env.TEST_FIRESTORE_COLLECTION_NAME,
	endpoint: process.env.TEST_FIRESTORE_ENDPOINT,
	settings: {
		maxIdleChannels: Coerce.number(process.env.TEST_FIRESTORE_MAX_IDLE_CHANNELS),
		timeout: Coerce.number(process.env.TEST_FIRESTORE_TIMEOUT)
	},
	credentials: Is.stringValue(process.env.TEST_FIRESTORE_CREDENTIALS)
		? process.env.TEST_FIRESTORE_CREDENTIALS
		: undefined
};
