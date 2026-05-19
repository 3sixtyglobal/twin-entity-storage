# Class: EntityHelper

Helper class for performing schema migrations between two connectors.

## Constructors

### Constructor

> **new EntityHelper**(): `EntityHelper`

#### Returns

`EntityHelper`

## Properties

### CLASS\_NAME {#class_name}

> `readonly` `static` **CLASS\_NAME**: `string`

Runtime name for the class.

## Methods

### prepareEntity() {#prepareentity}

> `static` **prepareEntity**\<`T`\>(`entity`, `schema`, `additionalProperties?`): `T`

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

### normalizeConditionValues() {#normalizeconditionvalues}

> `static` **normalizeConditionValues**\<`T`\>(`condition`): `EntityCondition`\<`T`\>

Deep-clone condition tree and map `undefined` to `null` on Equals/NotEquals leaves
so in-memory evaluation matches stored-null semantics (optional absent props are stored as null).

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
