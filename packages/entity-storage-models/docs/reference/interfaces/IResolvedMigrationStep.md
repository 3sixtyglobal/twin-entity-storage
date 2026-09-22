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

### transformEntity? {#transformentity}

> `optional` **transformEntity?**: [`EntityTransformer`](../type-aliases/EntityTransformer.md)\<`T`\>

Optional whole-entity transform applied to the source entity before the diff runs,
so a step can supply a value for a property the source shape does not carry. Its output
is the entity the diff and the other two hooks receive.

#### Param

**entity**

The entity in the step's source shape.

#### Returns

The entity, still in the step's source shape.

***

### transformEntityProperty? {#transformentityproperty}

> `optional` **transformEntityProperty?**: [`EntityPropertyTransformer`](../type-aliases/EntityPropertyTransformer.md)\<`T`, `U`\>

Optional transformation for properties, usually only called for object and array types.

#### Param

**schema1Property**

The property schema in the old schema.

#### Param

**schemaProperty2**

The property schema in the new schema.

#### Param

**value**

The value of the property in the old schema.

#### Returns

The transformed value to match the new schema.

***

### removeEntityProperty? {#removeentityproperty}

> `optional` **removeEntityProperty?**: [`EntityPropertyRemover`](../type-aliases/EntityPropertyRemover.md)\<`T`\>

Optional hook called when properties are dropped during migration.
Receives the entity and the list of removed property schemas, allowing callers to
observe or record values before they are discarded.

#### Param

**entity**

The entity being migrated, after transformEntity when one is set.

#### Param

**removedProperties**

The property schemas that were dropped.
