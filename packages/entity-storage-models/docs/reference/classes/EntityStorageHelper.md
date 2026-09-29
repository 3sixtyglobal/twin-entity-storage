# Class: EntityStorageHelper

Helper class for performing schema migrations between two connectors.

## Constructors

### Constructor

> **new EntityStorageHelper**(): `EntityStorageHelper`

#### Returns

`EntityStorageHelper`

## Properties

### CLASS\_NAME {#class_name}

> `readonly` `static` **CLASS\_NAME**: `string`

Runtime name for the class.

## Methods

### tryShortSplit() {#tryshortsplit}

> `static` **tryShortSplit**(`partitionContextIds`, `partitionId`, `separator?`): `IContextIds` \| `undefined`

Split a stored partition id into context ids when its depth matches the configured partition keys.

#### Parameters

##### partitionContextIds

`string`[]

The configured partition context id keys.

##### partitionId

`string`

The stored partition id.

##### separator?

`string` = `"/"`

The separator used between the partition id parts.

#### Returns

`IContextIds` \| `undefined`

The context ids, or undefined when the partition id depth does not match.

***

### prepareEntity() {#prepareentity}

> `static` **prepareEntity**\<`T`\>(`entity`, `schema`, `additionalProperties?`, `options?`): `T`

Prepare the entity by handling undefined and null values and validating it against the schema.

#### Type Parameters

##### T

`T`

#### Parameters

##### entity

`T`

The entity to handle undefined and null values for.

##### schema

`IEntitySchema`\<`T`\>

The schema to validate the entity against.

##### additionalProperties?

`object`[]

Optional list of additional properties to set on the entity.

##### options?

Options controlling how null/undefined optional properties are stored.

###### nullBehavior?

`"omit"` \| `"nullify"`

"omit" strips null/undefined optional properties before writing
(NoSQL - avoids index-key type errors). "nullify" converts undefined to null (SQL - the default).

#### Returns

`T`

The entity with undefined and null values handled.

***

### unPrepareEntity() {#unprepareentity}

> `static` **unPrepareEntity**\<`T`\>(`entity`, `removeProperties?`): `T`

Un-prepare the entity by removing null values.

#### Type Parameters

##### T

`T`

#### Parameters

##### entity

`Partial`\<`T`\> \| `undefined`

The entity to handle undefined and null values for.

##### removeProperties?

`string`[]

Optional list of properties to remove from the entity.

#### Returns

`T`

The entity with undefined and null values handled.

***

### validateSortProperties() {#validatesortproperties}

> `static` **validateSortProperties**\<`T`\>(`schema`, `sortProperties?`): `void`

Validate that every sort property in the list is indexed in the schema (isPrimary, isSecondary,
or has a default sortDirection), throwing sortNotIndexed for the first violation found.

#### Type Parameters

##### T

`T`

#### Parameters

##### schema

`IEntitySchema`\<`T`\>

The entity schema to validate against.

##### sortProperties?

`object`[]

The sort properties to check.

#### Returns

`void`

#### Throws

GeneralError If a sort property is not indexed in the schema.

***

### validateProperties() {#validateproperties}

> `static` **validateProperties**\<`T`\>(`schema`, `properties?`): `void`

Validate that every property in the list exists in the schema, throwing propertyNotInSchema
for the first property that is not found.

#### Type Parameters

##### T

`T`

#### Parameters

##### schema

`IEntitySchema`\<`T`\>

The entity schema to validate against.

##### properties?

keyof `T`[]

The properties to check.

#### Returns

`void`

#### Throws

GeneralError If a property does not exist in the schema.

***

### validateConditionProperties() {#validateconditionproperties}

> `static` **validateConditionProperties**\<`T`\>(`schema`, `condition`): `void`

Validate that every leaf property in an EntityCondition tree is a recognised schema property.
The root part of a dot-notation path must exist in the schema and be of type object or array.

#### Type Parameters

##### T

`T`

#### Parameters

##### schema

`IEntitySchema`\<`T`\>

The entity schema to validate against.

##### condition

`EntityCondition`\<`T`\> \| `undefined`

The condition tree to validate, may be undefined.

#### Returns

`void`

#### Throws

GeneralError with message key "unknownPropertyInConditionProperty" if the root property is not in the schema.

#### Throws

GeneralError with message key "invalidConditionPropertyPath" if dot-notation is used on a non-object/array property.

***

### validateConditions() {#validateconditions}

> `static` **validateConditions**\<`T`\>(`schema`, `conditions`): `void`

