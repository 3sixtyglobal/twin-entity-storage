# Interface: IMigrationOptions\<T, U\>

Options controlling how a schema migration is executed.

## Type Parameters

### T

`T`

### U

`U`

## Properties

### batchSize? {#batchsize}

> `optional` **batchSize?**: `number`

Number of entities to read and write per batch.

#### Default

```ts
100
```

***

### transformEntityProperty? {#transformentityproperty}

> `optional` **transformEntityProperty?**: (`schema1Property`, `schemaProperty2`, `value`) => `unknown`

Optional transformation for properties, usually only called for object and array types.

#### Parameters

##### schema1Property

`IEntitySchemaProperty`\<`T`\>

The property schema in the old schema.

##### schemaProperty2

`IEntitySchemaProperty`\<`U`\>

The property schema in the new schema.

##### value

`unknown`

The value of the property in the old schema.

#### Returns

`unknown`

The transformed value to match the new schema.

***

### onPartitionProgress? {#onpartitionprogress}

> `optional` **onPartitionProgress?**: (`rowTotal`, `rowIndex`) => `Promise`\<`void`\>

Called for each partition for progress tracking.

#### Parameters

##### rowTotal

`number`

The total number of rows to migrate.

##### rowIndex

`number`

The number of rows migrated so far.

#### Returns

`Promise`\<`void`\>

***

### onStepProgress? {#onstepprogress}

> `optional` **onStepProgress?**: (`stepKey`, `itemTotal`, `itemIndex`) => `Promise`\<`void`\>

Called for overall progress tracking.

#### Parameters

##### stepKey

`string`

The key representing the current step in the migration.

##### itemTotal

`number`

The total number of items in this progress.

##### itemIndex

`number`

The number of items processed so far.

#### Returns

`Promise`\<`void`\>
