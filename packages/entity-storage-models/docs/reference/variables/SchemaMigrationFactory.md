# Variable: SchemaMigrationFactory

> `const` **SchemaMigrationFactory**: `Factory`\<[`ISchemaMigration`](../interfaces/ISchemaMigration.md)\<`unknown`, `unknown`\>\>

Factory for optional per-step migration overrides.

Only register an entry when a version step requires property renames or a custom
transform hook. For purely structural changes (add/remove/type-change) the
SchemaVersionService diffs the two versioned schema classes automatically
without needing any factory entry.

Keys follow the convention "BaseSchemaName_fromVersion_toVersion",
for example "MyEntity_0_1" for the step that migrates MyEntity from version 0 to 1.
