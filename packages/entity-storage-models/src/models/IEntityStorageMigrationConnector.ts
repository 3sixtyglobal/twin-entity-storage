// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IContextIds } from "@twin.org/context";
import type { IEntityStorageConnector } from "./IEntityStorageConnector.js";
import type { IMigrationOptions } from "./IMigrationOptions.js";

/**
 * Interface describing an entity storage migration connector.
 */
export interface IEntityStorageMigrationConnector<T = unknown> extends IEntityStorageConnector<T> {
	/**
	 * Get the current version of this connector's implementation.
	 * Increment this when the connector's bootstrap logic changes in a way that
	 * requires re-running bootstrap on existing tables (e.g. new index definitions).
	 * SchemaVersionService detects a mismatch and calls bootstrap() again on start-up,
	 * so the method must be idempotent (CREATE INDEX IF NOT EXISTS, ensureIndex, etc.).
	 * @returns The connector implementation version.
	 */
	connectorVersion(): number;

	/**
	 * Get a unique list of all the context ids from the storage.
	 * Returns undefined when the connector has no partition context ids configured
	 * (run migration once with an empty context), or an empty array when the connector
	 * is partitioned but the table contains no entities (skip migration entirely).
	 * Partition ids whose depth does not match the configured partition context ids are
	 * skipped and reported as a warning; entities in those partitions are ignored by migration.
	 * @param loggingComponentType The optional component type to use for logging skipped partition ids.
	 * @returns The list of unique context ids, undefined if not partitioned, or [] if partitioned but empty.
	 */
	getPartitionContextIds(loggingComponentType?: string): Promise<IContextIds[] | undefined>;

	/**
	 * Create the target connector for performing the migration it will use a temporary storage location.
	 * @param newEntitySchema The name of the new entity schema to create the connector for.
	 * @returns Connector for performing the migration.
	 */
	createTargetConnector<U>(newEntitySchema: string): Promise<IEntityStorageConnector<U>>;

	/**
	 * Finalize the migration by tearing down the old connector and replacing it with the target connector.
	 * @param targetConnector The target connector to finalize the migration with.
	 * @param options The options to control how the migration is finalized.
	 * @param loggingComponentType The optional component type to use for logging the migration progress.
	 * @returns A promise that resolves when the migration is finalized and returns the final connector.
	 */
	finalizeMigration<U>(
		targetConnector: IEntityStorageConnector<U>,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<IEntityStorageConnector<U>>;

	/**
	 * Cleanup the migration if a migration fails or needs to be aborted.
	 * @param targetConnector The target connector to cleanup the migration with.
	 * @param options The options to control how the migration is cleaned up.
	 * @param loggingComponentType The optional component type to use for logging the migration progress.
	 * @returns A promise that resolves when the migration is cleaned up.
	 */
	cleanupMigration<U>(
		targetConnector: IEntityStorageConnector<U> | undefined,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<void>;
}
