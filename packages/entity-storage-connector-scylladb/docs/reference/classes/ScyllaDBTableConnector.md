# Class: ScyllaDBTableConnector\<T\>

Store entities using ScyllaDB.

## Extends

- `AbstractScyllaDBConnector`\<`T`\>

## Type Parameters

### T

`T` = `unknown`

## Implements

- `IEntityStorageMigrationConnector`\<`T`\>
- `IHealthProviderComponent`

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

`IEntityStorageMigrationConnector.getSchema`

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

`IEntityStorageMigrationConnector.get`

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

`IEntityStorageMigrationConnector.query`

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

`IEntityStorageMigrationConnector.count`

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

`IEntityStorageMigrationConnector.className`

#### Overrides

`AbstractScyllaDBConnector.className`

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

`IEntityStorageMigrationConnector.bootstrap`

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

> **empty**(`partitionKey?`): `Promise`\<`void`\>

Remove all entities from the storage.

#### Parameters

##### partitionKey?

`string`

The optional partition key.

#### Returns

`Promise`\<`void`\>

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

#### Implementation of

`IEntityStorageMigrationConnector.remove`

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

> **createTargetConnector**\<`U`\>(`entitySchemaName`): `Promise`\<`ScyllaDBTableConnector`\<`U`\>\>

Create a new target connector for the migration.

#### Type Parameters

##### U

`U`

#### Parameters

##### entitySchemaName

`string`

The entity schema name to use for the target connector.

#### Returns

`Promise`\<`ScyllaDBTableConnector`\<`U`\>\>

A new connector configured with a migration table name.

#### Implementation of

`IEntityStorageMigrationConnector.createTargetConnector`

***

### finalizeMigration() {#finalizemigration}

> **finalizeMigration**\<`U`\>(`targetConnector`, `options?`, `loggingComponentType?`): `Promise`\<`ScyllaDBTableConnector`\<`U`\>\>

Finalize the migration by pointing a new connector at the migration table.

#### Type Parameters

##### U

`U`

#### Parameters

##### targetConnector

`ScyllaDBTableConnector`\<`U`\>

The connector pointing to the migration table.

##### options?

`IMigrationOptions`

The optional migration options.

##### loggingComponentType?

`string`

The node logging component type.

#### Returns

`Promise`\<`ScyllaDBTableConnector`\<`U`\>\>

A connector pointing to the migration table (now the live table).

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

`ScyllaDBTableConnector`\<`U`\>

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
