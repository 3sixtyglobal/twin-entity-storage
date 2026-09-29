// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { entity, property } from "@twin.org/entity";

/**
 * Tracks the currently applied schema version for each managed entity schema.
 * One record per schema name. Written once on first boot, then updated after
 * each successful migration.
 */
@entity()
export class SchemaVersion {
	/**
	 * The entity schema type name - primary key.
	 */
	@property({ type: "string", isPrimary: true, maxLength: 255 })
	public schemaName!: string;

	/**
	 * The currently deployed version of this schema.
	 */
	@property({ type: "integer" })
	public version!: number;

	/**
	 * ISO 8601 timestamp of the last version write.
	 */
	@property({ type: "string", format: "date-time" })
	public updatedAt!: string;
}
