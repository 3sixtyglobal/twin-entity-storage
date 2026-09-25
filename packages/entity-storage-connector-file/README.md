# Entity Storage Connector File

This package provides a file-backed backend for persisting entities on local or mounted disks in straightforward environments. It is designed to work with the wider storage ecosystem so applications can keep behaviour consistent across connectors and environments.

## Intended Use

This connector is intended as a testing and debugging aid, not for production workloads. Each table is kept as a single human-readable `store.json` in the configured directory, so its contents can be inspected and edited by hand.

Every operation reads and parses the whole file, and every write serialises and rewrites it, all while holding a lock on the directory. The cost of each call therefore grows with the number of stored entities, and concurrent callers on the same directory wait for each other. As a guide, a table of around 14,000 entities of 500 bytes each takes roughly 10 ms per read and 25 ms per write. For large or busy tables, such as log entries, use one of the database-backed connectors instead.

## Installation

```shell
npm install @twin.org/entity-storage-connector-file
```

## Examples

Usage of the APIs is shown in the examples [docs/examples.md](docs/examples.md)

## Reference

Detailed reference documentation for the API can be found in [docs/reference/index.md](docs/reference/index.md)

## Changelog

The changes between each version can be found in [docs/changelog.md](docs/changelog.md)
