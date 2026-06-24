// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { Worker } from "node:worker_threads";
import { ContextIdStore } from "@twin.org/context";
import { Mutex, SharedObjectBuffer, SharedStore } from "@twin.org/core";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { MemoryEntityStorageConnector } from "../src/memoryEntityStorageConnector.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

async function clearSchema(schemaName: string): Promise<void> {
	await Mutex.lock(schemaName, { throwOnTimeout: true });
	try {
		SharedObjectBuffer.remove(schemaName);
	} finally {
		Mutex.unlock(schemaName);
	}
}

describe("MemoryEntityStorageConnector — SharedArrayBuffer concurrency", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));

		ContextIdStore.getContextIds = vi.fn().mockImplementation(async () => ({}));
	});

	afterEach(async () => {
		await clearSchema(nameof<TestType>());
	});

	// 1. Same-connector concurrent writes

	test("concurrent sets on one connector do not lose any update", async () => {
		const connector = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "concurrent-sets-test" }
		});

		const count = 20;
		await Promise.all(
			[...new Array(count).keys()].map(async i =>
				connector.set({ id: `item-${i}`, value1: `value-${i}` })
			)
		);

		expect(await connector.count()).toEqual(count);
		for (let i = 0; i < count; i++) {
			const item = await connector.get(`item-${i}`);
			expect(item?.value1).toEqual(`value-${i}`);
		}
	});

	test("concurrent reads during writes never return a torn snapshot", async () => {
		const connector = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "torn-snapshot-test" }
		});

		await connector.set({ id: "anchor", value1: "stable" });

		const ops: Promise<unknown>[] = [];
		for (let i = 0; i < 15; i++) {
			ops.push(connector.set({ id: `item-${i}`, value1: `v${i}` }));
			ops.push(connector.get("anchor"));
		}
		const results = await Promise.all(ops);

		// Odd indices are the get("anchor") results.
		for (let i = 1; i < results.length; i += 2) {
			expect(results[i]).toBeDefined();
			expect((results[i] as TestType).value1).toBe("stable");
		}
	});

	test("concurrent sets and counts do not throw", async () => {
		const connector = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "sets-and-counts-test" }
		});
		await connector.set({ id: "seed", value1: "x" });

		const ops: Promise<unknown>[] = [];
		for (let i = 0; i < 10; i++) {
			ops.push(connector.set({ id: `item-${i}`, value1: `v${i}` }));
		}
		for (let i = 0; i < 20; i++) {
			ops.push(connector.count());
		}

		await expect(Promise.all(ops)).resolves.toBeDefined();
	});

	// 2. Cross-instance buffer sharing (same thread)

	test("two connector instances for the same schema share the same buffer", async () => {
		const connector1 = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "shared-buffer-test" }
		});
		const connector2 = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "shared-buffer-test" }
		});

		await connector1.set({ id: "1", value1: "from-connector-1" });

		const item = await connector2.get("1");
		expect(item?.value1).toEqual("from-connector-1");
	});

	test("writes to one instance are immediately visible from the other", async () => {
		const connector1 = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "immediate-visibility-test" }
		});
		const connector2 = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "immediate-visibility-test" }
		});

		await connector1.set({ id: "1", value1: "v1" });
		await connector2.set({ id: "2", value1: "v2" });

		expect(await connector1.count()).toEqual(2);
		expect(await connector2.count()).toEqual(2);
	});

	test("teardown on one instance clears the shared buffer for all instances", async () => {
		const connector1 = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "teardown-clears-buffer-test" }
		});
		const connector2 = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "teardown-clears-buffer-test" }
		});

		await connector1.set({ id: "1", value1: "v1" });
		await connector1.teardown();

		expect(await connector2.count()).toEqual(0);
	});

	test("concurrent writes from two instances do not lose updates", async () => {
		const connector1 = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "concurrent-instances-test" }
		});
		const connector2 = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "concurrent-instances-test" }
		});

		const count = 10;
		await Promise.all([
			...[...new Array(count).keys()].map(async i =>
				connector1.set({ id: `c1-item-${i}`, value1: `c1-value-${i}` })
			),
			...[...new Array(count).keys()].map(async i =>
				connector2.set({ id: `c2-item-${i}`, value1: `c2-value-${i}` })
			)
		]);

		// Both sets of items must be present — no cross-write should clobber the other.
		expect(await connector1.count()).toEqual(count * 2);
	});

	// 3. Buffer capacity management

	test("buffer grows automatically when payload exceeds initial capacity", async () => {
		// Use a tiny initial capacity (256 bytes) so a handful of entities will overflow it.
		const schemaName = "cap-grow-test";

		await Mutex.lock(schemaName, { throwOnTimeout: true });
		try {
			SharedObjectBuffer.remove(schemaName); // ensure clean state from prior runs
			// 10 entities × ~60 bytes each ≈ 600 bytes — well above the 256-byte initial capacity.
			const entities = [...new Array(10).keys()].map(i => ({
				id: `item-${i}`,
				value1: `${"x".repeat(50)}-${i}`
			}));
			await SharedObjectBuffer.create(schemaName, { initialCapacityBytes: 256 });
			await SharedObjectBuffer.write<{ id: string; value1: string }[]>(schemaName, entities);
			const readBack =
				(await SharedObjectBuffer.read<{ id: string; value1: string }[]>(schemaName)) ?? [];
			expect(readBack).toHaveLength(10);
			expect(readBack[5].value1).toEqual(`${"x".repeat(50)}-5`);
		} finally {
			SharedObjectBuffer.remove(schemaName);
			Mutex.unlock(schemaName);
		}
	});

	test("buffer shrinks when payload drops well below capacity", async () => {
		// Write enough data to push the buffer beyond DEFAULT_CAPACITY_BYTES (1 MiB), then
		// write a tiny payload and confirm the data is still correct after the shrink.
		const schemaName = "cap-shrink-test";

		await Mutex.lock(schemaName, { throwOnTimeout: true });
		try {
			SharedObjectBuffer.remove(schemaName); // ensure clean state from prior runs
			// 1 200 entities × ~930 bytes each ≈ 1.1 MiB — exceeds DEFAULT_CAPACITY_BYTES.
			const largeEntities = [...new Array(1200).keys()].map(i => ({
				id: `item-${i}`,
				value1: "x".repeat(900)
			}));
			await SharedObjectBuffer.create(schemaName);
			await SharedObjectBuffer.write<{ id: string; value1: string }[]>(schemaName, largeEntities);

			// Now write a single tiny entity — triggers the shrink path.
			await SharedObjectBuffer.write<{ id: string; value1: string }[]>(schemaName, [
				{ id: "only", value1: "small" }
			]);

			const readBack =
				(await SharedObjectBuffer.read<{ id: string; value1: string }[]>(schemaName)) ?? [];
			expect(readBack).toHaveLength(1);
			expect(readBack[0].id).toEqual("only");
		} finally {
			SharedObjectBuffer.remove(schemaName);
			Mutex.unlock(schemaName);
		}
	});

	// 4. Cross-thread buffer sharing via a real Worker

	test("data written directly into the SharedArrayBuffer by a worker is visible to the connector", async () => {
		// Prime the buffer on the main thread so we have a reference to pass to the Worker.
		const connector = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "worker-visibility-test" }
		});
		// A single read is enough to materialise the SharedArrayBuffer on the main thread.
		await connector.count();

		const buffers = SharedStore.get<{ [key: string]: SharedArrayBuffer }>("sharedObjectBuffers");
		const buf = buffers?.["worker-visibility-test"];
		expect(buf).toBeInstanceOf(SharedArrayBuffer);

		// Spawn a Worker that writes entity JSON directly into the shared buffer using
		// the same layout as SharedObjectBuffer (4-byte Int32 header + UTF-8 JSON body).
		// This proves cross-thread memory sharing without needing to import TypeScript.
		const workerCode = `
import { workerData, parentPort } from 'node:worker_threads';
const { buffer } = workerData;
const entities = [{ id: 'from-worker', value1: 'worker-value' }];
const json = JSON.stringify(entities);
const encoded = new TextEncoder().encode(json);
const dataView = new Uint8Array(buffer, 4);      // HEADER_BYTES = 4
dataView.set(encoded);
Atomics.store(new Int32Array(buffer, 0, 1), 0, encoded.length);
parentPort.postMessage('done');
`;

		await new Promise<void>((resolve, reject) => {
			const worker = new Worker(workerCode, { eval: true, workerData: { buffer: buf } });
			worker.once("message", () => resolve());
			worker.once("error", reject);
		});

		// The main-thread connector reads the same memory — no copy, no serialisation.
		const item = await connector.get("from-worker");
		expect(item?.value1).toEqual("worker-value");
	});

	test("data written by the connector is immediately visible to a worker reading the shared buffer", async () => {
		const connector = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "worker-visibility-test-2" }
		});
		await connector.set({ id: "main-item", value1: "main-value" });

		const buffers = SharedStore.get<{ [key: string]: SharedArrayBuffer }>("sharedObjectBuffers");
		const buf = buffers?.["worker-visibility-test-2"];
		expect(buf).toBeInstanceOf(SharedArrayBuffer);

		// The worker reads the buffer directly and posts back the parsed entity array.
		const workerCode = `
import { workerData, parentPort } from 'node:worker_threads';
const { buffer } = workerData;
const dataLen = Atomics.load(new Int32Array(buffer, 0, 1), 0);
const bytes = new Uint8Array(buffer, 4, dataLen);
const entities = JSON.parse(new TextDecoder().decode(bytes));
parentPort.postMessage(entities);
`;

		const entities = await new Promise<TestType[]>((resolve, reject) => {
			const worker = new Worker(workerCode, { eval: true, workerData: { buffer: buf } });
			worker.once("message", (msg: TestType[]) => resolve(msg));
			worker.once("error", reject);
		});

		expect(entities.length).toEqual(1);
		expect(entities[0].id).toEqual("main-item");
		expect(entities[0].value1).toEqual("main-value");
	});
});
