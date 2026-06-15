# Interface: IMemoryEntityStorageConnectorConstructorOptions

Options for the Memory Entity Storage Connector constructor.

## Properties

### entitySchema {#entityschema}

> **entitySchema**: `string`

The schema for the entity.

***

### partitionContextIds? {#partitioncontextids}

> `optional` **partitionContextIds?**: `string`[]

The keys to use from the context ids to create partitions.

***

### initialCapacityBytes? {#initialcapacitybytes}

> `optional` **initialCapacityBytes?**: `number`

Initial capacity in bytes for the shared entity buffer.

#### Default

```ts
16 MiB.
```

***

### maxCapacityBytes? {#maxcapacitybytes}

> `optional` **maxCapacityBytes?**: `number`

Maximum JSON payload size in bytes for the shared entity buffer.

#### Default

```ts
256 MiB.
```
