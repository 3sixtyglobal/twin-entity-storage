// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { entity, EntitySchemaFactory, EntitySchemaHelper, property } from "@twin.org/entity";
import { MemoryEntityStorageConnector } from "@twin.org/entity-storage-connector-memory";
import { EntityStorageConnectorFactory } from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";
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
			entitySchema: nameof<TestType>()
		});

		EntityStorageConnectorFactory.register("test-type", () => storage);
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

		expect(storage.getStore()).toEqual([{ id: "1", value1: "value1", value2: 42 }]);
	});

	test("can remove an entity", async () => {
		const service = new EntityStorageService({
			entityStorageType: "test-type"
		});

		await service.set({ id: "1", value1: "value1", value2: 42 });

		await service.remove("1");

		expect(storage.getStore()).toEqual([]);
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
});
