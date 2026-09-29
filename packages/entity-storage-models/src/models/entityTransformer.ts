// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/**
 * Type for the optional transformEntity function.
 * Transforms a whole entity before a migration step diffs it, so a step can supply
 * values the source shape does not carry. Receives and returns the entity in the
 * step's source shape.
 */
export type EntityTransformer<T = unknown> = (entity: T) => T | Promise<T>;
