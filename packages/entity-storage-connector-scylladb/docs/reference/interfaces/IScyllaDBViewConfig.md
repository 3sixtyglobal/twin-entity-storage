# Interface: IScyllaDBViewConfig

Definition of ScyllaDB view configuration.

## Extends

- [`IScyllaDBTableConfig`](IScyllaDBTableConfig.md)

## Properties

### hosts {#hosts}

> **hosts**: `string`[]

The host to contact to.

#### Inherited from

[`IScyllaDBTableConfig`](IScyllaDBTableConfig.md).[`hosts`](IScyllaDBTableConfig.md#hosts)

***

### localDataCenter {#localdatacenter}

> **localDataCenter**: `string`

The local data center.

#### Inherited from

[`IScyllaDBTableConfig`](IScyllaDBTableConfig.md).[`localDataCenter`](IScyllaDBTableConfig.md#localdatacenter)

***

### keyspace {#keyspace}

> **keyspace**: `string`

The keyspace to use.

#### Inherited from

[`IScyllaDBTableConfig`](IScyllaDBTableConfig.md).[`keyspace`](IScyllaDBTableConfig.md#keyspace)

***

### port? {#port}

> `optional` **port?**: `number`

The port to connect to.

#### Default

```ts
9042
```

#### Inherited from

[`IScyllaDBTableConfig`](IScyllaDBTableConfig.md).[`port`](IScyllaDBTableConfig.md#port)

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

[`IScyllaDBTableConfig`](IScyllaDBTableConfig.md).[`pool`](IScyllaDBTableConfig.md#pool)

***

### mutexTimeoutMs? {#mutextimeoutms}

> `optional` **mutexTimeoutMs?**: `number`

Milliseconds to wait for connector mutex locks before throwing.

#### Inherited from

[`IScyllaDBTableConfig`](IScyllaDBTableConfig.md).[`mutexTimeoutMs`](IScyllaDBTableConfig.md#mutextimeoutms)

***

### tableName {#tablename}

> **tableName**: `string`

The name of the table for the storage.

#### Default

```ts
To the camel case of the entity name.
```

#### Inherited from

[`IScyllaDBTableConfig`](IScyllaDBTableConfig.md).[`tableName`](IScyllaDBTableConfig.md#tablename)

***

### viewName {#viewname}

> **viewName**: `string`

The name of view.

#### Default

```ts
To the camel case of the entity name with View appended.
```
