// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import path from "node:path";
import { Guards } from "@3sixty/core";
import * as dotenv from "dotenv";
import type { IPostgreSqlEntityStorageConnectorConfig } from "../src/models/IPostgreSqlEntityStorageConnectorConfig.js";

dotenv.config({
	path: [path.join(__dirname, ".env.dev"), path.join(__dirname, ".env")],
	quiet: true
});

console.debug("Setting up test environment from .env and .env.dev files");

Guards.stringValue("TestEnv", "TEST_POSTGRESQL_HOST", process.env.TEST_POSTGRESQL_HOST);
Guards.stringValue("TestEnv", "TEST_POSTGRESQL_PORT", process.env.TEST_POSTGRESQL_PORT);
Guards.stringValue("TestEnv", "TEST_POSTGRESQL_USER", process.env.TEST_POSTGRESQL_USER);
Guards.stringValue("TestEnv", "TEST_POSTGRESQL_PASSWORD", process.env.TEST_POSTGRESQL_PASSWORD);
Guards.stringValue("TestEnv", "TEST_POSTGRESQL_DATABASE", process.env.TEST_POSTGRESQL_DATABASE);
Guards.stringValue("TestEnv", "TEST_POSTGRESQL_TABLE", process.env.TEST_POSTGRESQL_TABLE);

export const TEST_POSTGRESQL_CONFIG: IPostgreSqlEntityStorageConnectorConfig = {
	host: process.env.TEST_POSTGRESQL_HOST,
	port: Number.parseInt(process.env.TEST_POSTGRESQL_PORT, 10),
	user: process.env.TEST_POSTGRESQL_USER,
	password: process.env.TEST_POSTGRESQL_PASSWORD,
	database: process.env.TEST_POSTGRESQL_DATABASE,
	tableName: process.env.TEST_POSTGRESQL_TABLE
};
