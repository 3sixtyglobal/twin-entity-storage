# Class: SchemaVersion

Tracks the currently applied schema version for each managed entity schema.
One record per schema name. Written once on first boot, then updated after
each successful migration.

## Constructors

### Constructor

> **new SchemaVersion**(): `SchemaVersion`

#### Returns

`SchemaVersion`

## Properties

### schemaName {#schemaname}

> **schemaName**: `string`

The entity schema type name - primary key.

***

### version {#version}

> **version**: `number`

The currently deployed version of this schema.

***

### updatedAt {#updatedat}

> **updatedAt**: `string`

ISO 8601 timestamp of the last version write.
