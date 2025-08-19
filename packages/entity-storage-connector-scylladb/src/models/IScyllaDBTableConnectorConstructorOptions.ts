// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IScyllaDBTableConfig } from "./IScyllaDBTableConfig";

/**
 * Options for the ScyllaDB Table Connector constructor.
 */
export interface IScyllaDBTableConnectorConstructorOptions {
	/**
	 * The type of logging component to use, defaults to no logging.
	 */
	loggingComponentType?: string;

	/**
	 * The name of the entity schema.
	 */
	entitySchema: string;

	/**
	 * The configuration for the connector.
	 */
	config: IScyllaDBTableConfig;
}
