# TWIN Entity Storage

Entity Storage packages provide a consistent way to model, store and retrieve entities across multiple backing technologies. The repository brings together shared models, a service layer, a client library and a range of storage connectors so teams can adopt a single contract while choosing infrastructure that fits their operational needs.

By keeping interfaces aligned across connectors, the project helps reduce integration overhead and makes it easier to move between local development, managed cloud services and production databases without redesigning application-level behaviour.

## Packages

- [entity-storage-models](packages/entity-storage-models/README.md) - Shared models for entity storage contracts, requests and connector behaviour.
- [entity-storage-connector-memory](packages/entity-storage-connector-memory/README.md) - In-memory connector for local development, testing and ephemeral workloads.
- [entity-storage-service](packages/entity-storage-service/README.md) - Service layer that exposes entity storage contracts and REST endpoint definitions.
- [entity-storage-rest-client](packages/entity-storage-rest-client/README.md) - REST client for calling entity storage services from applications and tools.
- [entity-storage-connector-file](packages/entity-storage-connector-file/README.md) - File-based connector that stores entities on disk for simple deployments.
- [entity-storage-connector-scylladb](packages/entity-storage-connector-scylladb/README.md) - ScyllaDB connector for distributed, high-throughput entity persistence.
- [entity-storage-connector-dynamodb](packages/entity-storage-connector-dynamodb/README.md) - Amazon DynamoDB connector for managed NoSQL entity persistence.
- [entity-storage-connector-gcp-firestore](packages/entity-storage-connector-gcp-firestore/README.md) - Google Cloud Firestore connector for document-based entity persistence.
- [entity-storage-connector-mysql](packages/entity-storage-connector-mysql/README.md) - MySQL connector for relational entity persistence with SQL-based querying.
- [entity-storage-connector-mongodb](packages/entity-storage-connector-mongodb/README.md) - MongoDB connector for flexible document-oriented entity persistence.
- [entity-storage-connector-postgresql](packages/entity-storage-connector-postgresql/README.md) - PostgreSQL connector for relational entity persistence and advanced SQL features.
- [entity-storage-connector-cosmosdb](packages/entity-storage-connector-cosmosdb/README.md) - Azure Cosmos DB connector for globally distributed entity persistence.

## Contributing

To contribute to this package see the guidelines for building and publishing in [CONTRIBUTING](./CONTRIBUTING.md)
