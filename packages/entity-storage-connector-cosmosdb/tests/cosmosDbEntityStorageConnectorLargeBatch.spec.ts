// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@twin.org/entity";
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";
import { TEST_COSMOS_CONFIG } from "./setupTestEnv.js";
import { CosmosDbEntityStorageConnector } from "../src/cosmosDbEntityStorageConnector.js";

const SUPPORT_LARGE_BATCH = true;

@entity()
class LargeBatchTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "number", format: "uint32" })
	public value!: number;
}

function createConnector(): IEntityStorageConnector<LargeBatchTestType> {
	return new CosmosDbEntityStorageConnector<LargeBatchTestType>({
		entitySchema: nameof<LargeBatchTestType>(),
		config: {
			...TEST_COSMOS_CONFIG,
			containerId: `${TEST_COSMOS_CONFIG.containerId}_largebatch_${Date.now()}`
		}
	});
}

describe("CosmosDbEntityStorageConnector", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<LargeBatchTestType>(), () =>
			EntitySchemaHelper.getSchema(LargeBatchTestType)
		);

		ContextIdStore.getContextIds = vi
			.fn()
			.mockReturnValue({ node: "node", tenant: "tenant", user: "user" });
	});

	test.skipIf(!SUPPORT_LARGE_BATCH)(
		"handles large batch via setBatch",
		async () => {
			const connector = createConnector();
			await connector.bootstrap?.();

			try {
				const rowCount = process.env.CI ? 10_000 : 100_000;
				const items: LargeBatchTestType[] = [];
				for (let i = 0; i < rowCount; i++) {
					items.push({ id: String(i + 1), value: i });
				}

				await connector.setBatch(items);

				const midIndex = Math.floor(rowCount / 2);
				const stored = await connector.get(String(midIndex));
				expect(stored).toBeDefined();
				expect(stored?.value).toBe(midIndex - 1);

				const total = await connector.count();
				expect(total).toBe(rowCount);
			} finally {
				try {
					await connector.teardown?.();
				} catch {}
				try {
					await connector.stop?.();
				} catch {}
			}
		},
		600_000
	);
});
