# Interface: IMySqlEntityStorageConnectorConstructorOptions

The options for the MySql entity storage connector constructor.

## Properties

### entitySchema {#entityschema}

> **entitySchema**: `string`

The schema for the entity.

***

### partitionContextIds? {#partitioncontextids}

> `optional` **partitionContextIds?**: `string`[]

The keys to use from the context ids to create partitions.

***

### loggingComponentType? {#loggingcomponenttype}

> `optional` **loggingComponentType?**: `string`

The type of logging component to use.

#### Default

```ts
logging
```

***

### config {#config}

> **config**: [`IMySqlEntityStorageConnectorConfig`](IMySqlEntityStorageConnectorConfig.md)

The configuration for the connector.
