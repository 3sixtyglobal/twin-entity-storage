# Interface: IFirestoreEntityStorageConnectorConstructorOptions

Options for the Firestore Entity Storage Connector constructor.

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

The type of logging component to use, defaults to no logging.

***

### config {#config}

> **config**: [`IFirestoreEntityStorageConnectorConfig`](IFirestoreEntityStorageConnectorConfig.md)

The configuration for the connector.
