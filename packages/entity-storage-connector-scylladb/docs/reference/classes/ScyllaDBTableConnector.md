# Class: ScyllaDBTableConnector\<T\>

Store entities using ScyllaDB.

## Extends

- `AbstractScyllaDBConnector`\<`T`\>

## Type Parameters

### T

`T` = `unknown`

## Implements

- `IEntityStorageConnector`\<`T`\>

## Constructors

### Constructor

> **new ScyllaDBTableConnector**\<`T`\>(`options`): `ScyllaDBTableConnector`\<`T`\>

Create a new instance of ScyllaDBTableConnector.

#### Parameters

##### options

[`IScyllaDBTableConnectorConstructorOptions`](../interfaces/IScyllaDBTableConnectorConstructorOptions.md)

The options for the connector.

#### Returns

`ScyllaDBTableConnector`\<`T`\>

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

> **count**(): `Promise`\<`number`\>

Count all the entities which match the conditions.

#### Returns

`Promise`\<`number`\>

The total count of entities in the storage.

#### Implementation of

`IEntityStorageConnector.count`

#### Inherited from

`AbstractScyllaDBConnector.count`

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

### health() {#health}

> **health**(): `Promise`\<`IHealth`[]\>

Get the health of the component.

#### Returns

`Promise`\<`IHealth`[]\>

The health of the component.

#### Implementation of

`IEntityStorageConnector.health`

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

> **empty**(`partitionKey?`): `Promise`\<`void`\>

Remove all entities from the storage.

#### Parameters

##### partitionKey?

`string`

The optional partition key.

#### Returns

`Promise`\<`void`\>

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

#### Implementation of

`IEntityStorageConnector.remove`

***

### removeBatch() {#removebatch}

> **removeBatch**(`ids`): `Promise`\<`void`\>

Remove multiple entities.

#### Parameters

##### ids

`string`[]

The ids of the entities to remove.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`IEntityStorageConnector.removeBatch`

***

### teardown() {#teardown}

> **teardown**(`nodeLoggingComponentType?`): `Promise`\<`boolean`\>

Teardown the entity storage by dropping the table.

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

### migrate() {#migrate}

> **migrate**(`newSchema`, `options?`): `Promise`\<`IMigrationResult`\>

Migrate the storage to a new schema version.

**Partition scope (strictly add-only):** When the diff has no `modified` and
no `removed` entries, the first copy uses `migrateEntities` (same partition
as `query()`). The swap adds new columns on the live table, deletes only that
partition’s rows, copies from `{table}_migration`, then drops the temp table.
**Dropped columns are not supported** on this path: `ALTER DROP` is
table-wide and would corrupt other tenants; removals still use the legacy
full-table migration below.

**Full-table:** When `diff.modified` is non-empty (e.g. type changes with
`transformEntity`), or when columns are **removed**, CQL cannot apply those
changes per-partition (`ALTER DROP` is table-wide). The connector uses the
legacy **drop live → recreate → double-copy** path over **all rows**.

#### Parameters

##### newSchema

`IEntitySchema`

The target schema to migrate toward.

##### options?

`IMigrationOptions`

Optional batch size, transform, and progress callback.

#### Returns

`Promise`\<`IMigrationResult`\>

Migration counts and per-entity errors.

#### Implementation of

`IEntityStorageConnector.migrate`
