# Interface: ISchemaVersionServiceConfig

Constructor options config for SchemaVersionService.

## Properties

### enabled? {#enabled}

> `optional` **enabled?**: `boolean`

Whether schema migration is enabled. When false the service detects pending migrations
and logs a warning for each lagging schema but does not apply any changes.

#### Default

```ts
true
```

***

### batchSize? {#batchsize}

> `optional` **batchSize?**: `number`

The batch size for processing schema versions.
