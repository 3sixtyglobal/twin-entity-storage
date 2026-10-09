# Entity Storage Connector GCP Firestore Examples

These examples cover setup, strongly typed CRUD access, filtered query calls, and collection cleanup for test environments.

## FirestoreEntityStorageConnector

```typescript
import {
  FirestoreEntityStorageConnector,
  type IFirestoreEntityStorageConnectorConstructorOptions
} from '@3sixty/entity-storage-connector-gcp-firestore';
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

const options: IFirestoreEntityStorageConnectorConstructorOptions = {
  entitySchema: 'Profile',
  config: {
    projectId: 'local-project',
    databaseId: '(default)',
    collectionName: 'profiles',
    endpoint: 'localhost:8080'
  }
};

const connector = new FirestoreEntityStorageConnector<Profile>(options);
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
import { FirestoreEntityStorageConnector } from '@3sixty/entity-storage-connector-gcp-firestore';

interface Profile {
  id: string;
  email: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

const connector = new FirestoreEntityStorageConnector<Profile>({
  entitySchema: 'Profile',
  config: {
    projectId: 'local-project',
    collectionName: 'profiles'
  }
});

await connector.collectionDelete();
```
