// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IScyllaDBConfig } from "./IScyllaDBConfig.js";

/**
 * Definition of MySQL DB configuration.
 */
export interface IScyllaDBTableConfig extends IScyllaDBConfig {
	/**
	 * The name of the table for the storage.
	 * @default To the camel case of the entity name.
	 */
	tableName?: string;
}
