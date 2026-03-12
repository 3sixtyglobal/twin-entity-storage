# Interface: IFileEntityStorageConnectorConstructorOptions

Options for the File Entity Storage Connector constructor.

## Properties

### entitySchema {#entityschema}

> **entitySchema**: `string`

The name of the entity schema.

***

### partitionContextIds? {#partitioncontextids}

> `optional` **partitionContextIds**: `string`[]

The keys to use from the context ids to create partitions.

***

### config {#config}

> **config**: [`IFileEntityStorageConnectorConfig`](IFileEntityStorageConnectorConfig.md)

The configuration for the connector.
