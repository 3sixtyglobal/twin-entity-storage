# Interface: IFirestoreEntityStorageConnectorConfig

Configuration for the Firestore Entity Storage Connector.

## Properties

### projectId {#projectid}

> **projectId**: `string`

The GCP project ID.

***

### databaseId? {#databaseid}

> `optional` **databaseId?**: `string`

The database ID, if omitted default database will be used.

***

### collectionName {#collectionname}

> **collectionName**: `string`

The name of the collection for the storage.

***

### credentials? {#credentials}

> `optional` **credentials?**: `string`

The GCP credentials, a base64 encoded version of the JWTInput data type.

***

### endpoint? {#endpoint}

> `optional` **endpoint?**: `string`

It's usually only used with an emulator (e.g., "localhost:8080").

***

### settings? {#settings}

> `optional` **settings?**: `object`

Optional settings for Firestore client initialization.

#### maxIdleChannels?

> `optional` **maxIdleChannels?**: `number`

The maximum number of idle channels to keep open.

#### timeout?

> `optional` **timeout?**: `number`

The custom timeout for requests (in milliseconds).

***

### mutexTimeoutMs? {#mutextimeoutms}

> `optional` **mutexTimeoutMs?**: `number`

Milliseconds to wait for connector mutex locks before throwing.
