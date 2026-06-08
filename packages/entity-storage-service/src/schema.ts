// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { EntitySchemaFactory, EntitySchemaHelper } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { SchemaVersion } from "./entities/schemaVersion.js";

/**
 * Initialize the schema for the entity storage.
 */
export function initSchema(): void {
	EntitySchemaFactory.register(nameof<SchemaVersion>(), () =>
		EntitySchemaHelper.getSchema(SchemaVersion)
	);
}
