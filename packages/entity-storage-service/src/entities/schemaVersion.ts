// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { entity, property, EntitySchemaPropertyFormat } from "@twin.org/entity";

/**
 * Entity that records the currently applied schema version for a managed entity schema.
 * Persisted through a normal entity-storage connector, giving every backend a schemaVersion
 * table/collection for free.
 *
 * SchemaVersionService processes this schema first before all others so that the version
 * store is fully migrated before any version records are written for other schemas.
 */
@entity()
export class SchemaVersion {
	/**
	 * The schema type name (matches the key used in EntitySchemaFactory).
	 */
	@property({ type: "string", isPrimary: true })
	public schemaName!: string;

	/**
	 * The version currently applied in storage for this schema.
	 */
	@property({ type: "integer" })
	public version!: number;

	/**
	 * ISO 8601 timestamp of the last version write.
	 */
	@property({ type: "string", format: EntitySchemaPropertyFormat.DateTime })
	public updatedAt!: string;
}
