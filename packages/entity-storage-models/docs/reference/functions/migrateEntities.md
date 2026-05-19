# Function: migrateEntities()

> **migrateEntities**\<`T`\>(`source`, `target`, `diff`, `options?`): `Promise`\<[`IMigrationResult`](../interfaces/IMigrationResult.md)\>

Generic per-partition migration loop.

Reads entities from `source` in pages via `query()`, applies the schema
diff (or the caller-supplied `transformEntity`) at the entity level, then
writes transformed batches to `target` via `setBatch()`. On a batch-level
failure it falls back to single-entity writes so each failing entity
produces its own entry in `IMigrationResult.errors`.

IMPORTANT: both `query()` and `setBatch()` are partition-scoped — they
operate on the partition derived from the current `ContextIdStore`. This
helper therefore migrates only the **caller's current partition**. Callers
that need to migrate all partitions must invoke the connector's `migrate()`
once per partition (setting the appropriate context before each call).

## Type Parameters

### T

`T` = `unknown`

## Parameters

### source

[`IEntityStorageConnector`](../interfaces/IEntityStorageConnector.md)\<`T`\>

Connector to read from (current schema, already bootstrapped).

### target

[`IEntityStorageConnector`](../interfaces/IEntityStorageConnector.md)\<`T`\>

Connector to write to (new schema, already bootstrapped).

### diff

`IEntitySchemaDiff`

Schema diff used to add nullable defaults and drop removed
fields when `options.transformEntity` is not provided.

### options?

[`IMigrationOptions`](../interfaces/IMigrationOptions.md)

Optional migration controls (batchSize, transformEntity,
onProgress).

## Returns

`Promise`\<[`IMigrationResult`](../interfaces/IMigrationResult.md)\>

Aggregated migration result with migrated count and per-entity
errors.
