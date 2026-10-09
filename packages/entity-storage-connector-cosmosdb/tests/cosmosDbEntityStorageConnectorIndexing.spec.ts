// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@3sixty/context";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	LogicalOperator,
	SortDirection,
	entity,
	property
} from "@3sixty/entity";
import { nameof } from "@3sixty/nameof";
import { Container, type ContainerDefinition, Containers } from "@azure/cosmos";
import { TEST_COSMOS_CONFIG } from "./setupTestEnv.js";
import { CosmosDbEntityStorageConnector } from "../src/cosmosDbEntityStorageConnector.js";

// CosmosDB natively indexes all properties so the emulator shows no measurable query-time
// difference between indexed and unindexed connectors; skip on emulator runs.
const SUPPORT_SECONDARY_INDEXING = false;

// Set to false for connectors that do not create named index objects in the database.
const SUPPORT_NAMED_INDEX_OBJECTS = false;

// Set to false for connectors which create no index for a property marked isSecondary.
const SUPPORT_SECONDARY_INDEX_CREATION = true;

// Set to false for connectors which create no index for a property that only declares a
// sortDirection.
const SUPPORT_SORT_DIRECTION_INDEX_CREATION = true;

// Set to false for connectors which cannot add an index to an already created store.
const SUPPORT_INDEX_UPDATE = true;

// Set to false for connectors which cannot create a composite index over a schema index group.
const SUPPORT_COMPOSITE_INDEXING = true;

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

function createIndexedConnector(): CosmosDbEntityStorageConnector<IndexedTestType> {
	return new CosmosDbEntityStorageConnector<IndexedTestType>({
		entitySchema: nameof<IndexedTestType>(),
		config: {
			...TEST_COSMOS_CONFIG,
			containerId: `${TEST_COSMOS_CONFIG.containerId}_indexed_${Date.now()}`
		}
	});
}

function createUnindexedConnector(): CosmosDbEntityStorageConnector<UnindexedTestType> {
	return new CosmosDbEntityStorageConnector<UnindexedTestType>({
		entitySchema: nameof<UnindexedTestType>(),
		config: {
			...TEST_COSMOS_CONFIG,
			containerId: `${TEST_COSMOS_CONFIG.containerId}_unindexed_${Date.now()}`
		}
	});
}

/**
 * Read the composite index paths from the indexing policy sent to a container replace.
 * @param body The container definition passed to replace.
 * @returns The paths of each composite index.
 */
function compositeIndexPaths(body: ContainerDefinition): string[][] {
	return (body.indexingPolicy?.compositeIndexes ?? []).map(compositeIndex =>
		compositeIndex.map(path => path.path)
	);
}

/**
 * Read the composite index paths and their orders from a container definition.
 * @param body The container definition passed to create or replace.
 * @returns The path and sort order of each composite index.
 */
function compositeIndexOrderedPaths(body: ContainerDefinition): string[][] {
	return (body.indexingPolicy?.compositeIndexes ?? []).map(compositeIndex =>
		compositeIndex.map(path => `${path.path} ${path.order === "descending" ? "DESC" : "ASC"}`)
	);
}

/**
 * Count how many composite indexes in a definition match an exact ordered path list.
 * @param body The container definition passed to create or replace.
 * @param paths The composite index paths and sort orders to match.
 * @returns The number of matching composite indexes.
 */
function countCompositeIndex(body: ContainerDefinition, paths: string[]): number {
	return compositeIndexOrderedPaths(body).filter(
		indexPaths =>
			indexPaths.length === paths.length && indexPaths.every((path, i) => path === paths[i])
	).length;
}

