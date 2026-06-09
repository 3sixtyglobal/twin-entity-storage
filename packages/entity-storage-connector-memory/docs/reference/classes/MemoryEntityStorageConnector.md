# Class: MemoryEntityStorageConnector\<T\>

Class for performing entity storage operations in-memory.

## Type Parameters

### T

`T` = `unknown`

## Implements

- `IEntityStorageConnector`\<`T`\>
- `IEntityStorageMigrationConnector`\<`T`\>

## Constructors

### Constructor

> **new MemoryEntityStorageConnector**\<`T`\>(`options`): `MemoryEntityStorageConnector`\<`T`\>

Create a new instance of MemoryEntityStorageConnector.

#### Parameters

##### options

[`IMemoryEntityStorageConnectorConstructorOptions`](../interfaces/IMemoryEntityStorageConnectorConstructorOptions.md)

The options for the connector.

#### Returns

`MemoryEntityStorageConnector`\<`T`\>

## Properties

### CLASS\_NAME {#class_name}

> `readonly` `static` **CLASS\_NAME**: `string`

Runtime name for the class.

## Methods

### className() {#classname}

> **className**(): `string`

Returns the class name of the component.

#### Returns

`string`

The class name of the component.

#### Implementation of

`IEntityStorageConnector.className`

***

### health() {#health}

> **health**(): `Promise`\<`IHealth`[]\>

Returns the health status of the component.

#### Returns

`Promise`\<`IHealth`[]\>

The health status of the component.

#### Implementation of

`IEntityStorageConnector.health`

***

### getSchema() {#getschema}

> **getSchema**(): `IEntitySchema`

Get the schema for the entities.

#### Returns

`IEntitySchema`

The schema for the entities.

#### Implementation of

`IEntityStorageConnector.getSchema`

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

#### Implementation of

`IEntityStorageConnector.get`

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

#### Implementation of

`IEntityStorageConnector.set`

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

#### Implementation of

`IEntityStorageConnector.setBatch`

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

#### Implementation of

`IEntityStorageConnector.remove`

***

### query() {#query}

> **query**(`conditions?`, `sortProperties?`, `properties?`, `cursor?`, `limit?`): `Promise`\<\{ `entities`: `Partial`\<`T`\>[]; `cursor?`: `string`; \}\>

Find all the entities which match the conditions.

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

#### Implementation of

`IEntityStorageConnector.query`

***

### empty() {#empty}

> **empty**(): `Promise`\<`void`\>

Remove all entities from the storage.

#### Returns

`Promise`\<`void`\>

Nothing.

#### Implementation of

`IEntityStorageConnector.empty`

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

#### Implementation of

`IEntityStorageConnector.removeBatch`

***

### teardown() {#teardown}

> **teardown**(`nodeLoggingComponentType?`): `Promise`\<`boolean`\>

Teardown the storage by clearing the underlying store.

#### Parameters

##### nodeLoggingComponentType?

`string`

The node logging component type.

#### Returns

`Promise`\<`boolean`\>

True if the teardown process was successful.

#### Implementation of

`IEntityStorageConnector.teardown`

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

#### Implementation of

`IEntityStorageConnector.count`

***

### getStore() {#getstore}

> **getStore**(): `T`[]

Get the memory store.

#### Returns

`T`[]

The store.

***

### getPartitionContextIds() {#getpartitioncontextids}

> **getPartitionContextIds**(): `Promise`\<`IContextIds`[]\>

Get a unique list of all the context ids from the storage.

#### Returns

`Promise`\<`IContextIds`[]\>

The list of unique context ids.

#### Implementation of

`IEntityStorageMigrationConnector.getPartitionContextIds`

***

### createTargetConnector() {#createtargetconnector}

> **createTargetConnector**\<`U`\>(`newEntitySchema`): `Promise`\<`IEntityStorageConnector`\<`U`\>\>

Create the target connector for performing the migration it will use a temporary storage location.

#### Type Parameters

##### U

`U`

#### Parameters

##### newEntitySchema

`string`

The name of the new entity schema to create the connector for.

#### Returns

`Promise`\<`IEntityStorageConnector`\<`U`\>\>

Connector for performing the migration.

#### Implementation of

`IEntityStorageMigrationConnector.createTargetConnector`

***

### finalizeMigration() {#finalizemigration}

> **finalizeMigration**\<`U`\>(`targetConnector`, `options?`, `loggingComponentType?`): `Promise`\<`IEntityStorageConnector`\<`U`\>\>

Finalize the migration by tearing down the old connector and replacing it with the target connector.

#### Type Parameters

##### U

`U`

#### Parameters

##### targetConnector

`IEntityStorageConnector`\<`U`\>

The target connector to finalize the migration with.

##### options?

`IMigrationOptions`

The options to control how the migration is finalized.

##### loggingComponentType?

`string`

The optional component type to use for logging the migration progress.

#### Returns

`Promise`\<`IEntityStorageConnector`\<`U`\>\>

A promise that resolves when the migration is finalized.

#### Implementation of

`IEntityStorageMigrationConnector.finalizeMigration`

***

### cleanupMigration() {#cleanupmigration}

> **cleanupMigration**\<`U`\>(`targetConnector`, `options?`, `loggingComponentType?`): `Promise`\<`void`\>

Cleanup the migration if a migration fails or needs to be aborted.

#### Type Parameters

##### U

`U`

#### Parameters

##### targetConnector

`IEntityStorageConnector`\<`U`\> \| `undefined`

The target connector to cleanup the migration with.

##### options?

`IMigrationOptions`

The options to control how the migration is cleaned up.

##### loggingComponentType?

`string`

The optional component type to use for logging the migration progress.

#### Returns

`Promise`\<`void`\>

A promise that resolves when the migration is cleaned up.

#### Implementation of

`IEntityStorageMigrationConnector.cleanupMigration`
