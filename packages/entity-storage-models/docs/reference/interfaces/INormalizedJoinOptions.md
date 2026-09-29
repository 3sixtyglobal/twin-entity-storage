# Interface: INormalizedJoinOptions\<T, U\>

Interface describing the parts of a set of join options which decide where a page starts and
ends, reduced to a stable form so two queries which page the same way normalise to the same
value.

## Type Parameters

### T

`T` = `unknown`

### U

`U` = `unknown`

## Properties

### property {#property}

> **property**: `string`

The property on the primary entity which holds the value to join from.

***

### joinProperty {#joinproperty}

> **joinProperty**: `string`

The property on the joined entity which holds the value to join to.

***

### groupProperty? {#groupproperty}

> `optional` **groupProperty?**: `string`

The property the primary entities are grouped by, absent when they are not grouped.

***

### sortProperties {#sortproperties}

> **sortProperties**: `string`[]

The sort order of the primary entities, each entry holding the property and its direction.

***

### conditions? {#conditions}

> `optional` **conditions?**: `EntityCondition`\<`T`\>

The conditions to match for the primary entities.

***

### groupConditions? {#groupconditions}

> `optional` **groupConditions?**: `EntityCondition`\<`T`\>[]

The conditions every group must satisfy.

***

### joinConditions? {#joinconditions}

> `optional` **joinConditions?**: `EntityCondition`\<`U`\>

The conditions to match for the joined entities.

***

### joinRequired {#joinrequired}

> **joinRequired**: `boolean`

Whether a primary entity is required to have at least one joined entity.