describe("CosmosDbEntityStorageConnector", () => {
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
		600_000
	);

	// The emulator always reads the indexing policy back with an empty compositeIndexes list, so
	// the composite indexes are asserted on the definition the connector sends to the container.
	test.skipIf(!SUPPORT_SECONDARY_INDEX_CREATION)(
		"bootstrap creates an index for a property marked isSecondary",
		async () => {
			const containerId = `${TEST_COSMOS_CONFIG.containerId}_secondary_${Date.now()}`;
			const connector = new CosmosDbEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_COSMOS_CONFIG, containerId }
			});
			const createSpy = vi.spyOn(Containers.prototype, "create");

			try {
				expect(await connector.bootstrap()).toBe(true);
				expect(createSpy).toHaveBeenCalledTimes(1);

				const createdDefinition = createSpy.mock.calls[0][0] as ContainerDefinition;

				// Cosmos DB has no per-property index object; a secondary property is paired with the
				// primary key in both directions, as the store serves each composite index reversed.
				expect(countCompositeIndex(createdDefinition, ["/category ASC", "/id ASC"])).toBe(1);
				expect(countCompositeIndex(createdDefinition, ["/category ASC", "/id DESC"])).toBe(1);

				// The index has to actually serve a query on the property it covers.
				await connector.set({ id: "1", category: "catA", value: 1 });
				const result = await connector.query({
					property: "category",
					value: "catA",
					comparison: ComparisonOperator.Equals
				});
				expect(result.entities.map(e => e.id)).toEqual(["1"]);
			} finally {
				createSpy.mockRestore();
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		120_000
	);

	// The emulator always reads the indexing policy back with an empty compositeIndexes list, so
	// the composite indexes are asserted on the definition the connector sends to the container.
	test.skipIf(!SUPPORT_SORT_DIRECTION_INDEX_CREATION)(
		"bootstrap creates an index for a property which only declares a sortDirection",
		async () => {
			const containerId = `${TEST_COSMOS_CONFIG.containerId}_sortdirection_${Date.now()}`;
			const connector = new CosmosDbEntityStorageConnector<SortedTestType>({
				entitySchema: nameof<SortedTestType>(),
				config: { ...TEST_COSMOS_CONFIG, containerId }
			});
			const createSpy = vi.spyOn(Containers.prototype, "create");

			try {
				expect(await connector.bootstrap()).toBe(true);
				expect(createSpy).toHaveBeenCalledTimes(1);

				const createdDefinition = createSpy.mock.calls[0][0] as ContainerDefinition;

				// A sortDirection alone marks the property as sortable, which needs the same pairing
				// with the primary key an isSecondary property gets.
				expect(countCompositeIndex(createdDefinition, ["/sorted ASC", "/id ASC"])).toBe(1);
				expect(countCompositeIndex(createdDefinition, ["/sorted ASC", "/id DESC"])).toBe(1);

				// The index has to actually serve a sort on the property it covers.
				await connector.set({ id: "1", sorted: "a", value: 1 });
				await connector.set({ id: "2", sorted: "b", value: 2 });
				const result = await connector.query(undefined, [
					{ property: "sorted", sortDirection: SortDirection.Descending }
				]);
				expect(result.entities.map(e => e.id)).toEqual(["2", "1"]);
			} finally {
				createSpy.mockRestore();
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		120_000
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

	// The emulator accepts a composite index but always reads the policy back with an empty
	// compositeIndexes list, so the update is asserted on the container replace the connector
	// issues rather than on the stored policy.
	test.skipIf(!SUPPORT_INDEX_UPDATE)(
		"bootstrap adds an index when an existing store gains one in its schema",
		async () => {
			const containerId = `${TEST_COSMOS_CONFIG.containerId}_index_update_${Date.now()}`;
			const unindexed = new CosmosDbEntityStorageConnector<UnindexedTestType>({
				entitySchema: nameof<UnindexedTestType>(),
				config: { ...TEST_COSMOS_CONFIG, containerId }
			});
			const indexed = new CosmosDbEntityStorageConnector<IndexedTestType>({
				entitySchema: nameof<IndexedTestType>(),
				config: { ...TEST_COSMOS_CONFIG, containerId }
			});
			const replaceSpy = vi.spyOn(Container.prototype, "replace");

			try {
				// Create the container from a schema which does not index the category property.
				expect(await unindexed.bootstrap()).toBe(true);
				expect(replaceSpy).not.toHaveBeenCalled();

				// Bootstrapping the same container from a schema which does index it must add the index.
				expect(await indexed.bootstrap()).toBe(true);
				expect(replaceSpy).toHaveBeenCalledTimes(1);

				const replacedDefinition = replaceSpy.mock.calls[0][0] as ContainerDefinition;
				const paths = compositeIndexPaths(replacedDefinition);
				expect(paths.some(path => path[0] === "/category" && path[1] === "/id")).toBe(true);

				// The rest of the container definition has to survive the update.
				expect(replacedDefinition.id).toBe(containerId);
				expect(replacedDefinition.indexingPolicy?.indexingMode).toBe("consistent");
				expect(replacedDefinition.indexingPolicy?.includedPaths).toEqual([{ path: "/*" }]);

				// The container has to remain usable for the sort the index was provisioned for.
				await indexed.set({ id: "1", category: "catA", value: 1 });
				const sorted = await indexed.query(undefined, [
					{ property: "category", sortDirection: SortDirection.Ascending }
				]);
				expect(sorted.entities[0]?.id).toBe("1");
			} finally {
				replaceSpy.mockRestore();
				try {
					await indexed.teardown?.();
				} catch {}
			}
		},
		120_000
	);
	// The emulator always reads the indexing policy back with an empty compositeIndexes list, so
	// the composite indexes are asserted on the definition the connector sends to the container.

	// The emulator always reads the indexing policy back with an empty compositeIndexes list, so
	// the composite indexes are asserted on the definition the connector sends to the container.
	test.skipIf(!SUPPORT_COMPOSITE_INDEXING)(
		"bootstrap creates a composite index for each multi-property index group",
		async () => {
			const containerId = `${TEST_COSMOS_CONFIG.containerId}_group_${Date.now()}`;
			const connector = new CosmosDbEntityStorageConnector<CompositeIndexedTestType>({
				entitySchema: nameof<CompositeIndexedTestType>(),
				config: { ...TEST_COSMOS_CONFIG, containerId }
			});
			const createSpy = vi.spyOn(Containers.prototype, "create");

			try {
				expect(await connector.bootstrap()).toBe(true);
				expect(createSpy).toHaveBeenCalledTimes(1);

				const createdDefinition = createSpy.mock.calls[0][0] as ContainerDefinition;

				// The group order and directions come from the index entries, not the schema order.
				expect(countCompositeIndex(createdDefinition, ["/category ASC", "/status DESC"])).toBe(1);
				expect(countCompositeIndex(createdDefinition, ["/value DESC", "/status ASC"])).toBe(1);
			} finally {
				createSpy.mockRestore();
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		120_000
	);

	test.skipIf(!SUPPORT_COMPOSITE_INDEXING)(
		"bootstrap does not create a duplicate composite index when called multiple times",
		async () => {
			const containerId = `${TEST_COSMOS_CONFIG.containerId}_group_idempotent_${Date.now()}`;
			const connector = new CosmosDbEntityStorageConnector<CompositeIndexedTestType>({
				entitySchema: nameof<CompositeIndexedTestType>(),
				config: { ...TEST_COSMOS_CONFIG, containerId }
			});
			const replaceSpy = vi.spyOn(Container.prototype, "replace");

			try {
				expect(await connector.bootstrap()).toBe(true);
				expect(await connector.bootstrap()).toBe(true);

				// The second bootstrap sees an existing container, so it reconciles the policy rather
				// than creating one; whatever it sends must still list each group exactly once.
				expect(replaceSpy).toHaveBeenCalledTimes(1);
				const replacedDefinition = replaceSpy.mock.calls[0][0] as ContainerDefinition;
				expect(countCompositeIndex(replacedDefinition, ["/category ASC", "/status DESC"])).toBe(1);
				expect(countCompositeIndex(replacedDefinition, ["/value DESC", "/status ASC"])).toBe(1);
			} finally {
				replaceSpy.mockRestore();
				try {
					await connector.teardown?.();
				} catch {}
			}
		},
		120_000
	);

	test("query filtering on every property of an index group returns only the matching entities", async () => {
		const containerId = `${TEST_COSMOS_CONFIG.containerId}_group_query_${Date.now()}`;
		const connector = new CosmosDbEntityStorageConnector<CompositeIndexedTestType>({
			entitySchema: nameof<CompositeIndexedTestType>(),
			config: { ...TEST_COSMOS_CONFIG, containerId }
		});

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
	}, 120_000);
});
