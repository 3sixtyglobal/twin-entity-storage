# Interface: ISchemaMigration\<T, U\>

Optional per-step override for a single version-to-version migration.
Only register an entry in SchemaMigrationFactory when a step requires property
renames or a custom object/array transform. For purely structural changes
(add/remove/type-change fields) no entry is needed — the runner diffs the two
versioned schema classes (e.g. MyEntityV0 vs MyEntityV1) from EntitySchemaFactory
automatically.

Register under the key "<BaseSchemaName>_<fromVersion>_<toVersion>"
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

> `optional` **transformEntityProperty?**: (`schema1Property`, `schemaProperty2`, `value`) => `unknown`

Optional per-property transformer for object/array properties that cannot be
automatically coerced. T is the source entity type, U is the target entity type.

#### Parameters

##### schema1Property

`IEntitySchemaProperty`\<`T`\>

##### schemaProperty2

`IEntitySchemaProperty`\<`U`\>

##### value

`unknown`

#### Returns

`unknown`
