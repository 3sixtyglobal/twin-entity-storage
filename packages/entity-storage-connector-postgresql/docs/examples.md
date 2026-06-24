# Entity Storage Connector PostgreSQL Examples

These snippets demonstrate day-to-day usage with PostgreSQL, including setup, CRUD operations, conditional query calls, and table cleanup.

## PostgreSqlEntityStorageConnector

```typescript
import {
  PostgreSqlEntityStorageConnector,
  type IPostgreSqlEntityStorageConnectorConstructorOptions
} from '@twin.org/entity-storage-connector-postgresql';
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

const options: IPostgreSqlEntityStorageConnectorConstructorOptions = {
  entitySchema: 'Profile',
  config: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'entity_storage',
    tableName: 'profiles'
  }
};

const connector = new PostgreSqlEntityStorageConnector<Profile>(options);
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
import { PostgreSqlEntityStorageConnector } from '@twin.org/entity-storage-connector-postgresql';

interface Profile {
  id: string;
  email: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

const connector = new PostgreSqlEntityStorageConnector<Profile>({
  entitySchema: 'Profile',
  config: {
    host: 'localhost',
    user: 'postgres',
    password: 'postgres',
    database: 'entity_storage',
    tableName: 'profiles'
  }
});

await connector.tableDrop();
```
