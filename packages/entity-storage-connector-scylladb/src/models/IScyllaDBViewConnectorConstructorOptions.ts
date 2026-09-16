// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IScyllaDBViewConfig } from "./IScyllaDBViewConfig.js";

/**
 * Options for the ScyllaDB View Connector constructor.
 */
export interface IScyllaDBViewConnectorConstructorOptions {
	/**
	 * The type of logging component to use, defaults to no logging.
	 */
	loggingComponentType?: string;

	/**
	 * The name of the base table entity schema.
	 */
	entitySchema: string;

	/**
	 * The keys to use from the context ids to create partitions.
	 */
	partitionContextIds?: string[];

	/**
	 * The name of the view schema, a subset of the base entity properties whose isPrimary property keys the view.
	 */
	viewSchema: string;

	/**
	 * The configuration for the connector.
	 */
	config: IScyllaDBViewConfig;
}
