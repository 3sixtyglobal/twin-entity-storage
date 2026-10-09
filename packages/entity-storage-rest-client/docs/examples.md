# Entity Storage REST Client Examples

These snippets show how to call the REST endpoints with typed payloads and how to shape filtered list requests.

## EntityStorageRestClient

```typescript
import { EntityStorageRestClient } from '@3sixty/entity-storage-rest-client';
import {
  ComparisonOperator,
  LogicalOperator,
  SortDirection,
  type EntityCondition
} from '@3sixty/entity';

interface Profile {
  id: string;
  email: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

const client = new EntityStorageRestClient<Profile>({
  endpoint: 'http://localhost:8080'
});

const className = client.className();

await client.set({
  id: 'profile-1',
  email: 'ada@example.com',
  status: 'active',
  createdAt: '2026-03-09T10:30:00.000Z'
});

const byPrimaryKey = await client.get('profile-1');
const bySecondaryIndex = await client.get('ada@example.com', 'email');

const activeCondition: EntityCondition<Profile> = {
  logicalOperator: LogicalOperator.And,
  conditions: [
    {
      property: 'status',
      comparison: ComparisonOperator.Equals,
      value: 'active'
    }
  ]
};

const result = await client.query(
  activeCondition,
  'createdAt',
  SortDirection.Descending,
  ['id', 'email', 'status'],
  undefined,
  25
);

await client.remove('profile-1');
```
