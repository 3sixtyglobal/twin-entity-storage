# Interface: IMongoDbEntityStorageConnectorConstructorOptions

The options for the MongoDb entity storage connector constructor.

## Properties

### entitySchema {#entityschema}

> **entitySchema**: `string`

The schema for the entity.

***

### partitionContextIds? {#partitioncontextids}

> `optional` **partitionContextIds**: `string`[]

The keys to use from the context ids to create partitions.

***

### loggingComponentType? {#loggingcomponenttype}

> `optional` **loggingComponentType**: `string`

The type of logging component to use.

***

### config {#config}

> **config**: [`IMongoDbEntityStorageConnectorConfig`](IMongoDbEntityStorageConnectorConfig.md)

The configuration for the connector.
