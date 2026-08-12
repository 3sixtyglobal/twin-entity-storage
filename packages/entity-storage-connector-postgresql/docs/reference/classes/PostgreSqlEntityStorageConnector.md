# Class: PostgreSqlEntityStorageConnector\<T\>

Class for performing entity storage operations using ql.

## Type Parameters

### T

`T` = `unknown`

## Implements

- `IEntityStorageMigrationConnector`\<`T`\>
- `IHealthProviderComponent`

## Constructors

### Constructor

> **new PostgreSqlEntityStorageConnector**\<`T`\>(`options`): `PostgreSqlEntityStorageConnector`\<`T`\>

Create a new instance of PostgreSqlEntityStorageConnector.

#### Parameters

##### options

[`IPostgreSqlEntityStorageConnectorConstructorOptions`](../interfaces/IPostgreSqlEntityStorageConnectorConstructorOptions.md)

The options for the connector.

#### Returns

`PostgreSqlEntityStorageConnector`\<`T`\>

## Properties

### CLASS\_NAME {#class_name}

> `readonly` `static` **CLASS\_NAME**: `string`

Runtime name for the class.

## Methods

### bootstrap() {#bootstrap}

> **bootstrap**(`nodeLoggingComponentType?`): `Promise`\<`boolean`\>

Initialize the PostgreSql environment.

#### Parameters

##### nodeLoggingComponentType?

`string`

Optional type of the logging component.

#### Returns

`Promise`\<`boolean`\>

A promise that resolves to a boolean indicating success.

#### Implementation of

`IEntityStorageMigrationConnector.bootstrap`

***

### className() {#classname}

> **className**(): `string`

Returns the class name of the component.

#### Returns

`string`

The class name of the component.

#### Implementation of

`IEntityStorageMigrationConnector.className`

***

### health() {#health}

> **health**(): `Promise`\<`IHealth`[]\>

Returns the health status of the component.

#### Returns

`Promise`\<`IHealth`[]\>

The health status of the component.

#### Implementation of

`IHealthProviderComponent.health`

***

### stop() {#stop}

> **stop**(): `Promise`\<`void`\>

The component needs to be stopped when the node is closed.

#### Returns

`Promise`\<`void`\>

Nothing.

#### Implementation of

`IEntityStorageMigrationConnector.stop`

***

### getSchema() {#getschema}

> **getSchema**(): `IEntitySchema`

Get the schema for the entities.

#### Returns

`IEntitySchema`

The schema for the entities.

#### Implementation of

`IEntityStorageMigrationConnector.getSchema`

***

### get() {#get}

> **get**(`id`, `secondaryIndex?`, `conditions?`): `Promise`\<`T` \| `undefined`\>

Get an entity from PostgreSql.

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

`IEntityStorageMigrationConnector.get`

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

#### Implementation of

`IEntityStorageMigrationConnector.set`

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

`IEntityStorageMigrationConnector.setBatch`

***

### empty() {#empty}

> **empty**(): `Promise`\<`void`\>

Empty all the entities.

#### Returns

`Promise`\<`void`\>

Nothing.

#### Implementation of

`IEntityStorageMigrationConnector.empty`

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

`IEntityStorageMigrationConnector.remove`

***

### removeBatch() {#removebatch}

> **removeBatch**(`ids`): `Promise`\<`void`\>

Remove multiple entities by their primary key IDs.

#### Parameters

##### ids

`string`[]

The ids of the entities to remove.

#### Returns

`Promise`\<`void`\>

Nothing.

#### Implementation of

`IEntityStorageMigrationConnector.removeBatch`

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

`IEntityStorageMigrationConnector.teardown`

***

### connectorVersion() {#connectorversion}

> **connectorVersion**(): `number`

Get the connector implementation version.

#### Returns

`number`

The connector implementation version.

#### Implementation of

`IEntityStorageMigrationConnector.connectorVersion`

***

### getPartitionContextIds() {#getpartitioncontextids}

> **getPartitionContextIds**(): `Promise`\<`IContextIds`[] \| `undefined`\>

Get all the distinct partition context ids from the storage.

#### Returns

`Promise`\<`IContextIds`[] \| `undefined`\>

An array of context id objects, one per unique partition.

#### Implementation of

`IEntityStorageMigrationConnector.getPartitionContextIds`

***

### createTargetConnector() {#createtargetconnector}

> **createTargetConnector**\<`U`\>(`entitySchemaName`): `Promise`\<`PostgreSqlEntityStorageConnector`\<`U`\>\>

Create a new target connector for the migration.

#### Type Parameters

##### U

`U`

#### Parameters

##### entitySchemaName

`string`

The entity schema name to use for the target connector.

#### Returns

`Promise`\<`PostgreSqlEntityStorageConnector`\<`U`\>\>

A new connector configured with a migration table name.

#### Implementation of

`IEntityStorageMigrationConnector.createTargetConnector`

***

### finalizeMigration() {#finalizemigration}

> **finalizeMigration**\<`U`\>(`targetConnector`, `options?`, `loggingComponentType?`): `Promise`\<`PostgreSqlEntityStorageConnector`\<`U`\>\>

Finalize the migration by renaming the migration table to the original table name.

#### Type Parameters

##### U

`U`

#### Parameters

##### targetConnector

`PostgreSqlEntityStorageConnector`\<`U`\>

The connector pointing to the migration table.

##### options?

`IMigrationOptions`

The optional migration options.

##### loggingComponentType?

`string`

The node logging component type.

#### Returns

`Promise`\<`PostgreSqlEntityStorageConnector`\<`U`\>\>

A connector pointing to the final (renamed) table.

#### Implementation of

`IEntityStorageMigrationConnector.finalizeMigration`

***

### cleanupMigration() {#cleanupmigration}

> **cleanupMigration**\<`U`\>(`targetConnector?`, `options?`, `loggingComponentType?`): `Promise`\<`void`\>

Clean up the migration by tearing down the migration table.

#### Type Parameters

##### U

`U`

#### Parameters

##### targetConnector?

`PostgreSqlEntityStorageConnector`\<`U`\>

The connector pointing to the migration table.

##### options?

`IMigrationOptions`

The optional migration options.

##### loggingComponentType?

`string`

The node logging component type.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`IEntityStorageMigrationConnector.cleanupMigration`

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

`IEntityStorageMigrationConnector.query`

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

`IEntityStorageMigrationConnector.count`
