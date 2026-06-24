# Interface: IMemoryEntityStorageConnectorConfig

Configuration for the Memory Entity Storage Connector.

## Properties

### storageKey {#storagekey}

> **storageKey**: `string`

Key to use for the shared buffer instead of the entity schema type.
Use this to give two connectors with the same entitySchema separate storage.

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

***

### mutexTimeoutMs? {#mutextimeoutms}

> `optional` **mutexTimeoutMs?**: `number`

Maximum milliseconds to wait for the per-directory write lock before throwing.
