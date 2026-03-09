# Entity Storage Service Examples

Use these snippets to wire a registered connector into the service layer and to expose matching REST routes.

## EntityStorageService

```typescript
import {
  EntityStorageService,
  generateRestRoutesEntityStorage
} from '@twin.org/entity-storage-service';
import { EntityStorageConnectorFactory } from '@twin.org/entity-storage-models';
import { MemoryEntityStorageConnector } from '@twin.org/entity-storage-connector-memory';
import {
  ComparisonOperator,
  LogicalOperator,
  SortDirection,
  type EntityCondition
} from '@twin.org/entity';

interface Profile {
  id: string;
  email: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

EntityStorageConnectorFactory.register(
  'profile-storage',
  () =>
    new MemoryEntityStorageConnector<Profile>({
      entitySchema: 'Profile'
    })
);

const service = new EntityStorageService<Profile>({
  entityStorageType: 'profile-storage'
});

const className = service.className();

await service.set({
  id: 'profile-1',
  email: 'ada@example.com',
  status: 'active',
  createdAt: '2026-03-09T10:30:00.000Z'
});

const byPrimaryKey = await service.get('profile-1');
const bySecondaryIndex = await service.get('ada@example.com', 'email');

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

const result = await service.query(
  activeCondition,
  'createdAt',
  SortDirection.Descending,
  ['id', 'email', 'status'],
  undefined,
  25
);

await service.remove('profile-1');

const routes = generateRestRoutesEntityStorage('/profiles', 'profileStorageComponent', {
  typeName: 'Profile'
});
```
