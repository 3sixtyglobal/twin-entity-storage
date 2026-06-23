# Entity Storage Connector ScyllaDB

This package provides a ScyllaDB backend for distributed workloads that need low latency and high throughput. It is designed to work with the wider storage ecosystem so applications can keep behaviour consistent across connectors and environments.

## Installation

```shell
npm install @twin.org/entity-storage-connector-scylladb
```

## Docker

To perform testing of this component it may be necessary to launch a local instance to communicate with.

```shell
docker run -d --name twin-entity-storage-scylladb -p 9042:9042 scylladb/scylla:5.4.9
```

## Examples

Usage of the APIs is shown in the examples [docs/examples.md](docs/examples.md)

## Reference

Detailed reference documentation for the API can be found in [docs/reference/index.md](docs/reference/index.md)

## Changelog

The changes between each version can be found in [docs/changelog.md](docs/changelog.md)
