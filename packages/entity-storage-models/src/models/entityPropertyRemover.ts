// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IEntitySchemaProperty } from "@twin.org/entity";

/**
 * Type for the optional removeEntityProperty function.
 * Called during migration when properties are dropped, allowing callers to
 * observe which properties were removed and act on their values before they are lost.
 */
export type EntityPropertyRemover<T = unknown> = (
	entity: T,
	removedProperties: IEntitySchemaProperty<T>[]
) => void;
