# Type Alias: EntityTransformer\<T\>

> **EntityTransformer**\<`T`\> = (`entity`) => `T` \| `Promise`\<`T`\>

Type for the optional transformEntity function.
Transforms a whole entity before a migration step diffs it, so a step can supply
values the source shape does not carry. Receives and returns the entity in the
step's source shape.

## Type Parameters

### T

`T` = `unknown`

## Parameters

### entity

`T`

## Returns

`T` \| `Promise`\<`T`\>
