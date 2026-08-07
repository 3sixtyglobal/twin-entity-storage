# Class: SchemaVersionService

Service that checks and applies entity schema migrations at every node start-up.

This service must be the first entry in coreTypeInitialisers.json. The engine iterates that
array in order to determine start sequence - there is no engine-level priority mechanism, so
registration position is the only guarantee that start() runs before any other service.
By the time start() is called, all component bootstraps have completed (every table already
exists) and EntitySchemaFactory / EntityStorageConnectorFactory are fully populated with every
registered schema and connector.

Migration mechanics: old schema versions are registered in EntitySchemaFactory by naming
convention - current schema = "MyEntity", first history = "MyEntityV0", second = "MyEntityV1".
The service groups schemas by base name (strips the trailing V number suffix) and resolves the
migration chain automatically by diffing consecutive versioned schemas. For steps that require
property renames or a custom transform hook, register an optional ISchemaMigration entry in
SchemaMigrationFactory under the key "Base_from_to" (e.g. "MyEntity_0_1").

Crash-window note: finalizeMigration and the subsequent version-record write are two
separate operations. If the process dies between them the next boot re-runs the chain
over already-migrated data. applyEntityTransform is NOT idempotent for structural changes
(newly-added optional fields would be dropped on re-run). A transaction spanning both
writes is a precondition for production; track this in the concurrency follow-up.

## Implements

- `IComponent`

## Constructors

### Constructor

> **new SchemaVersionService**(`options?`): `SchemaVersionService`

Create a new SchemaVersionService.

#### Parameters

##### options?

[`ISchemaVersionServiceConstructorOptions`](../interfaces/ISchemaVersionServiceConstructorOptions.md)

Optional constructor options.

#### Returns

`SchemaVersionService`

## Properties

### CLASS\_NAME {#class_name}

> `readonly` `static` **CLASS\_NAME**: `string`

Runtime name for the class.

## Methods

### className() {#classname}

> **className**(): `string`

Returns the class name.

#### Returns

`string`

The class name.

#### Implementation of

`IComponent.className`

***

### start() {#start}

> **start**(`nodeLoggingComponentType?`): `Promise`\<`void`\>

Reads all registered entity schemas, groups versioned schemas by base name, reads the
full schemaVersion table in one pass, then orchestrates chain migrations for any schema
whose stored version is behind the current version declared in EntitySchemaFactory.
SchemaVersion itself is processed first so the version store is migrated before any
version records are written for other schemas.

Runs after all component bootstraps, so every managed table already exists.

#### Parameters

##### nodeLoggingComponentType?

`string`

An optional logging component type.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`IComponent.start`
