# Entity Storage Connector MongoDB Examples

These snippets show how to initialise a connector, run common data operations, and drop a collection when resetting environments.

## MongoDbEntityStorageConnector

```typescript
import {
  MongoDbEntityStorageConnector,
  type IMongoDbEntityStorageConnectorConstructorOptions
} from '@3sixty/entity-storage-connector-mongodb';
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

const options: IMongoDbEntityStorageConnectorConstructorOptions = {
  entitySchema: 'Profile',
  config: {
    host: 'localhost',
    port: 27017,
    database: 'entityStorage',
    collection: 'profiles'
  }
};

const connector = new MongoDbEntityStorageConnector<Profile>(options);
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
import { MongoDbEntityStorageConnector } from '@3sixty/entity-storage-connector-mongodb';

interface Profile {
  id: string;
  email: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

const connector = new MongoDbEntityStorageConnector<Profile>({
  entitySchema: 'Profile',
  config: {
    host: 'localhost',
    database: 'entityStorage',
    collection: 'profiles'
  }
});

await connector.collectionDrop();
```
