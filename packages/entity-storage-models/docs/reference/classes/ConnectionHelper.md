# Class: ConnectionHelper

Helper for managing shared database client instances via SharedStore.
Provides a consistent acquire/release lifecycle so that one client is
shared across all connector instances that target the same endpoint.

## Constructors

### Constructor

> **new ConnectionHelper**(): `ConnectionHelper`

#### Returns

`ConnectionHelper`

## Methods

### openClient() {#openclient}

> `static` **openClient**\<`TClient`\>(`storeKey`, `clientId`, `instanceId`, `mutexTimeoutMs`, `create`): `Promise`\<`TClient`\>

Acquire a reference to the shared client for the given endpoint, creating
it if no client exists yet. A mutex guards the read-modify-write on the
SharedStore entry so concurrent callers do not race.

#### Type Parameters

##### TClient

`TClient`

#### Parameters

##### storeKey

`string`

The SharedStore collection key, e.g. "mongoDbClients".

##### clientId

`string`

The endpoint-specific cache key.

##### instanceId

`string`

The unique ID of the calling connector instance.

##### mutexTimeoutMs

`number` \| `undefined`

Optional timeout for the mutex lock in milliseconds.

##### create

() => `Promise`\<`TClient`\>

Factory that constructs and connects a new client.

#### Returns

`Promise`\<`TClient`\>

The shared client.

***

### closeClient() {#closeclient}

> `static` **closeClient**\<`TClient`\>(`storeKey`, `clientId`, `instanceId`, `mutexTimeoutMs`, `destroy`): `Promise`\<`void`\>

Release this instance's reference to the shared client. When the last
reference is removed the destroy callback is called to tear down the
underlying connection.

#### Type Parameters

##### TClient

`TClient`

#### Parameters

##### storeKey

`string`

The SharedStore collection key.

##### clientId

`string`

The endpoint-specific cache key.

##### instanceId

`string`

The unique ID of the calling connector instance.

##### mutexTimeoutMs

`number` \| `undefined`

Optional timeout for the mutex lock in milliseconds.

##### destroy

(`client`) => `Promise`\<`void`\>

Destructor that tears down the client when no references remain.

#### Returns

`Promise`\<`void`\>
