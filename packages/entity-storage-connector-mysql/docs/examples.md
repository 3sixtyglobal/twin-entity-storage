# Entity Storage Connector MySQL Examples

This page focuses on full connector lifecycle work, from initial bootstrap and entity access to schema maintenance and connection shutdown.

## MySqlEntityStorageConnector

```typescript
import {
  MySqlEntityStorageConnector,
  type IMySqlEntityStorageConnectorConstructorOptions
} from '@3sixty/entity-storage-connector-mysql';
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

const options: IMySqlEntityStorageConnectorConstructorOptions = {
  entitySchema: 'Profile',
  config: {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'entity_storage',
    tableName: 'profiles'
  }
};

const connector = new MySqlEntityStorageConnector<Profile>(options);
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

```typescript
import { MySqlEntityStorageConnector } from '@3sixty/entity-storage-connector-mysql';

interface Profile {
  id: string;
  email: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

const connector = new MySqlEntityStorageConnector<Profile>({
  entitySchema: 'Profile',
  config: {
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'entity_storage',
    tableName: 'profiles'
  }
});

const databaseExists = await connector.databaseExists();
if (databaseExists) {
  await connector.tableEmpty();
}

await connector.tableDrop();
await connector.stop();
await connector.close();
```
