# Entity Storage Connector PostgreSQL

This package provides a PostgreSQL backend for relational persistence, transactions and advanced SQL features. It is designed to work with the wider storage ecosystem so applications can keep behaviour consistent across connectors and environments.

## Installation

```shell
npm install @twin.org/entity-storage-connector-postgresql
```

## Docker

To perform testing of this component it may be necessary to launch a local instance to communicate with.

```shell
docker pull postgres:latest
docker run -d --name twin-entity-storage-postgresql -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -p 5432:5432 postgres:latest
```

## Examples

Usage of the APIs is shown in the examples [docs/examples.md](docs/examples.md)

## Reference

Detailed reference documentation for the API can be found in [docs/reference/index.md](docs/reference/index.md)

## Changelog

The changes between each version can be found in [docs/changelog.md](docs/changelog.md)
