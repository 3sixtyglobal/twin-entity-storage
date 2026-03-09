# Entity Storage Connector DynamoDB Examples

These examples show a complete flow from connector setup through reads, writes, filtered queries, and table maintenance tasks.

## DynamoDbEntityStorageConnector

```typescript
import {
  DynamoDbEntityStorageConnector,
  type IDynamoDbEntityStorageConnectorConstructorOptions
} from '@twin.org/entity-storage-connector-dynamodb';
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

const options: IDynamoDbEntityStorageConnectorConstructorOptions = {
  entitySchema: 'Profile',
  config: {
    region: 'eu-west-1',
    authMode: 'credentials',
    accessKeyId: 'local-access-key',
    secretAccessKey: 'local-secret-key',
    tableName: 'profiles',
    endpoint: 'http://localhost:10000'
  }
};

const connector = new DynamoDbEntityStorageConnector<Profile>(options);
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
import { DynamoDbEntityStorageConnector } from '@twin.org/entity-storage-connector-dynamodb';

interface Profile {
  id: string;
  email: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

const connector = new DynamoDbEntityStorageConnector<Profile>({
  entitySchema: 'Profile',
  config: {
    region: 'eu-west-1',
    authMode: 'pod',
    tableName: 'profiles'
  }
});

await connector.bootstrap('logging');
```
