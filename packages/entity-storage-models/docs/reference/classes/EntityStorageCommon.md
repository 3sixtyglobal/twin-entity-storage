# Class: EntityStorageCommon

Common entity storage operations which a connector can reuse when its own query language cannot
express them.

## Constructors

### Constructor

> **new EntityStorageCommon**(): `EntityStorageCommon`

#### Returns

`EntityStorageCommon`

## Properties

### CLASS\_NAME {#class_name}

> `readonly` `static` **CLASS\_NAME**: `string`

Runtime name for the class.

## Methods

### queryJoin() {#queryjoin}

> `static` **queryJoin**\<`T`, `U`\>(`connector`, `joinConnector`, `joinOptions`): `Promise`\<\{ `entities`: `Partial`\<`T`\> & `object`[]; `cursor?`: `string`; \}\>

Perform a join for a connector whose own query language cannot express one. Only the page of
primary entities is read, using the storage's own paging, and the entities attached to that
page are then looked up by value, so the work stays proportional to the page rather than to
the size of the storage.

#### Type Parameters

##### T

`T`

##### U

`U`

#### Parameters

##### connector

[`IEntityStorageConnector`](../interfaces/IEntityStorageConnector.md)\<`T`\>

The connector holding the primary entities.

##### joinConnector

[`IEntityStorageConnector`](../interfaces/IEntityStorageConnector.md)\<`U`\>

The connector holding the entities to join to.

##### joinOptions

[`IEntityStorageJoinOptions`](../interfaces/IEntityStorageJoinOptions.md)\<`T`, `U`\>

The join configuration.

#### Returns

`Promise`\<\{ `entities`: `Partial`\<`T`\> & `object`[]; `cursor?`: `string`; \}\>

The entities with their joined entities, and the next page cursor.
