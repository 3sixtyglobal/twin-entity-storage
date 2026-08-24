# Interface: IMongoDbEntityStorageConnectorConfig

Configuration for the MongoDb Entity Storage Connector.

## Properties

### host {#host}

> **host**: `string`

The host for the MongoDb instance.

***

### port? {#port}

> `optional` **port?**: `number`

The port for the MongoDb instance.

***

### user? {#user}

> `optional` **user?**: `string`

The user for the MongoDb instance.

***

### password? {#password}

> `optional` **password?**: `string`

The password for the MongoDb instance.

***

### database {#database}

> **database**: `string`

The name of the database to be used.

***

### collection {#collection}

> **collection**: `string`

The name of the collection to be used.

***

### pool? {#pool}

> `optional` **pool?**: `object`

Optional connection pool configuration.

#### maxPoolSize?

> `optional` **maxPoolSize?**: `number`

Maximum number of connections in the pool.

##### Default

```ts
100
```

#### minPoolSize?

> `optional` **minPoolSize?**: `number`

Minimum number of connections to maintain in the pool.

##### Default

```ts
0
```

#### maxIdleTimeMs?

> `optional` **maxIdleTimeMs?**: `number`

Milliseconds a connection can remain idle before being removed.

#### waitQueueTimeoutMs?

> `optional` **waitQueueTimeoutMs?**: `number`

Milliseconds to wait for a connection before throwing.

***

### mutexTimeoutMs? {#mutextimeoutms}

> `optional` **mutexTimeoutMs?**: `number`

Milliseconds to wait for connector mutex locks before throwing.
