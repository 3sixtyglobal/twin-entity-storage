// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IScyllaDBTableConfig } from "./IScyllaDBTableConfig.js";

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
	 * The keys to use from the context ids to create partitions.
	 */
	partitionContextIds?: string[];

	/**
	 * The configuration for the connector.
	 */
	config: IScyllaDBTableConfig;
}
