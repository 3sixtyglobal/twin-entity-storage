# Class: IndexHelper

Helper for generating bounded database index names.

## Constructors

### Constructor

> **new IndexHelper**(): `IndexHelper`

#### Returns

`IndexHelper`

## Properties

### DEFAULT\_MAX\_IDENTIFIER\_LENGTH {#default_max_identifier_length}

> `readonly` `static` **DEFAULT\_MAX\_IDENTIFIER\_LENGTH**: `number` = `63`

Default maximum identifier length.

## Methods

### generateName() {#generatename}

> `static` **generateName**(`tableName`, `columnName`, `maxIdentifierLength?`): `string`

Generate a deterministic, length-bounded index name from the table and column names.
The name is derived from a blake2b-256 hash of the combined input so it always fits
within the given identifier length limit regardless of table prefix or column name length.
Index names are scoped per table in both MySQL and PostgreSQL, so hash collisions
across different tables are not a concern.

#### Parameters

##### tableName

`string`

The fully-qualified table name, including any deployment prefix.

##### columnName

`string`

The column being indexed.

##### maxIdentifierLength?

`number` = `IndexHelper.DEFAULT_MAX_IDENTIFIER_LENGTH`

The maximum identifier length allowed by the target database.

#### Returns

`string`

A deterministic index name no longer than maxIdentifierLength characters.
