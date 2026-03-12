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

> `optional` **port**: `number`

The port to connect to.

#### Inherited from

[`IScyllaDBConfig`](IScyllaDBConfig.md).[`port`](IScyllaDBConfig.md#port)

***

### tableName? {#tablename}

> `optional` **tableName**: `string`

The name of the table for the storage.
