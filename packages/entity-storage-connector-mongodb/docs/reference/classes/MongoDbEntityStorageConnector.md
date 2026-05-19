# Class: MongoDbEntityStorageConnector\<T\>

Class for performing entity storage operations using MongoDb.

## Type Parameters

### T

`T` = `unknown`

## Implements

- `IEntityStorageConnector`\<`T`\>

## Constructors

### Constructor

> **new MongoDbEntityStorageConnector**\<`T`\>(`options`): `MongoDbEntityStorageConnector`\<`T`\>

Create a new instance of MongoDbEntityStorageConnector.

#### Parameters

##### options

[`IMongoDbEntityStorageConnectorConstructorOptions`](../interfaces/IMongoDbEntityStorageConnectorConstructorOptions.md)

The options for the connector.

#### Returns

`MongoDbEntityStorageConnector`\<`T`\>

## Properties

### CLASS\_NAME {#class_name}

> `readonly` `static` **CLASS\_NAME**: `string`

Runtime name for the class.

## Methods

### bootstrap() {#bootstrap}

> **bootstrap**(`nodeLoggingComponentType?`): `Promise`\<`boolean`\>

Initialize the MongoDb environment.

#### Parameters

##### nodeLoggingComponentType?

`string`

Optional type of the logging component.

#### Returns

`Promise`\<`boolean`\>

A promise that resolves to a boolean indicating success.

#### Implementation of

`IEntityStorageConnector.bootstrap`

***

### stop()? {#stop}

> `optional` **stop**(`nodeLoggingComponentType?`): `Promise`\<`void`\>

The component needs to be stopped when the node is closed.

#### Parameters

##### nodeLoggingComponentType?

`string`

The node logging component type.

#### Returns

`Promise`\<`void`\>

Nothing.

#### Implementation of

`IEntityStorageConnector.stop`

***

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

Get an entity from MongoDb.

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

### empty() {#empty}

> **empty**(): `Promise`\<`void`\>

Empty the entity storage.

#### Returns

`Promise`\<`void`\>

Nothing.

#### Implementation of

`IEntityStorageConnector.empty`

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

Teardown the entity storage by dropping the collection.

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

### count() {#count}

> **count**(): `Promise`\<`number`\>

Count all the entities which match the conditions.

#### Returns

`Promise`\<`number`\>

The total count of entities in the storage.

#### Implementation of

`IEntityStorageConnector.count`

***

### migrate() {#migrate}

> **migrate**(`newSchema`, `options?`): `Promise`\<`IMigrationResult`\>

Migrate entities for the **current partition only**, consistent with `query()` /
`setBatch()`: data is read via `migrateEntities`, which pages with this
connector's partition filter.

**Why not `renameCollection` on the whole live collection?** A migration temp
collection only holds rows for the active partition. Renaming it to the live
name would replace the entire collection and **destroy every other
partition** stored in the same MongoDB collection. Instead we copy migrated
documents from `{collection}_migration` into the live collection by:
deleting only the current partition's documents, then inserting the migrated
set. Other partitions remain unchanged. That is not an atomic swap; a failure
mid-swap can leave the partition in a bad state (callers should treat
`migrate()` like other non-atomic backends and plan retries/backups).

**Product note:** A future option could be to migrate **all** partitions in
one call (e.g. loop contexts or a full-collection strategy similar to SQL
connectors). Until then, callers that need every tenant migrated must invoke
`migrate()` once per partition.

#### Parameters

##### newSchema

`IEntitySchema`

The target entity schema.

##### options?

`IMigrationOptions`

Options controlling migration behaviour.

#### Returns

`Promise`\<`IMigrationResult`\>

The migration result.

#### Implementation of

`IEntityStorageConnector.migrate`
