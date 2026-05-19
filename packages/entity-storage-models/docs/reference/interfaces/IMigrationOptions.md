# Interface: IMigrationOptions

Options controlling how a schema migration is executed.

## Properties

### batchSize? {#batchsize}

> `optional` **batchSize?**: `number`

Number of entities to read and write per batch.

#### Default

```ts
100
```

***

### transformEntity? {#transformentity}

> `optional` **transformEntity?**: (`entity`) => `unknown`

Optional transformation applied to each entity before it is written
to the new schema. Required when the schema diff includes type changes
or field renames. Receives the raw entity in its old shape and must
return an object conforming to the new schema.

#### Parameters

##### entity

`unknown`

The entity in its current (old) shape.

#### Returns

`unknown`

The entity transformed to match the new schema.

***

### onProgress? {#onprogress}

> `optional` **onProgress?**: (`migrated`) => `Promise`\<`void`\>

Called after each batch is successfully written.
Receives the running total of migrated entities.

#### Parameters

##### migrated

`number`

Running total of entities successfully migrated so far.

#### Returns

`Promise`\<`void`\>
