// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IEntitySchemaProperty } from "@3sixty/entity";
import type { EntityPropertyRemover } from "./entityPropertyRemover.js";
import type { EntityPropertyTransformer } from "./entityPropertyTransformer.js";
import type { EntityTransformer } from "./entityTransformer.js";

/**
 * A fully-resolved single migration step used by MigrationHelper.
 * The SchemaVersionService builds these by looking up versioned schema classes
 * from EntitySchemaFactory (e.g. MyEntityV0, MyEntityV1) before invoking the helper,
 * keeping factory knowledge out of the helper itself.
 * @template T The entity type. Defaults to `unknown`. Use a concrete entity type
 * when the step's source and target schemas are known at the call site.
 */
export interface IResolvedMigrationStep<T = unknown, U = unknown> {
	/**
	 * The property list of the entity at the start of this step (the "old" shape).
	 * Sourced from the versioned schema class registered in EntitySchemaFactory,
	 * e.g. EntitySchemaFactory.get("MyEntityV0").properties.
	 */
	fromProperties: IEntitySchemaProperty<T>[];

	/**
	 * The property list of the entity at the end of this step (the "new" shape).
	 * For the final step this is the live current schema's properties.
	 */
	toProperties: IEntitySchemaProperty<U>[];

	/**
	 * Optional property renames for this step, forwarded to EntitySchemaDiffHelper.diff.
	 */
	renames?: { from: string; to: string }[];

	/**
	 * Optional whole-entity transform applied to the source entity before the diff runs,
	 * so a step can supply a value for a property the source shape does not carry. Its output
	 * is the entity the diff and the other two hooks receive.
	 * @param entity The entity in the step's source shape.
	 * @returns The entity, still in the step's source shape.
	 */
	transformEntity?: EntityTransformer<T>;

	/**
	 * Optional transformation called for every modified property when supplied. Mandatory for
	 * object and array targets; scalar targets fall back to coercion when it returns undefined.
	 * @param schema1Property The property schema in the old schema.
	 * @param schemaProperty2 The property schema in the new schema.
	 * @param value The value of the property in the old schema.
	 * @returns The transformed value to match the new schema.
	 */
	transformEntityProperty?: EntityPropertyTransformer<T, U>;

	/**
	 * Optional hook called when properties are dropped during migration.
	 * Receives the entity and the list of removed property schemas, allowing callers to
	 * observe or record values before they are discarded.
	 * @param entity The entity being migrated, after transformEntity when one is set.
	 * @param removedProperties The property schemas that were dropped.
	 */
	removeEntityProperty?: EntityPropertyRemover<T>;
}
