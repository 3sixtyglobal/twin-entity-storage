# Interface: IMemoryEntityStorageConnectorConstructorOptions

Options for the Memory Entity Storage Connector constructor.

## Properties

### entitySchema {#entityschema}

> **entitySchema**: `string`

The schema for the entity.

***

### partitionContextIds? {#partitioncontextids}

> `optional` **partitionContextIds?**: `string`[]

The keys to use from the context ids to create partitions.

***

### config {#config}

> **config**: [`IMemoryEntityStorageConnectorConfig`](IMemoryEntityStorageConnectorConfig.md)

Configuration for storage key and capacity settings.
