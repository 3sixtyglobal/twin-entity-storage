// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import path from "node:path";
import { Guards } from "@twin.org/core";
import * as dotenv from "dotenv";
import type { IScyllaDBTableConfig } from "../src/models/IScyllaDBTableConfig";

dotenv.config({ path: [path.join(__dirname, ".env"), path.join(__dirname, ".env.dev")] });

console.debug("Setting up test environment from .env and .env.dev files");

Guards.stringValue("TestEnv", "TEST_SCYLLA_TABLE", process.env.TEST_SCYLLA_TABLE);
Guards.stringValue("TestEnv", "TEST_SCYLLA_HOSTS", process.env.TEST_SCYLLA_HOSTS);
Guards.stringValue("TestEnv", "TEST_SCYLLA_DATA_CENTER", process.env.TEST_SCYLLA_DATA_CENTER);
Guards.stringValue("TestEnv", "TEST_SCYLLA_KEYSPACE", process.env.TEST_SCYLLA_KEYSPACE);
Guards.stringValue("TestEnv", "TEST_SCYLLA_PORT", process.env.TEST_SCYLLA_PORT);

export const TEST_SCYLLA_CONFIG: IScyllaDBTableConfig = {
	tableName: process.env.TEST_SCYLLA_TABLE,
	hosts: process.env.TEST_SCYLLA_HOSTS.split(","),
	localDataCenter: process.env.TEST_SCYLLA_DATA_CENTER,
	keyspace: process.env.TEST_SCYLLA_KEYSPACE,
	port: Number.parseInt(process.env.TEST_SCYLLA_PORT, 10)
};
