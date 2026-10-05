// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import os from "node:os";
import path from "node:path";
import { ContextIdStore } from "@twin.org/context";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	LogicalOperator,
	SortDirection,
	entity,
	property
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { FileEntityStorageConnector } from "../src/fileEntityStorageConnector.js";

// File connector performs no indexing; all queries are full scans over the filesystem.
const SUPPORT_SECONDARY_INDEXING = false;

// Set to false for connectors that do not create named index objects in the database.
const SUPPORT_NAMED_INDEX_OBJECTS = false;

// The file connector keeps entities in a JSON file, so a secondary property gets no index.
const SUPPORT_SECONDARY_INDEX_CREATION = false;

// The file connector sorts in memory after a full scan, so a sortDirection needs no index.
const SUPPORT_SORT_DIRECTION_INDEX_CREATION = false;

// The file connector holds no indexes, so a schema which gains one needs no bootstrap action.
const SUPPORT_INDEX_UPDATE = false;

// The file connector holds no indexes of any kind; every query is a full scan.
const SUPPORT_COMPOSITE_INDEXING = false;

@entity()
class IndexedTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", isSecondary: true })
	public category!: string;

	@property({ type: "number", format: "uint32" })
	public value!: number;
}

@entity()
class SortedTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", sortDirection: SortDirection.Descending })
	public sorted!: string;

	@property({ type: "number", format: "uint32" })
	public value!: number;
}

@entity()
class UnindexedTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public category!: string;

	@property({ type: "number", format: "uint32" })
	public value!: number;
}

@entity()
class CompositeIndexedTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({
		type: "string",
		indexGroup: [{ name: "categoryStatus", direction: SortDirection.Ascending, index: 0 }]
	})
	public category!: string;

	@property({
		type: "string",
		indexGroup: [
			{ name: "categoryStatus", direction: SortDirection.Descending, index: 1 },
			{ name: "statusValue", direction: SortDirection.Ascending, index: 1 }
		]
	})
	public status!: string;

	@property({
		type: "number",
		format: "uint32",
		indexGroup: [{ name: "statusValue", direction: SortDirection.Descending, index: 0 }]
	})
	public value!: number;
}

function createIndexedConnector(): FileEntityStorageConnector<IndexedTestType> {
	return new FileEntityStorageConnector<IndexedTestType>({
		entitySchema: nameof<IndexedTestType>(),
		config: { directory: path.join(os.tmpdir(), "entity-storage-indexed") }
	});
}

function createSortedConnector(): FileEntityStorageConnector<SortedTestType> {
	return new FileEntityStorageConnector<SortedTestType>({
		entitySchema: nameof<SortedTestType>(),
		config: { directory: path.join(os.tmpdir(), "entity-storage-sorted") }
	});
}

function createUnindexedConnector(): FileEntityStorageConnector<UnindexedTestType> {
	return new FileEntityStorageConnector<UnindexedTestType>({
		entitySchema: nameof<UnindexedTestType>(),
		config: { directory: path.join(os.tmpdir(), "entity-storage-unindexed") }
	});
}

function createCompositeConnector(): FileEntityStorageConnector<CompositeIndexedTestType> {
	return new FileEntityStorageConnector<CompositeIndexedTestType>({
		entitySchema: nameof<CompositeIndexedTestType>(),
		config: { directory: path.join(os.tmpdir(), "entity-storage-composite") }
	});
}

