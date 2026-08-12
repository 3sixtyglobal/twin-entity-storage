// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

// Firestore indexes are managed out-of-band via the GCP console or CLI; the client SDK
// provides no API for creating or deleting indexes at runtime.
import { ContextIdStore } from "@twin.org/context";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	entity,
	property
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { TEST_FIRESTORE_CONFIG } from "./setupTestEnv.js";
import { FirestoreEntityStorageConnector } from "../src/firestoreEntityStorageConnector.js";

// Firestore index management requires out-of-band tooling; no client SDK API exists for
// creating or dropping indexes at runtime.
const SUPPORT_SECONDARY_INDEXING = false;

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

function createIndexedConnector(): FirestoreEntityStorageConnector<IndexedTestType> {
	return new FirestoreEntityStorageConnector<IndexedTestType>({
		entitySchema: nameof<IndexedTestType>(),
		config: {
			...TEST_FIRESTORE_CONFIG,
			collectionName: `${TEST_FIRESTORE_CONFIG.collectionName}_indexed`
		}
	});
}

function createUnindexedConnector(): FirestoreEntityStorageConnector<UnindexedTestType> {
	return new FirestoreEntityStorageConnector<UnindexedTestType>({
		entitySchema: nameof<UnindexedTestType>(),
		config: {
			...TEST_FIRESTORE_CONFIG,
			collectionName: `${TEST_FIRESTORE_CONFIG.collectionName}_unindexed`
		}
	});
}

describe("FirestoreEntityStorageConnector", () => {
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
		300_000
	);
});
