# Interface: IFileEntityStorageConnectorConfig

Configuration for the File Entity Storage Connector.

## Properties

### directory {#directory}

> **directory**: `string`

The directory to use for storage.

***

### diskErrorThresholdBytes? {#diskerrorthresholdbytes}

> `optional` **diskErrorThresholdBytes?**: `number`

The number of free bytes below which the health check reports an error.
Defaults to 100 MB.

***

### diskWarningThresholdBytes? {#diskwarningthresholdbytes}

> `optional` **diskWarningThresholdBytes?**: `number`

The number of free bytes below which the health check reports a warning.
Defaults to 500 MB.
