# Entity Storage Connector Cosmos DB

This package provides an Azure Cosmos DB backend for globally distributed persistence across regions. It is designed to work with the wider storage ecosystem so applications can keep behaviour consistent across connectors and environments.

## Installation

```shell
npm install @twin.org/entity-storage-connector-cosmosdb
```

## Docker

To perform testing of this component it may be necessary to launch a local instance to communicate with.

```shell
docker pull mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:latest
docker run -p 8081:8081 --detach --name twin-entity-storage-cosmos mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-preview
```

## Examples

Usage of the APIs is shown in the examples [docs/examples.md](docs/examples.md)

## Reference

Detailed reference documentation for the API can be found in [docs/reference/index.md](docs/reference/index.md)

## Changelog

The changes between each version can be found in [docs/changelog.md](docs/changelog.md)
