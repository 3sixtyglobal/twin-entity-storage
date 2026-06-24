# Function: entityStorageCount()

> **entityStorageCount**(`httpRequestContext`, `componentName`, `request`): `Promise`\<`IEntityStorageCountResponse`\>

Count the entries in entity storage.

## Parameters

### httpRequestContext

`IHttpRequestContext`

The request context for the API.

### componentName

`string`

The name of the component to use in the routes.

### request

`IEntityStorageCountRequest`

The request.

## Returns

`Promise`\<`IEntityStorageCountResponse`\>

The response object with additional http response properties.
