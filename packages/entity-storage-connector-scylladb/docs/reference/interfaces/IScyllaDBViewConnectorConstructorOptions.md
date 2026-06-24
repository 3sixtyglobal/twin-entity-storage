# Interface: IScyllaDBViewConnectorConstructorOptions

Options for the ScyllaDB View Connector constructor.

## Properties

### loggingComponentType? {#loggingcomponenttype}

> `optional` **loggingComponentType?**: `string`

The type of logging component to use, defaults to no logging.

***

### entitySchema {#entityschema}

> **entitySchema**: `string`

The name of the entity schema.

***

### partitionContextIds? {#partitioncontextids}

> `optional` **partitionContextIds?**: `string`[]

The keys to use from the context ids to create partitions.

***

### viewSchema {#viewschema}

> **viewSchema**: `string`

The name of the view schema.

***

### config {#config}

> **config**: [`IScyllaDBViewConfig`](IScyllaDBViewConfig.md)

The configuration for the connector.
