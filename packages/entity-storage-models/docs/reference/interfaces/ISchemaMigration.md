# Interface: ISchemaMigration\<T, U\>

Optional per-step override for a single version-to-version migration.
Only register an entry in SchemaMigrationFactory when a step requires property
renames or a custom object/array transform. For purely structural changes
(add/remove/type-change fields) no entry is needed — the runner diffs the two
versioned schema classes (e.g. MyEntityV0 vs MyEntityV1) from EntitySchemaFactory
automatically.

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
