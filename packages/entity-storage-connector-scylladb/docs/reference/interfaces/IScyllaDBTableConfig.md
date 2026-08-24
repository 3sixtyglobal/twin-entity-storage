# Interface: IScyllaDBTableConfig

Definition of MySQL DB configuration.

## Extends

- [`IScyllaDBConfig`](IScyllaDBConfig.md)

## Extended by

- [`IScyllaDBViewConfig`](IScyllaDBViewConfig.md)

## Properties

### hosts {#hosts}

> **hosts**: `string`[]

The host to contact to.

#### Inherited from

[`IScyllaDBConfig`](IScyllaDBConfig.md).[`hosts`](IScyllaDBConfig.md#hosts)

***

### localDataCenter {#localdatacenter}

> **localDataCenter**: `string`

The local data center.

#### Inherited from

[`IScyllaDBConfig`](IScyllaDBConfig.md).[`localDataCenter`](IScyllaDBConfig.md#localdatacenter)

***

### keyspace {#keyspace}

> **keyspace**: `string`

The keyspace to use.

#### Inherited from

[`IScyllaDBConfig`](IScyllaDBConfig.md).[`keyspace`](IScyllaDBConfig.md#keyspace)

***

### port? {#port}

> `optional` **port?**: `number`

The port to connect to.

#### Default

```ts
9042
```

#### Inherited from

[`IScyllaDBConfig`](IScyllaDBConfig.md).[`port`](IScyllaDBConfig.md#port)

***

### pool? {#pool}

> `optional` **pool?**: `object`

Optional connection pool configuration.

#### coreConnectionsPerHost?

> `optional` **coreConnectionsPerHost?**: `number`

Number of connections per local host.

##### Default

```ts
1
```

#### maxRequestsPerConnection?

> `optional` **maxRequestsPerConnection?**: `number`

Maximum number of requests per connection.

##### Default

```ts
1024
```

#### Inherited from

[`IScyllaDBConfig`](IScyllaDBConfig.md).[`pool`](IScyllaDBConfig.md#pool)

***

### mutexTimeoutMs? {#mutextimeoutms}

> `optional` **mutexTimeoutMs?**: `number`

Milliseconds to wait for connector mutex locks before throwing.

#### Inherited from

[`IScyllaDBConfig`](IScyllaDBConfig.md).[`mutexTimeoutMs`](IScyllaDBConfig.md#mutextimeoutms)

***

### tableName {#tablename}

> **tableName**: `string`

The name of the table for the storage.

#### Default

```ts
To the camel case of the entity name.
```
