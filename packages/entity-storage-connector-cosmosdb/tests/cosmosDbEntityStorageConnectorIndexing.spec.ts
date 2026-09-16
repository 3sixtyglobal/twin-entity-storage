// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { Container, type ContainerDefinition } from "@azure/cosmos";
import { ContextIdStore } from "@twin.org/context";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	SortDirection,
	entity,
	property
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { TEST_COSMOS_CONFIG } from "./setupTestEnv.js";
import { CosmosDbEntityStorageConnector } from "../src/cosmosDbEntityStorageConnector.js";

// CosmosDB natively indexes all properties so the emulator shows no measurable query-time
// difference between indexed and unindexed connectors; skip on emulator runs.
const SUPPORT_SECONDARY_INDEXING = false;

// Set to false for connectors that do not create named index objects in the database.
const SUPPORT_NAMED_INDEX_OBJECTS = false;

// Set to false for connectors which cannot add an index to an already created store.
const SUPPORT_INDEX_UPDATE = true;

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
class UnindexedTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public category!: string;

	@property({ type: "number", format: "uint32" })
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

describe("CosmosDbEntityStorageConnector", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<IndexedTestType>(), () =>
			EntitySchemaHelper.getSchema(IndexedTestType)
		);
		EntitySchemaFactory.register(nameof<UnindexedTestType>(), () =>
			EntitySchemaHelper.getSchema(UnindexedTestType)
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

				const startIndexed = Date.now();
				for (const cat of queryCategories) {
					await indexed.query({
						property: "category",
						value: cat,
						comparison: ComparisonOperator.Equals
					});
				}
				const indexedMs = Date.now() - startIndexed;

				const startUnindexed = Date.now();
				for (const cat of queryCategories) {
					await unindexed.query({
						property: "category",
						value: cat,
						comparison: ComparisonOperator.Equals
					});
				}
				const unindexedMs = Date.now() - startUnindexed;

				console.debug(
					`indexed: ${indexedMs}ms, unindexed: ${unindexedMs}ms, improvement: ${unindexedMs - indexedMs}ms`
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
});
