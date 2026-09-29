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

### onProgress? {#onprogress}

> `optional` **onProgress?**: (`progressItem`, `itemTotal`, `itemIndex`) => `Promise`\<`void`\>

Called for progress tracking.

#### Parameters

##### progressItem

`"partitionStart"` \| `"partitionProgress"` \| `"partitionEnd"` \| `"partitionItemsStart"` \| `"partitionItemsProgress"` \| `"partitionItemsEnd"`

The item progress being updated.

##### itemTotal

`number`

The total number of rows to migrate.

##### itemIndex

`number`

The number of rows migrated so far.

#### Returns

`Promise`\<`void`\>

***

### onFinalizing? {#onfinalizing}

> `optional` **onFinalizing?**: () => `Promise`\<`void`\>

Called once every partition has been copied, immediately before the source connector
finalizes the migration.

#### Returns

`Promise`\<`void`\>
