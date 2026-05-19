// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

import type { IEntitySchemaProperty } from "@twin.org/entity";

/**
 * Options controlling how a schema migration is executed.
 */
export interface IMigrationOptions<T, U> {
	/**
	 * Number of entities to read and write per batch.
	 * @default 100
	 */
	batchSize?: number;

	/**
	 * Optional transformation for properties, usually only called for object and array types.
	 * @param schema1Property The property schema in the old schema.
	 * @param schemaProperty2 The property schema in the new schema.
	 * @param value The value of the property in the old schema.
	 * @returns The transformed value to match the new schema.
	 */
	transformEntityProperty?: (
		schema1Property: IEntitySchemaProperty<T>,
		schemaProperty2: IEntitySchemaProperty<U>,
		value: unknown
	) => unknown;

	/**
	 * Called for each partition for progress tracking.
	 * @param rowTotal The total number of rows to migrate.
	 * @param rowIndex The number of rows migrated so far.
	 */
	onPartitionProgress?: (rowTotal: number, rowIndex: number) => Promise<void>;

	/**
	 * Called for overall progress tracking.
	 * @param stepKey The key representing the current step in the migration.
	 * @param itemTotal The total number of items in this progress.
	 * @param itemIndex The number of items processed so far.
	 */
	onStepProgress?: (stepKey: string, itemTotal: number, itemIndex: number) => Promise<void>;
}
