# Class: SchemaVersion

Entity that records the currently applied schema version for a managed entity schema.
Persisted through a normal entity-storage connector, giving every backend a schemaVersion
table/collection for free.

SchemaVersionService processes this schema first before all others so that the version
store is fully migrated before any version records are written for other schemas.

## Constructors

### Constructor

> **new SchemaVersion**(): `SchemaVersion`

#### Returns

`SchemaVersion`

## Properties

### schemaName {#schemaname}

> **schemaName**: `string`

The schema type name (matches the key used in EntitySchemaFactory).

***

### version {#version}

> **version**: `number`

The version currently applied in storage for this schema.

***

### updatedAt {#updatedat}

> **updatedAt**: `string`

ISO 8601 timestamp of the last version write.
