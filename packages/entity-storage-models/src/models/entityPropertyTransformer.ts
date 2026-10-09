// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IEntitySchemaProperty } from "@3sixty/entity";

/**
 * Type for the optional transformEntityProperty function.
 * Used in migration steps for custom property transformations.
 */
export type EntityPropertyTransformer<T = unknown, U = unknown> = (
	entity: T,
	schema1Property: IEntitySchemaProperty<T>,
	schemaProperty2: IEntitySchemaProperty<U>,
	value: unknown
) => unknown | Promise<unknown>;
