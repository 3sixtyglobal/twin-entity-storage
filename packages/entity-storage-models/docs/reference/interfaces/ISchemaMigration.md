# Interface: ISchemaMigration\<T, U\>

Optional per-step override for a single version-to-version migration.
Only register an entry in SchemaMigrationFactory when a step requires property
renames, a custom object/array transform, or a value the source row does not
carry at all. For purely structural changes (add/remove/type-change fields) no
entry is needed - the runner diffs the two versioned schema classes (e.g.
MyEntityV0 vs MyEntityV1) from EntitySchemaFactory automatically.

Register under the key "BaseSchemaName_fromVersion_toVersion"
e.g. "MyEntity_0_1" for the step that migrates from version 0 to version 1.
The key itself encodes the version pair; no version field is needed on the object.

## Type Parameters

### T

`T` = `unknown`

### U

`U` = `unknown`

## Properties

### renames? {#renames}

> `optional` **renames?**: `object`[]

Optional property renames to apply during this step.

#### from

> **from**: `string`

#### to

> **to**: `string`

***

### transformEntity? {#transformentity}

> `optional` **transformEntity?**: [`EntityTransformer`](../type-aliases/EntityTransformer.md)\<`T`\>

Optional whole-entity transform applied to the source entity before the diff runs,
so a step can supply a value for a property the source shape does not carry. Its output
is the entity the diff and the other two hooks receive. Runs inside the partition's
context, so it can read the context ids of the partition being migrated.

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

**entity**

The entity being migrated, after transformEntity when one is set.

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