Validate that every property in a conditions array is a recognised schema property.

#### Type Parameters

##### T

`T`

#### Parameters

##### schema

`IEntitySchema`\<`T`\>

The entity schema to validate against.

##### conditions

`object`[] \| `undefined`

The conditions array to validate, may be undefined.

#### Returns

`void`

#### Throws

GeneralError with message key "unknownPropertyInConditions" if validation fails.

***

### validateJoinOptions() {#validatejoinoptions}

> `static` **validateJoinOptions**\<`T`, `U`\>(`schema`, `joinSchema`, `joinOptions`): `void`

Validate the options for a join query against the schemas of both sides of the join.

#### Type Parameters

##### T

`T`

##### U

`U`

#### Parameters

##### schema

`IEntitySchema`\<`T`\>

The schema of the primary entities.

##### joinSchema

`IEntitySchema`\<`U`\>

The schema of the entities being joined to.

##### joinOptions

[`IEntityStorageJoinOptions`](../interfaces/IEntityStorageJoinOptions.md)\<`T`, `U`\>

The join options to validate.

#### Returns

`void`

#### Throws

GuardError If the join options, or the properties to join on, are missing.

#### Throws

ValidationError If the limit is not a positive integer.

#### Throws

GeneralError If a property, condition or sort property is not valid for its schema, or
a group property is supplied along with properties or sort properties which reference anything
other than the group property.

***

### normalizeJoinOptions() {#normalizejoinoptions}

> `static` **normalizeJoinOptions**\<`T`, `U`\>(`joinOptions`): [`INormalizedJoinOptions`](../interfaces/INormalizedJoinOptions.md)\<`T`, `U`\>

Reduce a set of join options to the parts which decide where a page starts and ends, in a
stable form. Two queries which page the same way normalise to the same value, and anything
which moves the position a cursor refers to changes it.

#### Type Parameters

##### T

`T`

##### U

`U`

#### Parameters

##### joinOptions

[`IEntityStorageJoinOptions`](../interfaces/IEntityStorageJoinOptions.md)\<`T`, `U`\>

The join options the page was produced from.

#### Returns

[`INormalizedJoinOptions`](../interfaces/INormalizedJoinOptions.md)\<`T`, `U`\>

The normalised options.

***

### encodeCursor() {#encodecursor}

> `static` **encodeCursor**\<`T`, `U`\>(`normalizedOptions`, `position`): `string`

Create the opaque cursor for the next page. The cursor carries the key set of the last entity
on the page rather than an offset, and is bound to the query which produced it
so it can be rejected rather than silently restarting somewhere else.

#### Type Parameters

##### T

`T`

##### U

`U`

#### Parameters

##### normalizedOptions

[`INormalizedJoinOptions`](../interfaces/INormalizedJoinOptions.md)\<`T`, `U`\>

The normalised options of the query, from normalizeJoinOptions.

##### position

`unknown`

The position the next page starts at, which a connector reads back as it
wrote it, whether that is a key set or the cursor of the storage it paged.

#### Returns

`string`

The encoded cursor.

***

### decodeCursor() {#decodecursor}

> `static` **decodeCursor**\<`T`, `U`, `P`\>(`normalizedOptions`, `cursor?`): `P` \| `undefined`

Decode a cursor produced by encodeCursor.

#### Type Parameters

##### T

`T`

##### U

`U`

##### P

`P` = `unknown`

#### Parameters

##### normalizedOptions

[`INormalizedJoinOptions`](../interfaces/INormalizedJoinOptions.md)\<`T`, `U`\>

The normalised options of the query, from normalizeJoinOptions.

##### cursor?

`string`

The cursor supplied by the caller.

#### Returns

`P` \| `undefined`

The position the page starts at, or undefined when no cursor was supplied.

#### Throws

GeneralError with message key "cursorInvalid" when the cursor is malformed or was
produced by a different query.

***

### normalizeConditionValues() {#normalizeconditionvalues}

> `static` **normalizeConditionValues**\<`T`\>(`condition`): `EntityCondition`\<`T`\>

Deep-clone condition tree and normalise null/undefined to undefined on Equals/NotEquals leaves
so in-memory evaluation matches stored-absent semantics (optional absent props are omitted/undefined).

#### Type Parameters

##### T

`T`

#### Parameters

##### condition

`EntityCondition`\<`T`\>

The user-supplied condition (not mutated).

#### Returns

`EntityCondition`\<`T`\>

A clone safe to pass to check.
