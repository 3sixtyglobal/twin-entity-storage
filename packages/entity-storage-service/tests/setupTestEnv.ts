// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import path from "node:path";
import { Guards } from "@twin.org/core";
import type { IMySqlEntityStorageConnectorConfig } from "@twin.org/entity-storage-connector-mysql";
import * as dotenv from "dotenv";

dotenv.config({
	path: [path.join(__dirname, ".env.dev"), path.join(__dirname, ".env")],
	quiet: true
});

console.debug("Setting up test environment from .env and .env.dev files");

Guards.stringValue("TestEnv", "TEST_MYSQL_HOST", process.env.TEST_MYSQL_HOST);
Guards.stringValue("TestEnv", "TEST_MYSQL_PORT", process.env.TEST_MYSQL_PORT);
Guards.stringValue("TestEnv", "TEST_MYSQL_USER", process.env.TEST_MYSQL_USER);
Guards.stringValue("TestEnv", "TEST_MYSQL_PASSWORD", process.env.TEST_MYSQL_PASSWORD);
Guards.stringValue("TestEnv", "TEST_MYSQL_DATABASE", process.env.TEST_MYSQL_DATABASE);
Guards.stringValue("TestEnv", "TEST_MYSQL_TABLE", process.env.TEST_MYSQL_TABLE);

export const TEST_MYSQL_CONFIG: IMySqlEntityStorageConnectorConfig = {
	host: process.env.TEST_MYSQL_HOST,
	port: Number.parseInt(process.env.TEST_MYSQL_PORT, 10),
	user: process.env.TEST_MYSQL_USER,
	password: process.env.TEST_MYSQL_PASSWORD,
	database: process.env.TEST_MYSQL_DATABASE,
	tableName: process.env.TEST_MYSQL_TABLE
};
