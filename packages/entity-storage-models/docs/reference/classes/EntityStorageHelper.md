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
(NoSQL — avoids index-key type errors). "nullify" converts undefined to null (SQL — the default).

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
