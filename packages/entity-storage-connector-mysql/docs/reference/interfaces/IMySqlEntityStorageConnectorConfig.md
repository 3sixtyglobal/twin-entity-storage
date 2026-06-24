# Interface: IMySqlEntityStorageConnectorConfig

Configuration for the MySql Entity Storage Connector.

## Properties

### host {#host}

> **host**: `string`

The host for the MySql instance.

***

### port? {#port}

> `optional` **port?**: `number`

The port for the MySql instance.

***

### user {#user}

> **user**: `string`

The user for the MySql instance.

***

### password {#password}

> **password**: `string`

The password for the MySql instance.

***

### database {#database}

> **database**: `string`

The name of the database to be used.

***

### tableName {#tablename}

> **tableName**: `string`

The name of the table to be used.

***

### pool? {#pool}

> `optional` **pool?**: `object`

Optional connection pool configuration.

#### connectionLimit?

> `optional` **connectionLimit?**: `number`

Maximum number of connections in pool.

##### Default

```ts
10
```

#### maxIdle?

> `optional` **maxIdle?**: `number`

Maximum number of idle connections.

##### Default

```ts
10
```

#### idleTimeout?

> `optional` **idleTimeout?**: `number`

Time in ms before removing idle connection.

##### Default

```ts
60000 (1 minute)
```

#### enableKeepAlive?

> `optional` **enableKeepAlive?**: `boolean`

Enable TCP keep-alive.

##### Default

```ts
true
```

#### waitForConnections?

> `optional` **waitForConnections?**: `boolean`

Wait for available connection when pool is full.

##### Default

```ts
true
```

#### queueLimit?

> `optional` **queueLimit?**: `number`

Maximum queued requests (0 = unlimited).

##### Default

```ts
0
```
