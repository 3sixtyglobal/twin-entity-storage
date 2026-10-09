// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { entity, EntitySchemaFactory, EntitySchemaHelper, property } from "@3sixty/entity";
import { MemoryEntityStorageConnector } from "@3sixty/entity-storage-connector-memory";
import { EntityStorageConnectorFactory } from "@3sixty/entity-storage-models";
import { nameof } from "@3sixty/nameof";
import { EntityStorageService } from "../src/entityStorageService.js";

/**
 * Test Type Definition.
 */
@entity()
class TestType {
	/**
	 * Id.
	 */
	@property({ type: "string", isPrimary: true })
	public id!: string;

	/**
	 * Value1.
	 */
	@property({ type: "string", isSecondary: true })
	public value1!: string;

	/**
	 * Value2.
	 */
	@property({ type: "number", format: "uint8" })
	public value2!: number;

	/**
	 * User Identity.
	 */
	@property({ type: "string", optional: true })
	public userIdentity?: string;
}

let storage: MemoryEntityStorageConnector<TestType>;

describe("EntityStorageService", () => {
	beforeEach(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));

		storage = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "test-type" }
		});

		EntityStorageConnectorFactory.register("test-type", () => storage);
	});

	afterEach(async () => {
		await storage.teardown();
	});

	test("can create the service", async () => {
		const service = new EntityStorageService({ entityStorageType: "test-type" });
		expect(service).toBeDefined();
	});

	test("can set an entity", async () => {
		const service = new EntityStorageService({
			entityStorageType: "test-type"
		});
		await service.set({ id: "1", value1: "value1", value2: 42 });

		const store = await storage.getStore();
		expect(store).toEqual([{ id: "1", value1: "value1", value2: 42 }]);
	});

	test("can set batch of entities", async () => {
		const service = new EntityStorageService({
			entityStorageType: "test-type"
		});
		await service.setBatch([
			{ id: "1", value1: "value1", value2: 42 },
			{ id: "2", value1: "value2", value2: 43 },
			{ id: "3", value1: "value3", value2: 44 }
		]);

		const store = await storage.getStore();
		expect(store).toHaveLength(3);
		expect(store[0]).toEqual({ id: "1", value1: "value1", value2: 42 });
		expect(store[2]).toEqual({ id: "3", value1: "value3", value2: 44 });
	});

	test("can fail to set batch with no entities", async () => {
		const service = new EntityStorageService({
			entityStorageType: "test-type"
		});
		await expect(service.setBatch(undefined as unknown as TestType[])).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.array",
			properties: { property: "entities", value: "undefined" }
		});
	});

	test("can get an entity", async () => {
		const service = new EntityStorageService({
			entityStorageType: "test-type"
		});

		await service.set({ id: "1", value1: "value1", value2: 42 });

		const result = await service.get("1");

		expect(result).toEqual({ id: "1", value1: "value1", value2: 42 });
	});

	test("can get an entity using a secondary index", async () => {
		const service = new EntityStorageService({
			entityStorageType: "test-type"
		});

		await service.set({ id: "1", value1: "secondary-value", value2: 42 });

		const result = await service.get("secondary-value", "value1");

		expect(result).toEqual({ id: "1", value1: "secondary-value", value2: 42 });
	});

	test("can remove an entity", async () => {
		const service = new EntityStorageService({
			entityStorageType: "test-type"
		});

		await service.set({ id: "1", value1: "value1", value2: 42 });

		await service.remove("1");

		const store = await storage.getStore();
		expect(store).toEqual([]);
	});

	test("can query entities", async () => {
		const service = new EntityStorageService({
			entityStorageType: "test-type"
		});

		for (let i = 0; i < 10; i++) {
			await service.set({ id: (i + 1).toString(), value1: "value1", value2: 42 });
		}

		const result = await service.query();

		expect(result.entities.length).toEqual(10);
		expect(result.entities[0]).toEqual({
			id: "1",
			value1: "value1",
			value2: 42
		});
	});

	test("can empty with no items", async () => {
		const service = new EntityStorageService({
			entityStorageType: "test-type"
		});
		await service.empty();
		expect(await service.count()).toEqual(0);
	});

	test("can empty the store", async () => {
		const service = new EntityStorageService({
			entityStorageType: "test-type"
		});
		await service.set({ id: "1", value1: "value1", value2: 42 });
		await service.set({ id: "2", value1: "value2", value2: 43 });
		await service.set({ id: "3", value1: "value3", value2: 44 });
		await service.empty();
		expect(await service.count()).toEqual(0);
	});

	test("can fail to remove batch with no ids", async () => {
		const service = new EntityStorageService({
			entityStorageType: "test-type"
		});
		await expect(service.removeBatch(undefined as unknown as string[])).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.array",
			properties: { property: "ids", value: "undefined" }
		});
	});

	test("can remove batch of items", async () => {
		const service = new EntityStorageService({
			entityStorageType: "test-type"
		});
		await service.set({ id: "1", value1: "value1", value2: 42 });
		await service.set({ id: "2", value1: "value2", value2: 43 });
		await service.set({ id: "3", value1: "value3", value2: 44 });
		await service.removeBatch(["1", "2"]);
		expect(await service.count()).toEqual(1);
		expect(await service.get("3")).toBeDefined();
	});
});
