// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import path from "node:path";
import { Coerce, Guards } from "@3sixty/core";
import * as dotenv from "dotenv";
import type { IMongoDbEntityStorageConnectorConfig } from "../src/models/IMongoDbEntityStorageConnectorConfig.js";

dotenv.config({
	path: [path.join(__dirname, ".env.dev"), path.join(__dirname, ".env")],
	quiet: true
});

console.debug("Setting up test environment from .env and .env.dev files");

Guards.stringValue("TestEnv", "TEST_MONGODB_ENDPOINT", process.env.TEST_MONGODB_ENDPOINT);
Guards.stringValue("TestEnv", "TEST_MONGODB_PORT", process.env.TEST_MONGODB_PORT);
Guards.stringValue("TestEnv", "TEST_MONGODB_DATABASE", process.env.TEST_MONGODB_DATABASE);
Guards.stringValue("TestEnv", "TEST_MONGODB_COLLECTION", process.env.TEST_MONGODB_COLLECTION);

export const TEST_MONGODB_CONFIG: IMongoDbEntityStorageConnectorConfig = {
	host: process.env.TEST_MONGODB_ENDPOINT,
	port: Coerce.number(process.env.TEST_MONGODB_PORT),
	database: process.env.TEST_MONGODB_DATABASE,
	collection: process.env.TEST_MONGODB_COLLECTION
};
