# Entity Storage Connector ScyllaDB Examples

Use these snippets to work with table-backed storage first, then add a view connector for read-focused access patterns.

## ScyllaDBTableConnector

```typescript
import {
  ScyllaDBTableConnector,
  type IScyllaDBTableConnectorConstructorOptions
} from '@3sixty/entity-storage-connector-scylladb';
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

const options: IScyllaDBTableConnectorConstructorOptions = {
  entitySchema: 'Profile',
  config: {
    hosts: ['127.0.0.1'],
    port: 9042,
    localDataCenter: 'datacenter1',
    keyspace: 'entity_storage',
    tableName: 'profiles'
  }
};

const connector = new ScyllaDBTableConnector<Profile>(options);
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
await connector.truncateTable();
await connector.dropTable();
```

## ScyllaDBViewConnector

```typescript
import {
  ScyllaDBViewConnector,
  type IScyllaDBViewConnectorConstructorOptions
} from '@3sixty/entity-storage-connector-scylladb';

interface ProfileView {
  id: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

const options: IScyllaDBViewConnectorConstructorOptions = {
  entitySchema: 'Profile',
  viewSchema: 'ProfileView',
  config: {
    hosts: ['127.0.0.1'],
    localDataCenter: 'datacenter1',
    keyspace: 'entity_storage',
    tableName: 'profiles',
    viewName: 'profiles_by_status'
  }
};

const viewConnector = new ScyllaDBViewConnector<ProfileView>(options);
await viewConnector.bootstrap();

const className = viewConnector.className();
const schema = viewConnector.getSchema();
const byPrimaryKey = await viewConnector.get('profile-1');

try {
  await viewConnector.set({
    id: 'profile-1',
    status: 'active',
    createdAt: '2026-03-09T10:30:00.000Z'
  });
} catch (error) {
  void error;
}

try {
  await viewConnector.remove('profile-1');
} catch (error) {
  void error;
}

await viewConnector.teardown();
```
