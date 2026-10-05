# Entity Storage Connector GCP Firestore

This package provides a Google Cloud Firestore backend for managed document persistence in distributed systems. It is designed to work with the wider storage ecosystem so applications can keep behaviour consistent across connectors and environments.

## Installation

```shell
npm install @twin.org/entity-storage-connector-gcp-firestore
```

## Docker

To perform testing of this component it may be necessary to launch a local instance to communicate with.

```shell
docker run -d --name twin-entity-storage-gcp-firestore -p 8080:8080 gcr.io/google.com/cloudsdktool/cloud-sdk:emulators gcloud beta emulators firestore start --host-port=0.0.0.0:8080
```

## Examples

Usage of the APIs is shown in the examples [docs/examples.md](docs/examples.md)

## Reference

Detailed reference documentation for the API can be found in [docs/reference/index.md](docs/reference/index.md)

## Changelog

The changes between each version can be found in [docs/changelog.md](docs/changelog.md)

## Origin

This package is derived from the original [iotaledger/twin-entity-storage](https://github.com/iotaledger/twin-entity-storage/tree/next/packages/entity-storage-connector-gcp-firestore) repository.
