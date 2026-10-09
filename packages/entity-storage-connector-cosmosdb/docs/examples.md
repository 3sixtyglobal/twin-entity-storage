# Entity Storage Connector CosmosDB Examples

Use these snippets to configure a connector, work with common entity operations, and clean up storage resources when running integration tests.

## CosmosDbEntityStorageConnector

```typescript
import {
  CosmosDbEntityStorageConnector,
  type ICosmosDbEntityStorageConnectorConstructorOptions
} from '@3sixty/entity-storage-connector-cosmosdb';
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

const options: ICosmosDbEntityStorageConnectorConstructorOptions = {
  entitySchema: 'Profile',
  config: {
    endpoint: 'https://example.documents.azure.com:443/',
    key: 'cosmos-primary-key',
    databaseId: 'entityStorage',
    containerId: 'profiles',
    offerThroughput: 400
  }
};

const connector = new CosmosDbEntityStorageConnector<Profile>(options);
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
import { CosmosDbEntityStorageConnector } from '@3sixty/entity-storage-connector-cosmosdb';

interface Profile {
  id: string;
  email: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

const connector = new CosmosDbEntityStorageConnector<Profile>({
  entitySchema: 'Profile',
  config: {
    endpoint: 'https://example.documents.azure.com:443/',
    key: 'cosmos-primary-key',
    databaseId: 'entityStorage',
    containerId: 'profiles'
  }
});

await connector.containerDelete();
```
