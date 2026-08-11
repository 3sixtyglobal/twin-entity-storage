# Interface: ICosmosDbEntityStorageConnectorConfig

Configuration for the Cosmos DB Entity Storage Connector.

## Properties

### endpoint {#endpoint}

> **endpoint**: `string`

The endpoint for the Cosmos DB instance.

***

### key {#key}

> **key**: `string`

The primary key for the Cosmos DB instance.

***

### databaseId {#databaseid}

> **databaseId**: `string`

The ID of the database to be used.

***

### containerId {#containerid}

> **containerId**: `string`

The ID of the container for the storage.

***

### offerThroughput? {#offerthroughput}

> `optional` **offerThroughput?**: `number`

The offer throughput for the container.

***

### disableEndpointDiscovery? {#disableendpointdiscovery}

> `optional` **disableEndpointDiscovery?**: `boolean`

Disable endpoint discovery so the SDK always uses the configured endpoint.
Required when using the CosmosDB emulator behind a port-mapped Docker container,
because the emulator's account response advertises its internal container port
instead of the mapped host port.

***

### mutexTimeoutMs? {#mutextimeoutms}

> `optional` **mutexTimeoutMs?**: `number`

Milliseconds to wait for connector mutex locks before throwing.
