# Entity Storage Packages

## entity-storage-models

This package defines the shared domain models used by the entity storage ecosystem, including contracts, requests, responses and connector capabilities.

- [README](../packages/entity-storage-models/README.md)
- [Examples](../packages/entity-storage-models/docs/examples.md)
- [Changelog](../packages/entity-storage-models/docs/changelog.md)

## entity-storage-connector-memory

This package provides an in-memory connector that keeps entity data in process memory, making it well suited to local development, automated testing and short-lived runtime scenarios.

- [README](../packages/entity-storage-connector-memory/README.md)
- [Examples](../packages/entity-storage-connector-memory/docs/examples.md)
- [Changelog](../packages/entity-storage-connector-memory/docs/changelog.md)

## entity-storage-service

This package implements the service-facing contracts and REST endpoint definitions for entity storage, enabling consistent service integration across environments.

- [README](../packages/entity-storage-service/README.md)
- [Examples](../packages/entity-storage-service/docs/examples.md)
- [Changelog](../packages/entity-storage-service/docs/changelog.md)

## entity-storage-rest-client

This package supplies a REST client that lets applications and tooling call entity storage service endpoints using the shared contract model.

- [README](../packages/entity-storage-rest-client/README.md)
- [Examples](../packages/entity-storage-rest-client/docs/examples.md)
- [Changelog](../packages/entity-storage-rest-client/docs/changelog.md)

## entity-storage-connector-file

This package provides a file-based connector that persists entities on local or mounted disks, offering a straightforward option for simple deployments and development setups.

- [README](../packages/entity-storage-connector-file/README.md)
- [Examples](../packages/entity-storage-connector-file/docs/examples.md)
- [Changelog](../packages/entity-storage-connector-file/docs/changelog.md)

## entity-storage-connector-scylladb

This package delivers a ScyllaDB-backed connector for distributed workloads that need low latency and high-throughput entity persistence.

- [README](../packages/entity-storage-connector-scylladb/README.md)
- [Examples](../packages/entity-storage-connector-scylladb/docs/examples.md)
- [Changelog](../packages/entity-storage-connector-scylladb/docs/changelog.md)

## entity-storage-connector-dynamodb

This package integrates entity storage with Amazon DynamoDB to provide managed NoSQL persistence for cloud-native applications.

- [README](../packages/entity-storage-connector-dynamodb/README.md)
- [Examples](../packages/entity-storage-connector-dynamodb/docs/examples.md)
- [Changelog](../packages/entity-storage-connector-dynamodb/docs/changelog.md)

## entity-storage-connector-gcp-firestore

This package integrates entity storage with Google Cloud Firestore, enabling managed document-based persistence for distributed services.

- [README](../packages/entity-storage-connector-gcp-firestore/README.md)
- [Examples](../packages/entity-storage-connector-gcp-firestore/docs/examples.md)
- [Changelog](../packages/entity-storage-connector-gcp-firestore/docs/changelog.md)

## entity-storage-connector-mysql

This package provides a MySQL connector for relational persistence, supporting structured storage patterns and SQL-driven access.

- [README](../packages/entity-storage-connector-mysql/README.md)
- [Examples](../packages/entity-storage-connector-mysql/docs/examples.md)
- [Changelog](../packages/entity-storage-connector-mysql/docs/changelog.md)

## entity-storage-connector-mongodb

This package provides a MongoDB connector for document-oriented persistence where schema flexibility and rich document modelling are important.

- [README](../packages/entity-storage-connector-mongodb/README.md)
- [Examples](../packages/entity-storage-connector-mongodb/docs/examples.md)
- [Changelog](../packages/entity-storage-connector-mongodb/docs/changelog.md)

## entity-storage-connector-postgresql

This package integrates entity storage with PostgreSQL for relational persistence, including workloads that benefit from advanced SQL capabilities.

- [README](../packages/entity-storage-connector-postgresql/README.md)
- [Examples](../packages/entity-storage-connector-postgresql/docs/examples.md)
- [Changelog](../packages/entity-storage-connector-postgresql/docs/changelog.md)

## entity-storage-connector-cosmosdb

This package provides an Azure Cosmos DB connector for globally distributed entity storage scenarios that require broad regional availability.

- [README](../packages/entity-storage-connector-cosmosdb/README.md)
- [Examples](../packages/entity-storage-connector-cosmosdb/docs/examples.md)
- [Changelog](../packages/entity-storage-connector-cosmosdb/docs/changelog.md)
