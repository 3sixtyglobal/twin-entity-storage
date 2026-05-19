# Interface: IMigrationResult

The result returned by a connector's migrate method.

## Properties

### migrated {#migrated}

> **migrated**: `number`

Total number of entities successfully written to the new schema.

***

### skipped {#skipped}

> **skipped**: `number`

Number of entities that were skipped because no change was required.

***

### errors {#errors}

> **errors**: `IError`[]

Per-entity errors encountered during the migration.
The id of the failing entity is carried in each error's data property,
e.g. data: { id: "..." }.
