# Interface: IEntityStorageRemoveRequest

Remove an entry from entity storage.

## Properties

### pathParams {#pathparams}

> **pathParams**: `object`

The parameters from the path.

#### id

> **id**: `string`

The id of the entity to remove.

***

### query? {#query}

> `optional` **query?**: `object`

The query parameters.

#### conditions?

> `optional` **conditions?**: `string`

The optional conditions to match for the entity, JSON encoded array of property/value pairs.
