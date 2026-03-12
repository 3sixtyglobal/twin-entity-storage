# Interface: IScyllaDBTableConnectorConstructorOptions

Options for the ScyllaDB Table Connector constructor.

## Properties

### loggingComponentType? {#loggingcomponenttype}

> `optional` **loggingComponentType**: `string`

The type of logging component to use, defaults to no logging.

***

### entitySchema {#entityschema}

> **entitySchema**: `string`

The name of the entity schema.

***

### partitionContextIds? {#partitioncontextids}

> `optional` **partitionContextIds**: `string`[]

The keys to use from the context ids to create partitions.

***

### config {#config}

> **config**: [`IScyllaDBTableConfig`](IScyllaDBTableConfig.md)

The configuration for the connector.
