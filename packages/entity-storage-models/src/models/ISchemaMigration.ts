// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { EntityPropertyRemover } from "./entityPropertyRemover.js";
import type { EntityPropertyTransformer } from "./entityPropertyTransformer.js";

/**
 * Optional per-step override for a single version-to-version migration.
 * Only register an entry in SchemaMigrationFactory when a step requires property
 * renames or a custom object/array transform. For purely structural changes
 * (add/remove/type-change fields) no entry is needed - the runner diffs the two
 * versioned schema classes (e.g. MyEntityV0 vs MyEntityV1) from EntitySchemaFactory
 * automatically.
 *
 * Register under the key "BaseSchemaName_fromVersion_toVersion"
 * e.g. "MyEntity_0_1" for the step that migrates from version 0 to version 1.
 * The key itself encodes the version pair; no version field is needed on the object.
 */
export interface ISchemaMigration<T = unknown, U = unknown> {
	/**
	 * Optional property renames to apply during this step.
	 */
	renames?: { from: string; to: string }[];

	/**
	 * Optional transformation for properties, usually only called for object and array types.
	 * @param entity The original entity before transformation.
	 * @param schema1Property The property schema in the old schema.
	 * @param schemaProperty2 The property schema in the new schema.
	 * @param value The value of the property in the old schema.
	 * @returns The transformed value to match the new schema.
	 */
	transformEntityProperty?: EntityPropertyTransformer<T, U>;

	/**
	 * Optional hook called when properties are dropped during migration.
	 * Receives the original entity and the list of removed property schemas,
	 * allowing callers to observe or record values before they are discarded.
	 * @param entity The original entity before transformation.
	 * @param removedProperties The property schemas that were dropped.
	 */
	removeEntityProperty?: EntityPropertyRemover<T>;
}
