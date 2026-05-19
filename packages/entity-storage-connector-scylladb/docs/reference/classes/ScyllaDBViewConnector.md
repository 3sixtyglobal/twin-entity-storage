# Class: ScyllaDBViewConnector\<T\>

Manage entities using ScyllaDB Views.

## Extends

- `AbstractScyllaDBConnector`\<`T`\>

## Type Parameters

### T

`T`

## Implements

- `IEntityStorageConnector`\<`T`\>

## Constructors

### Constructor

> **new ScyllaDBViewConnector**\<`T`\>(`options`): `ScyllaDBViewConnector`\<`T`\>

Create a new instance of ScyllaDBViewConnector.

#### Parameters

##### options

[`IScyllaDBViewConnectorConstructorOptions`](../interfaces/IScyllaDBViewConnectorConstructorOptions.md)

The options for the connector.

#### Returns

`ScyllaDBViewConnector`\<`T`\>

#### Overrides

`AbstractScyllaDBConnector<T>.constructor`

## Properties

### CLASS\_NAME {#class_name}

> `readonly` `static` **CLASS\_NAME**: `string`

Runtime name for the class.

#### Overrides

`AbstractScyllaDBConnector.CLASS_NAME`

## Methods

### getSchema() {#getschema}

> **getSchema**(): `IEntitySchema`

Get the schema for the entities.

#### Returns

`IEntitySchema`

The schema for the entities.

#### Implementation of

`IEntityStorageConnector.getSchema`

#### Inherited from

`AbstractScyllaDBConnector.getSchema`

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

Get the item using a secondary index.

##### conditions?

`object`[]

The optional conditions to match for the entities.

#### Returns

`Promise`\<`T` \| `undefined`\>

The object if it can be found or undefined.

#### Implementation of

`IEntityStorageConnector.get`

#### Inherited from

`AbstractScyllaDBConnector.get`

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

#### Inherited from

`AbstractScyllaDBConnector.query`

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

#### Inherited from

`AbstractScyllaDBConnector.count`

***

### safeTableName() {#safetablename}

> `protected` **safeTableName**(`name`): `string`

Get a safe table name by replacing any non-alphanumeric characters.

#### Parameters

##### name

`string`

The name to sanitize.

#### Returns

`string`

The safe table name.

#### Inherited from

`AbstractScyllaDBConnector.safeTableName`

***

### className() {#classname}

> **className**(): `string`

Returns the class name of the component.

#### Returns

`string`

The class name of the component.

#### Implementation of

`IEntityStorageConnector.className`

#### Overrides

`AbstractScyllaDBConnector.className`

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

### set() {#set}

> **set**(`entity`): `Promise`\<`void`\>

Set an entity.

#### Parameters

##### entity

`T`

The entity to set.

#### Returns

`Promise`\<`void`\>

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

#### Implementation of

`IEntityStorageConnector.setBatch`

***

### empty() {#empty}

> **empty**(): `Promise`\<`void`\>

Remove all entities from the storage.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`IEntityStorageConnector.empty`

***

### remove() {#remove}

> **remove**(`id`): `Promise`\<`void`\>

Delete the entity.

#### Parameters

##### id

`string`

The id of the entity to remove.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`IEntityStorageConnector.remove`

***

### removeBatch() {#removebatch}

> **removeBatch**(`_ids`): `Promise`\<`void`\>

Remove multiple entities.

#### Parameters

##### \_ids

`string`[]

The ids of the entities to remove.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`IEntityStorageConnector.removeBatch`

***

### teardown() {#teardown}

> **teardown**(`_nodeLoggingComponentType?`): `Promise`\<`boolean`\>

Teardown the entity storage (not supported for views).

#### Parameters

##### \_nodeLoggingComponentType?

`string`

The node logging component type.

#### Returns

`Promise`\<`boolean`\>

True if the teardown process was successful.

#### Implementation of

`IEntityStorageConnector.teardown`
