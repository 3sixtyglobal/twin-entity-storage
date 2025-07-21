// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { ISynchronisedEntityStorageConnectorConfig } from "./ISynchronisedEntityStorageConnectorConfig";

/**
 * Options for the Synchronised Entity Storage Connector constructor.
 */
export interface ISynchronisedEntityStorageConnectorConstructorOptions {
	/**
	 * The name of the entity schema.
	 */
	entitySchema: string;

	/**
	 * The entity storage connector type to use for actual data.
	 */
	entityStorageConnectorType: string;

	/**
	 * The event bus component type.
	 * @default event-bus
	 */
	eventBusComponentType?: string;

	/**
	 * The configuration for the connector.
	 */
	config?: ISynchronisedEntityStorageConnectorConfig;
}
