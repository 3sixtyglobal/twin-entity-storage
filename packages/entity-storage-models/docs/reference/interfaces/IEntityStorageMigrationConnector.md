# Interface: IEntityStorageMigrationConnector\<T\>

Interface describing an entity storage migration connector.

## Extends

- [`IEntityStorageConnector`](IEntityStorageConnector.md)\<`T`\>

## Type Parameters

### T

`T` = `unknown`

## Methods

### getSchema() {#getschema}

> **getSchema**(): `IEntitySchema`

Get the schema for the entities.

#### Returns

`IEntitySchema`

The schema for the entities.

#### Inherited from

[`IEntityStorageConnector`](IEntityStorageConnector.md).[`getSchema`](IEntityStorageConnector.md#getschema)

***

### set() {#set}

> **set**(`entity`, `conditions?`): `Promise`\<`void`\>

Set an entity.

#### Parameters

##### entity

`T`

The entity to set.

##### conditions?

`object`[]

The optional conditions to match for the entities.

#### Returns

`Promise`\<`void`\>

The id of the entity.

#### Throws

ConflictError when the entity exists but the supplied conditions or version do not match the stored state.

#### Inherited from

[`IEntityStorageConnector`](IEntityStorageConnector.md).[`set`](IEntityStorageConnector.md#set)

***

### setBatch() {#setbatch}

> **setBatch**(`entities`): `Promise`\<`void`\>

Set multiple entities in a batch.

#### Parameters

##### entities

`T`[]

The entities to set.

#### Returns

`Promise`\<`void`\>

Nothing.

#### Inherited from

[`IEntityStorageConnector`](IEntityStorageConnector.md).[`setBatch`](IEntityStorageConnector.md#setbatch)

***

### get() {#get}

> **get**(`id`, `secondaryIndex?`, `conditions?`): `Promise`\<`T` \| `undefined`\>

Get an entity.

#### Parameters

##### id

`string`

The id of the entity to get, or the index value if secondaryIndex is set.

##### secondaryIndex?

keyof `T`

Get the item using a secondary index.

##### conditions?

`object`[]

The optional conditions to match for the entities.

#### Returns

`Promise`\<`T` \| `undefined`\>

The object if it can be found or undefined.

#### Inherited from

[`IEntityStorageConnector`](IEntityStorageConnector.md).[`get`](IEntityStorageConnector.md#get)

***

### remove() {#remove}

> **remove**(`id`, `conditions?`): `Promise`\<`void`\>

Remove the entity.

#### Parameters

##### id

`string`

The id of the entity to remove.

##### conditions?

`object`[]

The optional conditions to match for the entities.

#### Returns

`Promise`\<`void`\>

Nothing.

#### Throws

ConflictError when the entity exists but the supplied conditions or version do not match the stored state.

#### Inherited from

[`IEntityStorageConnector`](IEntityStorageConnector.md).[`remove`](IEntityStorageConnector.md#remove)

***

### removeBatch() {#removebatch}

> **removeBatch**(`ids`): `Promise`\<`void`\>

Remove multiple entities by id.

#### Parameters

##### ids

`string`[]

The ids of the entities to remove.

#### Returns

`Promise`\<`void`\>

Nothing.

#### Inherited from

[`IEntityStorageConnector`](IEntityStorageConnector.md).[`removeBatch`](IEntityStorageConnector.md#removebatch)

***

### query() {#query}

> **query**(`conditions?`, `sortProperties?`, `properties?`, `cursor?`, `limit?`): `Promise`\<\{ `entities`: `Partial`\<`T`\>[]; `cursor?`: `string`; \}\>

Query all the entities which match the conditions.

#### Parameters

##### conditions?

`EntityCondition`\<`T`\>

The conditions to match for the entities.

##### sortProperties?

`object`[]

The optional sort order.

##### properties?

keyof `T`[]

The optional properties to return, defaults to all.

##### cursor?

`string`

The cursor to request the next chunk of entities.

##### limit?

`number`

The suggested number of entities to return in each chunk, in some scenarios can return a different amount.

#### Returns

`Promise`\<\{ `entities`: `Partial`\<`T`\>[]; `cursor?`: `string`; \}\>

All the entities for the storage matching the conditions,
and a cursor which can be used to request more entities.

#### Inherited from

[`IEntityStorageConnector`](IEntityStorageConnector.md).[`query`](IEntityStorageConnector.md#query)

***

### empty() {#empty}

> **empty**(): `Promise`\<`void`\>

Remove all entities from the storage.

#### Returns

`Promise`\<`void`\>

Nothing.

#### Inherited from

[`IEntityStorageConnector`](IEntityStorageConnector.md).[`empty`](IEntityStorageConnector.md#empty)

***

### count() {#count}

> **count**(`conditions?`): `Promise`\<`number`\>

Count all the entities which match the conditions.

#### Parameters

##### conditions?

`EntityCondition`\<`T`\>

The optional conditions to match for the entities.

#### Returns

`Promise`\<`number`\>

The total count of entities in the storage.

#### Inherited from

[`IEntityStorageConnector`](IEntityStorageConnector.md).[`count`](IEntityStorageConnector.md#count)

***

### connectorVersion() {#connectorversion}

> **connectorVersion**(): `number`

Get the current version of this connector's implementation.
Increment this when the connector's bootstrap logic changes in a way that
requires re-running bootstrap on existing tables (e.g. new index definitions).
SchemaVersionService detects a mismatch and calls bootstrap() again on start-up,
so the method must be idempotent (CREATE INDEX IF NOT EXISTS, ensureIndex, etc.).

#### Returns

`number`

The connector implementation version.

***

### getPartitionContextIds() {#getpartitioncontextids}

> **getPartitionContextIds**(`loggingComponentType?`): `Promise`\<`IContextIds`[] \| `undefined`\>

Get a unique list of all the context ids from the storage.
Returns undefined when the connector has no partition context ids configured
(run migration once with an empty context), or an empty array when the connector
is partitioned but the table contains no entities (skip migration entirely).
Partition ids whose depth does not match the configured partition context ids are
skipped and reported as a warning; entities in those partitions are ignored by migration.

#### Parameters

##### loggingComponentType?

`string`

The optional component type to use for logging skipped partition ids.

#### Returns

`Promise`\<`IContextIds`[] \| `undefined`\>

The list of unique context ids, undefined if not partitioned, or [] if partitioned but empty.

***

### createTargetConnector() {#createtargetconnector}

> **createTargetConnector**\<`U`\>(`newEntitySchema`): `Promise`\<[`IEntityStorageConnector`](IEntityStorageConnector.md)\<`U`\>\>

Create the target connector for performing the migration it will use a temporary storage location.

#### Type Parameters

##### U

`U`

#### Parameters

##### newEntitySchema

`string`

The name of the new entity schema to create the connector for.

#### Returns

`Promise`\<[`IEntityStorageConnector`](IEntityStorageConnector.md)\<`U`\>\>

Connector for performing the migration.

***

### finalizeMigration() {#finalizemigration}

> **finalizeMigration**\<`U`\>(`targetConnector`, `options?`, `loggingComponentType?`): `Promise`\<[`IEntityStorageConnector`](IEntityStorageConnector.md)\<`U`\>\>

Finalize the migration by tearing down the old connector and replacing it with the target connector.

#### Type Parameters

##### U

`U`

#### Parameters

##### targetConnector

[`IEntityStorageConnector`](IEntityStorageConnector.md)\<`U`\>

The target connector to finalize the migration with.

##### options?

[`IMigrationOptions`](IMigrationOptions.md)

The options to control how the migration is finalized.

##### loggingComponentType?

`string`

The optional component type to use for logging the migration progress.

#### Returns

`Promise`\<[`IEntityStorageConnector`](IEntityStorageConnector.md)\<`U`\>\>

A promise that resolves when the migration is finalized and returns the final connector.

***

### cleanupMigration() {#cleanupmigration}

> **cleanupMigration**\<`U`\>(`targetConnector`, `options?`, `loggingComponentType?`): `Promise`\<`void`\>

Cleanup the migration if a migration fails or needs to be aborted.

#### Type Parameters

##### U

`U`

#### Parameters

##### targetConnector

[`IEntityStorageConnector`](IEntityStorageConnector.md)\<`U`\> \| `undefined`

The target connector to cleanup the migration with.

##### options?

[`IMigrationOptions`](IMigrationOptions.md)

The options to control how the migration is cleaned up.

##### loggingComponentType?

`string`

The optional component type to use for logging the migration progress.

#### Returns

`Promise`\<`void`\>

A promise that resolves when the migration is cleaned up.
