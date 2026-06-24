# Entity Storage Connector File Examples

Use this page to see local-file storage workflows for bootstrapping, entity lifecycle operations, and filtered querying.

## FileEntityStorageConnector

```typescript
import {
  FileEntityStorageConnector,
  type IFileEntityStorageConnectorConstructorOptions
} from '@twin.org/entity-storage-connector-file';
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

const options: IFileEntityStorageConnectorConstructorOptions = {
  entitySchema: 'Profile',
  config: {
    directory: './data/profiles'
  }
};

const connector = new FileEntityStorageConnector<Profile>(options);
await connector.bootstrap();

const className = connector.className();
const schema = connector.getSchema();

await connector.set({
  id: 'profile-1',
  email: 'ada@example.com',
  status: 'active',
  createdAt: '2026-03-09T10:30:00.000Z'
});

const byPrimaryKey = await connector.get('profile-1');
const bySecondaryIndex = await connector.get('ada@example.com', 'email');

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

const result = await connector.query(
  activeCondition,
  [{ property: 'createdAt', sortDirection: SortDirection.Descending }],
  ['id', 'email', 'status'],
  undefined,
  25
);

await connector.remove('profile-1');
```