describe("FileEntityStorageConnector", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<IndexedTestType>(), () =>
			EntitySchemaHelper.getSchema(IndexedTestType)
		);
		EntitySchemaFactory.register(nameof<SortedTestType>(), () =>
			EntitySchemaHelper.getSchema(SortedTestType)
		);
		EntitySchemaFactory.register(nameof<UnindexedTestType>(), () =>
			EntitySchemaHelper.getSchema(UnindexedTestType)
		);
		EntitySchemaFactory.register(nameof<CompositeIndexedTestType>(), () =>
			EntitySchemaHelper.getSchema(CompositeIndexedTestType)
		);

		ContextIdStore.getContextIds = vi
			.fn()
			.mockReturnValue({ node: "node", tenant: "tenant", user: "user" });
	});

	test.skipIf(!SUPPORT_SECONDARY_INDEXING)(
		"secondary index reduces query time compared to full scan",
		async () => {
			const indexed = createIndexedConnector();
			const unindexed = createUnindexedConnector();

			try {
				await indexed.bootstrap();
				await unindexed.bootstrap();

				const rowCount = process.env.CI ? 5_000 : 50_000;

				const items: IndexedTestType[] = [];
				for (let i = 0; i < rowCount; i++) {
					items.push({
						id: String(i + 1),
						category: `cat${String(i + 1).padStart(6, "0")}`,
						value: i
					});
				}
				await indexed.setBatch(items);
				await unindexed.setBatch(items);

				const queryCategories: string[] = [];
				for (let i = 0; i < 20; i++) {
					const step = i * 1_000;
					queryCategories.push(`cat${String(step + 1).padStart(6, "0")}`);
				}

				// Warm up both connectors so connection and plan setup is not timed
				await indexed.query({
					property: "category",
					value: queryCategories[0],
					comparison: ComparisonOperator.Equals
				});
				await unindexed.query({
					property: "category",
					value: queryCategories[0],
					comparison: ComparisonOperator.Equals
				});

				// Interleave the queries and compare medians so load spikes affect both equally
				const indexedTimes: number[] = [];
				const unindexedTimes: number[] = [];
				for (const cat of queryCategories) {
					let start = performance.now();
					await indexed.query({
						property: "category",
						value: cat,
						comparison: ComparisonOperator.Equals
					});
					indexedTimes.push(performance.now() - start);

					start = performance.now();
					await unindexed.query({
						property: "category",
						value: cat,
						comparison: ComparisonOperator.Equals
					});
					unindexedTimes.push(performance.now() - start);
				}

				const median = (times: number[]): number =>
					times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
				const indexedMs = median(indexedTimes);
				const unindexedMs = median(unindexedTimes);

				console.debug(
					`median indexed: ${indexedMs.toFixed(2)}ms, unindexed: ${unindexedMs.toFixed(2)}ms`
				);
				expect(indexedMs).toBeLessThan(unindexedMs);
			} finally {
				try {
					await indexed.teardown?.();
				} catch {}
				try {
					await unindexed.teardown?.();
				} catch {}
			}
		},
		300_000
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_CREATION)(
		"bootstrap creates an index for a property marked isSecondary",
		async () => {
			const connector = createIndexedConnector();

			try {
				expect(await connector.bootstrap()).toBe(true);

				// A query on the property has to return the matching entity.
				await connector.set({ id: "1", category: "catA", value: 1 });
				const result = await connector.query({
					property: "category",
					value: "catA",
					comparison: ComparisonOperator.Equals
				});
				expect(result.entities.map(e => e.id)).toEqual(["1"]);
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_SORT_DIRECTION_INDEX_CREATION)(
		"bootstrap creates an index for a property which only declares a sortDirection",
		async () => {
			const connector = createSortedConnector();

			try {
				expect(await connector.bootstrap()).toBe(true);

				// A sort on the property has to return the entities in the requested order.
				await connector.set({ id: "1", sorted: "a", value: 1 });
				await connector.set({ id: "2", sorted: "b", value: 2 });
				const result = await connector.query(undefined, [
					{ property: "sorted", sortDirection: SortDirection.Descending }
				]);
				expect(result.entities.map(e => e.id)).toEqual(["2", "1"]);
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		60_000
	);

	test("bootstrap is idempotent when called multiple times", async () => {
		const connector = createIndexedConnector();

		try {
			const firstResult = await connector.bootstrap();
			const secondResult = await connector.bootstrap();

			expect(firstResult).toBe(true);
			expect(secondResult).toBe(true);

			await connector.set({ id: "1", category: "catA", value: 1 });
			const storedEntity = await connector.get("1");
			expect(storedEntity?.category).toBe("catA");
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
		}
	}, 60_000);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"does not create a duplicate index when the column is already covered by a differently named index",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"still creates its own index when the column is only a non-leading member of another index",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"still creates its own index when a same-named table in another schema has a covering index",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"still creates its own index when the column is only covered by an invalid or invisible index",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"still creates its own index when the column is only covered by a FULLTEXT or partial index",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"does not create a duplicate index after an index naming-scheme change",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"does not create a duplicate index when the column is already covered by a descending index",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_NAMED_INDEX_OBJECTS)(
		"does not create a duplicate index when the column is already covered by a compound index leading on it",
		async () => {
			const connector = createIndexedConnector();

			try {
				await connector.bootstrap();
				await connector.bootstrap();

				await connector.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await connector.get("1");
				expect(storedEntity?.category).toBe("catA");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_INDEX_UPDATE)(
		"bootstrap adds an index when an existing store gains one in its schema",
		async () => {
			const directory = path.join(os.tmpdir(), `entity-storage-index-update-${Date.now()}`);
			const unindexed = new FileEntityStorageConnector<UnindexedTestType>({
				entitySchema: nameof<UnindexedTestType>(),
				config: { directory }
			});
			const indexed = new FileEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { directory }
			});

			try {
				// Create the store from a schema which does not index the category property.
				expect(await unindexed.bootstrap()).toBe(true);

				// Bootstrapping the same store from a schema which does index it must add the index.
				expect(await indexed.bootstrap()).toBe(true);

				// The added index has to actually serve queries routed through it.
				await indexed.set({ id: "1", category: "catA", value: 1 });
				const storedEntity = await indexed.get("catA", "category");
				expect(storedEntity?.id).toBe("1");
			} finally {
				try {
					await indexed.teardown?.();
				} catch {}
			}
		},
		60_000
	);
	test.skipIf(!SUPPORT_COMPOSITE_INDEXING)(
		"bootstrap creates a composite index for each multi-property index group",
		async () => {
			const connector = createCompositeConnector();

			try {
				expect(await connector.bootstrap()).toBe(true);
				expect(await connector.bootstrap()).toBe(true);

				await connector.set({
					id: "1",
					category: "catA",
					status: "active",
					value: 1
				});
				const storedEntity = await connector.get("1");
				expect(storedEntity?.status).toBe("active");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		60_000
	);

	test.skipIf(!SUPPORT_COMPOSITE_INDEXING)(
		"bootstrap does not create a duplicate composite index when called multiple times",
		async () => {
			const connector = createCompositeConnector();

			try {
				expect(await connector.bootstrap()).toBe(true);
				expect(await connector.bootstrap()).toBe(true);

				await connector.set({
					id: "1",
					category: "catA",
					status: "active",
					value: 1
				});
				const storedEntity = await connector.get("1");
				expect(storedEntity?.status).toBe("active");
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		60_000
	);

	test("query filtering on every property of an index group returns only the matching entities", async () => {
		const connector = createCompositeConnector();

		try {
			expect(await connector.bootstrap()).toBe(true);

			await connector.setBatch([
				{ id: "1", category: "catA", status: "active", value: 1 },
				{ id: "2", category: "catA", status: "archived", value: 2 },
				{ id: "3", category: "catB", status: "active", value: 3 },
				{ id: "4", category: "catA", status: "active", value: 4 }
			]);

			const result = await connector.query({
				conditions: [
					{ property: "category", value: "catA", comparison: ComparisonOperator.Equals },
					{ property: "status", value: "active", comparison: ComparisonOperator.Equals }
				],
				logicalOperator: LogicalOperator.And
			});

			expect(result.entities.map(matched => matched.id).sort()).toEqual(["1", "4"]);
		} finally {
			try {
				await connector.teardown?.();
			} catch {}
		}
	}, 60_000);
});
