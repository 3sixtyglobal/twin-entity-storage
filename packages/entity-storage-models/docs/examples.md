# Entity Storage Models Examples

These examples focus on wiring connectors through the shared factory and shaping typed API request and response contracts.

## EntityStorageConnectorFactory

```typescript
import { EntityStorageConnectorFactory } from '@3sixty/entity-storage-models';
import { MemoryEntityStorageConnector } from '@3sixty/entity-storage-connector-memory';

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

const connector =
  EntityStorageConnectorFactory.get<MemoryEntityStorageConnector<Profile>>('profile-storage');

await connector.set({
  id: 'profile-1',
  email: 'ada@example.com',
  status: 'active',
  createdAt: '2026-03-09T10:30:00.000Z'
});
```

```typescript
import type {
  IEntityStorageGetRequest,
  IEntityStorageGetResponse,
  IEntityStorageListRequest,
  IEntityStorageListResponse,
  IEntityStorageRemoveRequest,
  IEntityStorageSetRequest
} from '@3sixty/entity-storage-models';

interface Profile {
  id: string;
  email: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

const setRequest: IEntityStorageSetRequest = {
  body: {
    id: 'profile-1',
    email: 'ada@example.com',
    status: 'active',
    createdAt: '2026-03-09T10:30:00.000Z'
  }
};

const getRequest: IEntityStorageGetRequest = {
  pathParams: { id: 'profile-1' }
};

const listRequest: IEntityStorageListRequest = {
  query: {
    limit: '25'
  }
};

const getResponse: IEntityStorageGetResponse = {
  body: setRequest.body
};

const listResponse: IEntityStorageListResponse = {
  body: {
    entities: [setRequest.body],
    cursor: 'next-page-token'
  }
};

const removeRequest: IEntityStorageRemoveRequest = {
  pathParams: { id: 'profile-1' }
};
```
