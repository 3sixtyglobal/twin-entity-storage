# Interface: IScyllaDBConfig

ScyllaDB Configuration.

## Extended by

- [`IScyllaDBTableConfig`](IScyllaDBTableConfig.md)

## Properties

### hosts {#hosts}

> **hosts**: `string`[]

The host to contact to.

***

### localDataCenter {#localdatacenter}

> **localDataCenter**: `string`

The local data center.

***

### keyspace {#keyspace}

> **keyspace**: `string`

The keyspace to use.

***

### port? {#port}

> `optional` **port?**: `number`

The port to connect to.

#### Default

```ts
9042
```

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

***

### mutexTimeoutMs? {#mutextimeoutms}

> `optional` **mutexTimeoutMs?**: `number`

Milliseconds to wait for connector mutex locks before throwing.
