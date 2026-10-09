// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@3sixty/entity";
import { nameof } from "@3sixty/nameof";
import { FileEntityStorageConnector } from "../src/fileEntityStorageConnector.js";

const TEST_DIRECTORY = "./.tmp/test-concurrency/";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("FileEntityStorageConnector - concurrent updates and store integrity", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
	});

	beforeEach(async () => {
		await rm(TEST_DIRECTORY, { recursive: true, force: true });
	});

	afterAll(async () => {
		await rm(TEST_DIRECTORY, { recursive: true, force: true });
	});

	test("can set entities concurrently without losing updates or tearing the store", async () => {
		const connector = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await connector.bootstrap();

		const count = 20;
		const updates: Promise<void>[] = [];
		for (let i = 0; i < count; i++) {
			updates.push(connector.set({ id: `item-${i}`, value1: `value-${i}` }));
		}
		await Promise.all(updates);

		// The persisted store must be valid JSON and contain every update -
		// unserialized read-modify-write cycles lose entities, and torn
		// whole-file writes corrupt the JSON.
		const raw = await readFile(path.join(TEST_DIRECTORY, "store.json"), "utf8");
		const store = JSON.parse(raw) as TestType[];
		expect(store.length).toEqual(count);

		for (let i = 0; i < count; i++) {
			const item = await connector.get(`item-${i}`);
			expect(item?.value1).toEqual(`value-${i}`);
		}
	});

	test("can throw a descriptive error when the store file is corrupt", async () => {
		const connector = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await connector.bootstrap();
		await connector.set({ id: "item-1", value1: "value-1" });

		// Simulate a torn write: a complete JSON array followed by the tail of a
		// second interleaved write.
		const filename = path.join(TEST_DIRECTORY, "store.json");
		const raw = await readFile(filename, "utf8");
		await writeFile(filename, `${raw}\t{`, "utf8");

		await expect(connector.get("item-1")).rejects.toMatchObject({
			name: "GeneralError",
			message: "fileEntityStorageConnector.readStoreCorrupt",
			properties: { directory: path.resolve(TEST_DIRECTORY) }
		});
	});

	test("concurrent reads during writes never return false-empty - guards against rename-window ENOENT misread", async () => {
		const connector = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await connector.bootstrap();

		// Seed entities before the concurrent phase so every read must see at
		// least these entries.  A count of 0 would mean the read landed in the
		// OS rename(tmp→store.json) window and ENOENT was silently treated as
		// "new store".
		for (let i = 0; i < 5; i++) {
			await connector.set({ id: `seed-${i}`, value1: `val-${i}` });
		}

		const writes: Promise<void>[] = [];
		for (let i = 0; i < 10; i++) {
			writes.push(connector.set({ id: `extra-${i}`, value1: `extra-${i}` }));
		}
		const reads: Promise<number>[] = [];
		for (let i = 0; i < 20; i++) {
			reads.push(connector.count());
		}

		const [, counts] = await Promise.all([Promise.all(writes), Promise.all(reads)]);

		for (const c of counts) {
			expect(c).toBeGreaterThan(0);
		}
	});

	test("get concurrent with a write always returns the anchored entity - never undefined due to ENOENT race", async () => {
		const connector = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await connector.bootstrap();

		// "anchor" is written first and must remain visible regardless of
		// concurrent modifications to the store file.
		await connector.set({ id: "anchor", value1: "stable" });

		const ops: Promise<unknown>[] = [];
		for (let i = 0; i < 15; i++) {
			ops.push(connector.set({ id: `item-${i}`, value1: `v${i}` }));
			ops.push(connector.get("anchor"));
		}
		const results = await Promise.all(ops);

		// Odd indices are get("anchor") results.
		for (let i = 1; i < results.length; i += 2) {
			expect(results[i]).toBeDefined();
			expect((results[i] as TestType).value1).toBe("stable");
		}
	});

	test("concurrent reads do not throw when writes are in flight", async () => {
		const connector = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await connector.bootstrap();
		await connector.set({ id: "a", value1: "x" });

		const ops: Promise<unknown>[] = [];
		for (let i = 0; i < 10; i++) {
			ops.push(connector.set({ id: `item-${i}`, value1: `v${i}` }));
		}
		for (let i = 0; i < 20; i++) {
			ops.push(connector.count());
		}

		await expect(Promise.all(ops)).resolves.toBeDefined();
	});
});
