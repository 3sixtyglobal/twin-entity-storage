# Interface: IEntityStorageGetRequest

Get an entry from entity storage.

## Properties

### pathParams {#pathparams}

> **pathParams**: `object`

The parameters from the path.

#### id

> **id**: `string`

The id of the entity to get.

***

### query? {#query}

> `optional` **query?**: `object`

The query parameters.

#### secondaryIndex?

> `optional` **secondaryIndex?**: `string`

The secondary index to query with the id.

#### conditions?

> `optional` **conditions?**: `string`

The optional conditions to match for the entity, JSON encoded array of property/value pairs.
