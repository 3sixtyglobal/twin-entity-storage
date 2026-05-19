# Interface: IEntityStorageConnector\<T\>

Interface describing an entity storage connector.

## Extends

- `IComponent`

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

### empty() {#empty}

> **empty**(): `Promise`\<`void`\>

Remove all entities from the storage.

#### Returns

`Promise`\<`void`\>

Nothing.

***

### count() {#count}

> **count**(): `Promise`\<`number`\>

Count all the entities which match the conditions.

#### Returns

`Promise`\<`number`\>

The total count of entities in the storage.

***

### migrate() {#migrate}

> **migrate**(`newSchema`, `options?`): `Promise`\<[`IMigrationResult`](IMigrationResult.md)\>

Migrate the storage to a new schema version FOR THE CURRENT PARTITION.

**Partition scope:** this operation applies only to the partition derived
from the current `ContextIdStore`. Data in other partitions is NOT
migrated. Callers that need to migrate all partitions must invoke
`migrate()` once per partition, setting the appropriate context before
each call.

**Safe-swap connectors** (MySQL, PostgreSQL, File, Memory, ScyllaDB,
Firestore): data is first written into a `_migration` container. Only on
full success is the original container atomically replaced (or
equivalent). A failure leaves the live container untouched.

**MongoDB:** uses a `{collection}_migration` temp collection and
`migrateEntities`, then **replaces only the current partition** in the live
collection (delete those documents, insert migrated copies). It does **not**
use `renameCollection` on the whole live collection, because that would
wipe other partitions that share the same collection. The final merge is
not one atomic rename; see the MongoDB connector's `migrate()` JSDoc.

**In-place connectors** (CosmosDB, DynamoDB): data is upserted directly
into the live container because the platform offers no atomic rename. A
failure may leave the live container in a half-migrated state. Back up
data before calling `migrate()` on these connectors.

If the schema diff contains type changes and no `transformEntity` is
provided the method throws a `GeneralError` listing the affected fields.

#### Parameters

##### newSchema

`IEntitySchema`

The target schema to migrate toward.

##### options?

[`IMigrationOptions`](IMigrationOptions.md)

Optional configuration controlling batch size, transform
and progress callback.

#### Returns

`Promise`\<[`IMigrationResult`](IMigrationResult.md)\>

A result describing how many entities were migrated.
