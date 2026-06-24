# Function: entityStorageRemoveBatch()

> **entityStorageRemoveBatch**(`httpRequestContext`, `componentName`, `request`): `Promise`\<`INoContentResponse`\>

Remove multiple entries from entity storage by id.

## Parameters

### httpRequestContext

`IHttpRequestContext`

The request context for the API.

### componentName

`string`

The name of the component to use in the routes.

### request

`IEntityStorageRemoveBatchRequest`

The request.

## Returns

`Promise`\<`INoContentResponse`\>

The response object with additional http response properties.
