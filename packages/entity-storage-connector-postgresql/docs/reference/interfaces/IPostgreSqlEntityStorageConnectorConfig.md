# Interface: IPostgreSqlEntityStorageConnectorConfig

Configuration for the PostgreSql Entity Storage Connector.

## Properties

### host {#host}

> **host**: `string`

The host for the PostgreSql instance.

***

### port? {#port}

> `optional` **port?**: `number`

The port for the PostgreSql instance.

***

### user {#user}

> **user**: `string`

The user for the PostgreSql instance.

***

### password {#password}

> **password**: `string`

The password for the PostgreSql instance.

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

#### max?

> `optional` **max?**: `number`

Maximum number of connections in the pool.

##### Default

```ts
10
```

#### idleTimeout?

> `optional` **idleTimeout?**: `number`

Seconds a connection can remain idle before being closed.

#### connectTimeout?

> `optional` **connectTimeout?**: `number`

Seconds to wait when establishing a connection.

##### Default

```ts
30
```

#### maxLifetime?

> `optional` **maxLifetime?**: `number`

Maximum seconds a connection can remain open.

***

### mutexTimeoutMs? {#mutextimeoutms}

> `optional` **mutexTimeoutMs?**: `number`

Milliseconds to wait for connector mutex locks before throwing.
