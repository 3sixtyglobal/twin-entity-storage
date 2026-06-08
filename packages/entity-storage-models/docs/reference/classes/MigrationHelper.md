# Class: MigrationHelper

Helper class for performing entity schema migrations between two connectors.
The chain-based API (migrateWithChain / applyEntityChain) is the single migration
path: a chain of one step covers the same case as a traditional single-step migration.

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

### applyEntityTransform() {#applyentitytransform}

> `static` **applyEntityTransform**\<`T`, `U`\>(`entity`, `schemaDiff`, `transformEntityProperty?`): `U`

Applies the entity transformation for a single diff, handling added, removed, and
modified properties according to the provided schema diff and optional transform hook.

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

##### transformEntityProperty?

(`schema1Property`, `schemaProperty2`, `value`) => `unknown`

Optional per-property transform hook for object/array properties.

#### Returns

`U`

The transformed entity ready to be written to the new schema.

#### Throws

GeneralError if a transformation is required for an object or array property but no transformEntityProperty function is provided.

#### Throws

GeneralError if coercion of a modified property results in undefined for a non-optional target property.

***

### applyEntityChain() {#applyentitychain}

> `static` **applyEntityChain**(`entity`, `steps`): `unknown`

Transforms a single entity through an ordered chain of fully-resolved migration steps.
For each step the method diffs fromProperties against toProperties, then applies
applyEntityTransform. Each step's output feeds the next step's input so that
per-step transformEntityProperty hooks are honoured throughout the chain.

#### Parameters

##### entity

`unknown`

The entity to transform (at the shape described by steps[0].fromProperties).

##### steps

[`IResolvedMigrationStep`](../interfaces/IResolvedMigrationStep.md)\<`unknown`, `unknown`\>[]

Ordered, fully-resolved migration steps from stored version to current version.
Each step's fromProperties and toProperties are resolved by the caller before invocation.

#### Returns

`unknown`

The entity transformed to the shape described by steps[last].toProperties.

***

### migrateWithChain() {#migratewithchain}

> `static` **migrateWithChain**(`sourceConnector`, `targetSchemaName`, `steps`, `loggingComponentType?`, `batchSize?`): `Promise`\<\{ `finalConnector`: [`IEntityStorageConnector`](../interfaces/IEntityStorageConnector.md); `migrated`: `number`; \}\>

Performs a chain migration in a single connector swap, regardless of how many version
steps the chain spans. Creates one target connector, reads all source entities, applies
applyEntityChain to each, writes them to the target, then finalizes the migration.
A chain of one step is equivalent to a traditional single-step migration.

#### Parameters

##### sourceConnector

[`IEntityStorageMigrationConnector`](../interfaces/IEntityStorageMigrationConnector.md)

The connector holding data at the stored schema version.

##### targetSchemaName

`string`

The schema name for the current version (used to create the target connector).

##### steps

[`IResolvedMigrationStep`](../interfaces/IResolvedMigrationStep.md)\<`unknown`, `unknown`\>[]

Ordered, fully-resolved migration steps from stored to current version.

##### loggingComponentType?

`string`

An optional logging component type for connector startup.

##### batchSize?

`number` = `100`

Number of entities to read and write per batch. Defaults to 100.

#### Returns

`Promise`\<\{ `finalConnector`: [`IEntityStorageConnector`](../interfaces/IEntityStorageConnector.md); `migrated`: `number`; \}\>

The finalized connector and the count of migrated entities.
