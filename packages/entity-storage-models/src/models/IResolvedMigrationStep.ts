// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IEntitySchemaProperty } from "@twin.org/entity";
import type { IMigrationOptions } from "./IMigrationOptions.js";

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
	 * Optional per-property transformer for object/array properties that the structural
	 * diff cannot handle automatically. Sourced from an ISchemaMigration override when
	 * one is registered in SchemaMigrationFactory for this step.
	 */
	transformEntityProperty?: IMigrationOptions<T, U>["transformEntityProperty"];
}
