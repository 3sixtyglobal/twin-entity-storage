// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { ISchemaVersionServiceConfig } from "./ISchemaVersionServiceConfig.js";

/**
 * Constructor options for SchemaVersionService.
 */
export interface ISchemaVersionServiceConstructorOptions {
	/**
	 * The version storage type.
	 * @default schema-version
	 */
	schemaVersionStorageType?: string;

	/**
	 * Optional config.
	 */
	config?: ISchemaVersionServiceConfig;
}
