# Class: MigrationHelper

Helper class for performing schema migrations between two connectors.

## Constructors

### Constructor

> **new MigrationHelper**(): `MigrationHelper`

#### Returns

`MigrationHelper`

## Properties

### CLASS\_NAME {#class_name}

> `readonly` `static` **CLASS\_NAME**: `string`

Runtime name for the class.

## Methods

### migrate() {#migrate}

> `static` **migrate**\<`T`, `U`\>(`sourceConnector`, `targetEntitySchemaName`, `renames?`, `options?`, `loggingComponentType?`): `Promise`\<\{ `finalConnector?`: [`IEntityStorageConnector`](../interfaces/IEntityStorageConnector.md)\<`U`\>; `migrated`: `number`; \}\>

Performs a migration between two connectors, using the provided options and schema diff to control the migration behaviour.

#### Type Parameters

##### T

`T`

##### U

`U`

#### Parameters

##### sourceConnector

[`IEntityStorageMigrationConnector`](../interfaces/IEntityStorageMigrationConnector.md)\<`T`\>

The connector to migrate from to allow the migration helper to create the new connector and finalize the migration.

##### targetEntitySchemaName

`string`

The name of the new entity schema.

##### renames?

`object`[]

An optional list of property renames to apply during migration.

##### options?

[`IMigrationOptions`](../interfaces/IMigrationOptions.md)\<`T`, `U`\>

Options controlling migration behaviour.

##### loggingComponentType?

`string`

An optional logging component type to use for bootstrapping and starting connectors if necessary.

#### Returns

`Promise`\<\{ `finalConnector?`: [`IEntityStorageConnector`](../interfaces/IEntityStorageConnector.md)\<`U`\>; `migrated`: `number`; \}\>

The connector for the new schema and the number of entities successfully migrated, the sourceConnector will no longer be usable, finalConnector will be undefined if no migration was necessary.

***

### migrateEntities() {#migrateentities}

> `static` **migrateEntities**\<`T`, `U`\>(`source`, `target`, `partitionContextIds`, `schemaDiff`, `options?`): `Promise`\<`number`\>

Generic per-partition migration loop.

#### Type Parameters

##### T

`T` = `unknown`

##### U

`U` = `T`

#### Parameters

##### source

[`IEntityStorageMigrationConnector`](../interfaces/IEntityStorageMigrationConnector.md)\<`T`\>

Connector to read from (current schema, already bootstrapped).

##### target

[`IEntityStorageConnector`](../interfaces/IEntityStorageConnector.md)\<`U`\>

Connector to write to (new schema, already bootstrapped).

##### partitionContextIds

`IContextIds`[]

The context ids to use for the migration, used for partitioning and can be used in the transform function when `options.transformEntityProperty` is provided.

##### schemaDiff

`IEntitySchemaDiff`\<`T`, `U`\>

The schema diff.

##### options?

[`IMigrationOptions`](../interfaces/IMigrationOptions.md)\<`T`, `U`\>

Optional migration controls (batchSize, transformEntity, onProgress).

#### Returns

`Promise`\<`number`\>

The number of entities successfully migrated.

***

### migratePartition() {#migratepartition}

> `static` **migratePartition**\<`T`, `U`\>(`source`, `target`, `partitionTotal`, `partitionIndex`, `schemaDiff`, `options?`): `Promise`\<`number`\>

Generic per-partition migration loop.

#### Type Parameters

##### T

`T` = `unknown`

##### U

`U` = `unknown`

#### Parameters

##### source

[`IEntityStorageConnector`](../interfaces/IEntityStorageConnector.md)\<`T`\>

Connector to read from (current schema, already bootstrapped).

##### target

[`IEntityStorageConnector`](../interfaces/IEntityStorageConnector.md)\<`U`\>

Connector to write to (new schema, already bootstrapped).

##### partitionTotal

`number`

The total number of partitions to migrate, used for progress reporting.

##### partitionIndex

`number`

The index of the current partition being migrated, used for progress reporting.

##### schemaDiff

`IEntitySchemaDiff`\<`T`, `U`\>

Schema diff used to add nullable defaults and drop removed fields when `options.transformEntity` is not provided.

##### options?

[`IMigrationOptions`](../interfaces/IMigrationOptions.md)\<`T`, `U`\>

Optional migration controls (batchSize, transformEntity, onProgress).

#### Returns

`Promise`\<`number`\>

The number of entities successfully migrated.

***

### applyEntityTransform() {#applyentitytransform}

> `static` **applyEntityTransform**\<`T`, `U`\>(`entity`, `schemaDiff`, `options?`): `U`

Applies the entity transformation for migration, using the provided options and schema diff.

#### Type Parameters

##### T

`T` = `unknown`

##### U

`U` = `unknown`

#### Parameters

##### entity

`Partial`\<`T`\>

The entity to transform.

##### schemaDiff

`IEntitySchemaDiff`\<`T`, `U`\>

The schema diff between the old and new schemas.

##### options?

[`IMigrationOptions`](../interfaces/IMigrationOptions.md)\<`T`, `U`\>

The migration options.

#### Returns

`U`

The transformed entity ready to be written to the new schema.

#### Throws

GeneralError if a transformation is required for an object or array property but no `options.transformEntityProperty` function is provided.

#### Throws

GeneralError if coercion of a modified property results in undefined for a non-optional target property.
