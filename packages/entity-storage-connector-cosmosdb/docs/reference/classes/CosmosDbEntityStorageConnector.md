# Class: CosmosDbEntityStorageConnector\<T\>

Class for performing entity storage operations using Cosmos DB.

## Type Parameters

### T

`T` = `unknown`

## Implements

- `IEntityStorageMigrationConnector`\<`T`\>

## Constructors

### Constructor

> **new CosmosDbEntityStorageConnector**\<`T`\>(`options`): `CosmosDbEntityStorageConnector`\<`T`\>

Create a new instance of CosmosDbEntityStorageConnector.

#### Parameters

##### options

[`ICosmosDbEntityStorageConnectorConstructorOptions`](../interfaces/ICosmosDbEntityStorageConnectorConstructorOptions.md)

The options for the connector.

#### Returns

`CosmosDbEntityStorageConnector`\<`T`\>

## Properties

### CLASS\_NAME {#class_name}

> `readonly` `static` **CLASS\_NAME**: `string`

Runtime name for the class.

## Methods

### bootstrap() {#bootstrap}

> **bootstrap**(`nodeLoggingComponentType?`): `Promise`\<`boolean`\>

Initialize the Cosmos DB environment.

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

`IEntityStorageMigrationConnector.health`

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

Get an entity from Cosmos DB.

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

Empty all entities from the storage.

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

Remove multiple entities by id.

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

Teardown the storage by deleting the underlying container.

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

Create the target connector for performing the migration using a temporary container.

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

> **finalizeMigration**\<`U`\>(`targetConnector`, `options?`, `loggingComponentType?`): `Promise`\<`CosmosDbEntityStorageConnector`\<`U`\>\>

Finalize the migration by tearing down the old container and replacing it with the target container.

#### Type Parameters

##### U

`U`

#### Parameters

##### targetConnector

`CosmosDbEntityStorageConnector`\<`U`\>

The target connector to finalize the migration with.

##### options?

`IMigrationOptions`\<`T`, `U`\>

The options to control how the migration is finalized.

##### loggingComponentType?

`string`

The optional component type to use for logging.

#### Returns

`Promise`\<`CosmosDbEntityStorageConnector`\<`U`\>\>

The final connector pointing at the original container id.

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

The target connector to cleanup.

##### options?

`IMigrationOptions`\<`T`, `U`\>

The options to control how the migration is cleaned up.

##### loggingComponentType?

`string`

The optional component type to use for logging.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`IEntityStorageMigrationConnector.cleanupMigration`
