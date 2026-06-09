# Interface: IResolvedMigrationStep\<T, U\>

A fully-resolved single migration step used by MigrationHelper.
The SchemaVersionService builds these by looking up versioned schema classes
from EntitySchemaFactory (e.g. MyEntityV0, MyEntityV1) before invoking the helper,
keeping factory knowledge out of the helper itself.

## Type Parameters

### T

`T` = `unknown`

The entity type. Defaults to `unknown`. Use a concrete entity type
when the step's source and target schemas are known at the call site.

### U

`U` = `unknown`

## Properties

### fromProperties {#fromproperties}

> **fromProperties**: `IEntitySchemaProperty`\<`T`\>[]

The property list of the entity at the start of this step (the "old" shape).
Sourced from the versioned schema class registered in EntitySchemaFactory,
e.g. EntitySchemaFactory.get("MyEntityV0").properties.

***

### toProperties {#toproperties}

> **toProperties**: `IEntitySchemaProperty`\<`U`\>[]

The property list of the entity at the end of this step (the "new" shape).
For the final step this is the live current schema's properties.

***

### renames? {#renames}

> `optional` **renames?**: `object`[]

Optional property renames for this step, forwarded to EntitySchemaDiffHelper.diff.

#### from

> **from**: `string`

#### to

> **to**: `string`

***

### transformEntityProperty? {#transformentityproperty}

> `optional` **transformEntityProperty?**: [`EntityPropertyTransformer`](../type-aliases/EntityPropertyTransformer.md)\<`T`, `U`\>

Optional transformation for properties, usually only called for object and array types.

#### Param

The property schema in the old schema.

#### Param

The property schema in the new schema.

#### Param

The value of the property in the old schema.

#### Returns

The transformed value to match the new schema.
