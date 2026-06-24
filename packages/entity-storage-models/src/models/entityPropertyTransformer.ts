// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IEntitySchemaProperty } from "@twin.org/entity";

/**
 * Type for the optional transformEntityProperty function.
 * Used in migration steps for custom property transformations.
 */
export type EntityPropertyTransformer<T = unknown, U = unknown> = (
	schema1Property: IEntitySchemaProperty<T>,
	schemaProperty2: IEntitySchemaProperty<U>,
	value: unknown
) => unknown;
