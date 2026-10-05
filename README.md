# TWIN Entity Storage

This repository provides a unified entity storage ecosystem that combines shared models, service contracts, client access and backend implementations behind consistent interfaces. The aim is to let teams build against stable contracts while selecting the persistence approach that best fits local development, cloud services and production operations.

By aligning behaviour across connectors, the repository helps reduce integration effort, improve portability between environments and support predictable long-term maintenance as systems evolve.

## Packages

- [entity-storage-models](packages/entity-storage-models/README.md) - Shared models for storage contracts, requests, responses and connector capabilities.
- [entity-storage-connector-memory](packages/entity-storage-connector-memory/README.md) - In-memory connector for local development, testing and short-lived workloads.
- [entity-storage-service](packages/entity-storage-service/README.md) - Service layer exposing storage contracts and REST endpoint definitions.
- [entity-storage-rest-client](packages/entity-storage-rest-client/README.md) - REST client for calling storage services from applications and tools.
- [entity-storage-connector-file](packages/entity-storage-connector-file/README.md) - File-based connector that stores entities on disk for straightforward deployments.
- [entity-storage-connector-scylladb](packages/entity-storage-connector-scylladb/README.md) - ScyllaDB connector for distributed, high-throughput persistence. See [ScyllaDB](https://www.scylladb.com/).
- [entity-storage-connector-dynamodb](packages/entity-storage-connector-dynamodb/README.md) - Amazon DynamoDB connector for managed NoSQL persistence. See [Amazon DynamoDB](https://aws.amazon.com/dynamodb/).
- [entity-storage-connector-gcp-firestore](packages/entity-storage-connector-gcp-firestore/README.md) - Google Cloud Firestore connector for document-based persistence. See [Google Cloud Firestore](https://cloud.google.com/firestore).
- [entity-storage-connector-mysql](packages/entity-storage-connector-mysql/README.md) - MySQL connector for relational persistence with SQL querying. See [MySQL](https://www.mysql.com/).
- [entity-storage-connector-mongodb](packages/entity-storage-connector-mongodb/README.md) - MongoDB connector for flexible document-oriented persistence. See [MongoDB](https://www.mongodb.com/).
- [entity-storage-connector-postgresql](packages/entity-storage-connector-postgresql/README.md) - PostgreSQL connector for relational persistence and advanced SQL features. See [PostgreSQL](https://www.postgresql.org/).
- [entity-storage-connector-cosmosdb](packages/entity-storage-connector-cosmosdb/README.md) - Azure Cosmos DB connector for globally distributed persistence. See [Azure Cosmos DB](https://azure.microsoft.com/en-gb/products/cosmos-db/).

## Contributing

To contribute to this package see the guidelines for building and publishing in [CONTRIBUTING](./CONTRIBUTING.md)

## Origin

This repository is derived from the original [iotaledger/twin-entity-storage](https://github.com/iotaledger/twin-entity-storage) repository.
