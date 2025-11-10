// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import path from "node:path";
import { Guards } from "@twin.org/core";
import * as dotenv from "dotenv";
import type { IMySqlEntityStorageConnectorConfig } from "../src/models/IMySqlEntityStorageConnectorConfig.js";

dotenv.config({
	path: [path.join(__dirname, ".env"), path.join(__dirname, ".env.dev")],
	quiet: true
});

console.debug("Setting up test environment from .env and .env.dev files");

Guards.stringValue("TestEnv", "TEST_MYSQL_HOST", process.env.TEST_MYSQL_HOST);
Guards.stringValue("TestEnv", "TEST_MYSQL_PORT", process.env.TEST_MYSQL_PORT);
Guards.stringValue("TestEnv", "TEST_MYSQL_USER", process.env.TEST_MYSQL_USER);
Guards.stringValue("TestEnv", "TEST_MYSQL_PASSWORD", process.env.TEST_MYSQL_PASSWORD);
Guards.stringValue("TestEnv", "TEST_MYSQL_DATABASE", process.env.TEST_MYSQL_DATABASE);
Guards.stringValue("TestEnv", "TEST_MYSQL_TABLE", process.env.TEST_MYSQL_TABLE);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export const TEST_MYSQL_CONFIG: IMySqlEntityStorageConnectorConfig = {
	host: process.env.TEST_MYSQL_HOST,
	port: Number.parseInt(process.env.TEST_MYSQL_PORT, 10),
	user: process.env.TEST_MYSQL_USER,
	password: process.env.TEST_MYSQL_PASSWORD,
	database: process.env.TEST_MYSQL_DATABASE,
	tableName: process.env.TEST_MYSQL_TABLE
};
