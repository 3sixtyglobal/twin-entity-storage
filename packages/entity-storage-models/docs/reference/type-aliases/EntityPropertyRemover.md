# Type Alias: EntityPropertyRemover\<T\>

> **EntityPropertyRemover**\<`T`\> = (`entity`, `removedProperties`) => `void` \| `Promise`\<`void`\>

Type for the optional removeEntityProperty function.
Called during migration when properties are dropped, allowing callers to
observe which properties were removed and act on their values before they are lost.

## Type Parameters

### T

`T` = `unknown`

## Parameters

### entity

`T`

### removedProperties

`IEntitySchemaProperty`\<`T`\>[]

## Returns

`void` \| `Promise`\<`void`\>
