// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import os from "node:os";
import path from "node:path";
import { ContextIdStore } from "@3sixty/context";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@3sixty/entity";
import type { IEntityStorageConnector } from "@3sixty/entity-storage-models";
import { nameof } from "@3sixty/nameof";
import { FileEntityStorageConnector } from "../src/fileEntityStorageConnector.js";

// File connector serialises the entire store as a single JSON file; 1M rows would produce
// a file too large to read and write efficiently within test timeouts.
const SUPPORT_LARGE_BATCH = true;

@entity()
class LargeBatchTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "number", format: "uint32" })
	public value!: number;
}

function createConnector(): IEntityStorageConnector<LargeBatchTestType> {
	return new FileEntityStorageConnector<LargeBatchTestType>({
		entitySchema: nameof<LargeBatchTestType>(),
		config: { directory: path.join(os.tmpdir(), `entity-storage-largebatch-${Date.now()}`) }
	});
}

describe("FileEntityStorageConnector", () => {
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
