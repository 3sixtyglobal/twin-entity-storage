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

***

### generateCompositeName() {#generatecompositename}

> `static` **generateCompositeName**\<`T`\>(`tableName`, `indexProperties`, `maxIdentifierLength?`): `string`

Generate a deterministic, length-bounded index name for a composite index group.
The name is derived from the group's property names and sort directions in index order,
so two groups which index the same columns the same way resolve to the same name. The
column list is marked with a separator which cannot appear in an entity property name, so
a composite index name can never collide with a single-column index name.

#### Type Parameters

##### T

`T`

#### Parameters

##### tableName

`string`

The fully-qualified table name, including any deployment prefix.

##### indexProperties

`object`[]

The properties of the index group, ordered by their index position.

##### maxIdentifierLength?

`number` = `IndexHelper.DEFAULT_MAX_IDENTIFIER_LENGTH`

The maximum identifier length allowed by the target database.

#### Returns

`string`

A deterministic index name no longer than maxIdentifierLength characters.

***

### generateLegacyName() {#generatelegacyname}

> `static` **generateLegacyName**(`tableName`, `columnName`, `maxIdentifierLength?`): `string`

Generate the unbounded index name used before names were hashed, so connectors can recognise their own legacy indexes.
TODO: remove together with the connectors' legacy index handling.

#### Parameters

##### tableName

`string`

The fully-qualified table name, including any deployment prefix.

##### columnName

`string`

The column being indexed.

##### maxIdentifierLength?

`number`

Optional length the database silently truncated identifiers to.

#### Returns

`string`

The legacy index name, truncated to maxIdentifierLength when supplied.
