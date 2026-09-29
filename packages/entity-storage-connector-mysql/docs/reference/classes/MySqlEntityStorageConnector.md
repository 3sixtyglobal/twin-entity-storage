# Class: MySqlEntityStorageConnector\<T\>

Class for performing entity storage operations using MySql.

## Type Parameters

### T

`T` = `unknown`

## Implements

- `IEntityStorageMigrationConnector`\<`T`\>
- `IHealthProviderComponent`

## Constructors

### Constructor

> **new MySqlEntityStorageConnector**\<`T`\>(`options`): `MySqlEntityStorageConnector`\<`T`\>

Create a new instance of MySqlEntityStorageConnector.

#### Parameters

##### options

[`IMySqlEntityStorageConnectorConstructorOptions`](../interfaces/IMySqlEntityStorageConnectorConstructorOptions.md)

The options for the connector.

#### Returns

`MySqlEntityStorageConnector`\<`T`\>

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

### getSchema() {#getschema}

> **getSchema**(): `IEntitySchema`

Get the schema for the entities.

#### Returns

`IEntitySchema`

The schema for the entities.

#### Implementation of

`IEntityStorageMigrationConnector.getSchema`

***

### bootstrap() {#bootstrap}

> **bootstrap**(`nodeLoggingComponentType?`): `Promise`\<`boolean`\>

Initialize the MySql environment.

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

### stop() {#stop}

> **stop**(`nodeLoggingComponentType?`): `Promise`\<`void`\>

The component needs to be stopped when the node is closed.

#### Parameters

##### nodeLoggingComponentType?

`string`

The node logging component type.

#### Returns

`Promise`\<`void`\>

Nothing.

#### Implementation of

`IEntityStorageMigrationConnector.stop`

***

### get() {#get}

> **get**(`id`, `secondaryIndex?`, `conditions?`): `Promise`\<`T` \| `undefined`\>

Get an entity from MySql.

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

Empty the entity storage.

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

### queryJoin() {#queryjoin}

> **queryJoin**\<`U`\>(`joinConnector`, `joinOptions`): `Promise`\<\{ `entities`: `Partial`\<`T`\> & `object`[]; `cursor?`: `string`; \}\>

Find all the entities which match the conditions, attaching to each one the entities from a
second storage connector whose join property matches. The join behaves like a left join by
default, a primary entity with no matches is still returned with an empty joined list, unless
joinRequired asks for an inner join and those entities are left out altogether. Both connectors
must be MySQL connectors reading from the same database so the work can be done in a single
statement.

#### Type Parameters

##### U

`U`

#### Parameters

##### joinConnector

`IEntityStorageConnector`\<`U`\>

The connector holding the entities to join to.

##### joinOptions

`IEntityStorageJoinOptions`\<`T`, `U`\>

The properties to join on, the conditions, sort order, projection and
paging for the primary entities, the optional grouping and group conditions, and the optional
conditions, sort order and projection for the joined entities.

#### Returns

`Promise`\<\{ `entities`: `Partial`\<`T`\> & `object`[]; `cursor?`: `string`; \}\>

All the entities for the storage matching the conditions with their joined entities,
and a cursor which can be used to request more entities.

#### Throws

GeneralError if the join connector does not read from the same server and database.

#### Implementation of

`IEntityStorageMigrationConnector.queryJoin`

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

> **getPartitionContextIds**(`loggingComponentType?`): `Promise`\<`IContextIds`[] \| `undefined`\>

Get all unique partition context ids present in the table.

#### Parameters

##### loggingComponentType?

`string`

The optional component type to use for logging skipped partition ids.

#### Returns

`Promise`\<`IContextIds`[] \| `undefined`\>

An array of context id objects, one per unique partition.

#### Implementation of

`IEntityStorageMigrationConnector.getPartitionContextIds`

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

### getMissingColumns() {#getmissingcolumns}

> **getMissingColumns**(): `string`[]

Get the schema columns the last bootstrap found missing from the table.

#### Returns

`string`[]

The missing column names, empty when the table has every column.

#### Implementation of

`IEntityStorageMigrationConnector.getMissingColumns`

***

### createTargetConnector() {#createtargetconnector}

> **createTargetConnector**\<`U`\>(`newEntitySchema`): `Promise`\<`IEntityStorageConnector`\<`U`\>\>

Create the target connector for performing the migration using a temporary table.

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

> **finalizeMigration**\<`U`\>(`targetConnector`, `options?`, `loggingComponentType?`): `Promise`\<`MySqlEntityStorageConnector`\<`U`\>\>

Finalize the migration by swapping the migration table into the original name and dropping the old table.

#### Type Parameters

##### U

`U`

#### Parameters

##### targetConnector

`MySqlEntityStorageConnector`\<`U`\>

The connector holding the migrated data in a temporary table.

##### options?

`IMigrationOptions`

The options to control how the migration is finalized.

##### loggingComponentType?

`string`

The logging component type to use during finalization.

#### Returns

`Promise`\<`MySqlEntityStorageConnector`\<`U`\>\>

The final connector using the original table name with the new schema.

#### Implementation of

`IEntityStorageMigrationConnector.finalizeMigration`

***

### cleanupMigration() {#cleanupmigration}

> **cleanupMigration**\<`U`\>(`targetConnector`, `options?`, `loggingComponentType?`): `Promise`\<`void`\>

Cleanup a failed or aborted migration by dropping the temporary migration table.

#### Type Parameters

##### U

`U`

#### Parameters

##### targetConnector

`IEntityStorageConnector`\<`U`\> \| `undefined`

The target connector to cleanup.

##### options?

`IMigrationOptions`

The options to control how the migration is cleaned up.

##### loggingComponentType?

`string`

The optional component type to use for logging.

#### Returns

`Promise`\<`void`\>

A promise that resolves when the cleanup is complete.

#### Implementation of

`IEntityStorageMigrationConnector.cleanupMigration`

***

### databaseExists() {#databaseexists}

> **databaseExists**(): `Promise`\<`boolean`\>

Check if the database exists.

#### Returns

`Promise`\<`boolean`\>

True if the database exists, false otherwise.
