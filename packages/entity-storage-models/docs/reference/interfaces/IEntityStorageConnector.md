# Interface: IEntityStorageConnector\<T\>

Interface describing an entity storage connector.

## Extends

- `IComponent`

## Extended by

- [`IEntityStorageMigrationConnector`](IEntityStorageMigrationConnector.md)

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

***

### queryJoin() {#queryjoin}

> **queryJoin**\<`U`\>(`joinConnector`, `joinOptions`): `Promise`\<\{ `entities`: `Partial`\<`T`\> & `object`[]; `cursor?`: `string`; \}\>

Query all the entities which match the conditions, attaching to each one the entities from a
second storage connector whose join property matches. The join behaves like a left join by
default, a primary entity with no matches is still returned with an empty joined list, unless
joinRequired asks for an inner join and those entities are left out altogether.

#### Type Parameters

##### U

`U`

#### Parameters

##### joinConnector

`IEntityStorageConnector`\<`U`\>

The connector holding the entities to join to.

##### joinOptions

[`IEntityStorageJoinOptions`](IEntityStorageJoinOptions.md)\<`T`, `U`\>

The properties to join on, the conditions, sort order, projection and
paging for the primary entities, the optional grouping and group conditions, and the optional
conditions, sort order and projection for the joined entities.

#### Returns

`Promise`\<\{ `entities`: `Partial`\<`T`\> & `object`[]; `cursor?`: `string`; \}\>

All the entities for the storage matching the conditions with their joined entities,
and a cursor which can be used to request more entities.

***

### empty() {#empty}

> **empty**(): `Promise`\<`void`\>

Remove all entities from the storage.

#### Returns

`Promise`\<`void`\>

Nothing.

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
