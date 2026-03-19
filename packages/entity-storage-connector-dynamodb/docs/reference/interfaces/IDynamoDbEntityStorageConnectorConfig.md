# Interface: IDynamoDbEntityStorageConnectorConfig

Configuration for the Dynamo DB Entity Storage Connector.

## Properties

### region {#region}

> **region**: `string`

The region for the AWS connection.

***

### authMode? {#authmode}

> `optional` **authMode?**: `"credentials"` \| `"pod"`

The authentication mode.
- "credentials": Use access key ID and secret access key.
- "pod": Use IAM role attached to the pod (e.g., in EKS).

#### Default

```ts
credentials
```

***

### accessKeyId? {#accesskeyid}

> `optional` **accessKeyId?**: `string`

The AWS access key ID.

***

### secretAccessKey? {#secretaccesskey}

> `optional` **secretAccessKey?**: `string`

The AWS secret access key.

***

### tableName {#tablename}

> **tableName**: `string`

The name of the table for the storage.

***

### endpoint? {#endpoint}

> `optional` **endpoint?**: `string`

AWS endpoint, not usually required but could be used for local DynamoDB instance e.g. http://localhost:10000.

***

### connectionTimeoutMs? {#connectiontimeoutms}

> `optional` **connectionTimeoutMs?**: `number`

The connection timeout in milliseconds.
