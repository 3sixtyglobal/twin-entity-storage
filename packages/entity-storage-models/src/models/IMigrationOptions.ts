// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Options controlling how a schema migration is executed.
 */
export interface IMigrationOptions {
	/**
	 * Number of entities to read and write per batch.
	 * @default 100
	 */
	batchSize?: number;

	/**
	 * Called for progress tracking.
	 * @param progressItem The item progress being updated.
	 * @param itemTotal The total number of rows to migrate.
	 * @param itemIndex The number of rows migrated so far.
	 */
	onProgress?: (
		progressItem:
			| "partitionStart"
			| "partitionProgress"
			| "partitionEnd"
			| "partitionItemsStart"
			| "partitionItemsProgress"
			| "partitionItemsEnd",
		itemTotal: number,
		itemIndex: number
	) => Promise<void>;
}
