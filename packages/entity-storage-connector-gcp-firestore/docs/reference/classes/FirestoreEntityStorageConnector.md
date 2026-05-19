# Class: FirestoreEntityStorageConnector\<T\>

Class for performing entity storage operations using Firestore.

## Type Parameters

### T

`T` = `unknown`

## Implements

- `IEntityStorageConnector`\<`T`\>

## Constructors

### Constructor

> **new FirestoreEntityStorageConnector**\<`T`\>(`options`): `FirestoreEntityStorageConnector`\<`T`\>

Create a new instance of FirestoreEntityStorageConnector.

#### Parameters

##### options

[`IFirestoreEntityStorageConnectorConstructorOptions`](../interfaces/IFirestoreEntityStorageConnectorConstructorOptions.md)

The options for the connector.

#### Returns

`FirestoreEntityStorageConnector`\<`T`\>

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

### bootstrap() {#bootstrap}

> **bootstrap**(`nodeLoggingComponentType?`): `Promise`\<`boolean`\>

Bootstrap the component by creating and initializing any resources it needs.

#### Parameters

##### nodeLoggingComponentType?

`string`

The node logging component type.

#### Returns

`Promise`\<`boolean`\>

True if the bootstrapping process was successful.

#### Implementation of

`IEntityStorageConnector.bootstrap`

***

### get() {#get}

> **get**(`id`, `secondaryIndex?`, `conditions?`): `Promise`\<`T` \| `undefined`\>

Get an entity.

#### Parameters

##### id

`string`

The id of the entity to get.

##### secondaryIndex?

keyof `T`

The optional secondary index to use.

##### conditions?

`object`[]

The optional conditions to apply to the query.

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

The optional conditions to apply to the update.

#### Returns

`Promise`\<`void`\>

Nothing.

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

Empty the storage by deleting all entities in the collection.

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

The optional conditions to apply to the delete.

#### Returns

`Promise`\<`void`\>

Nothing.

#### Implementation of

`IEntityStorageConnector.remove`

***

### removeBatch() {#removebatch}

> **removeBatch**(`ids`): `Promise`\<`void`\>

Remove multiple entities by their primary key IDs using a Firestore WriteBatch.

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

Teardown the storage by deleting all documents in the partition collection.

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

The suggested number of entities to return in each chunk.

#### Returns

`Promise`\<\{ `entities`: `Partial`\<`T`\>[]; `cursor?`: `string`; \}\>

The matching entities and a cursor for the next page.

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

Migrate the storage to a new schema version for the current partition.

**Strategy B:** `migrateEntities` copies from this connector into a temp
Firestore collection whose ID is `${partitionCollectionId}_new`, then
batch-deletes the live partition documents and copies migrated data back.
Failures before the swap complete leave the live collection unchanged when
possible; the temp collection is torn down in the error path.

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
