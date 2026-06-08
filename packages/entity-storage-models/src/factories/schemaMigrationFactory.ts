// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { Factory } from "@twin.org/core";
import type { ISchemaMigration } from "../models/ISchemaMigration.js";

/**
 * Factory for optional per-step migration overrides.
 *
 * Only register an entry when a version step requires property renames or a custom
 * transform hook. For purely structural changes (add/remove/type-change) the
 * SchemaVersionService diffs the two versioned schema classes automatically
 * without needing any factory entry.
 *
 * Keys follow the convention "<BaseSchemaName>_<fromVersion>_<toVersion>",
 * for example "MyEntity_0_1" for the step that migrates MyEntity from version 0 to 1.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const SchemaMigrationFactory = Factory.createFactory<ISchemaMigration>("schema-migration");
