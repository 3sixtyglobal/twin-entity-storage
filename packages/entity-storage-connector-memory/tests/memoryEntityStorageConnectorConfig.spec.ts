// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { HealthStatus } from "@twin.org/core";
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

describe("MemoryEntityStorageConnector — constructor and health", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
	});

	test("can fail to construct when there are no options", () => {
		expect(
			() =>
				new MemoryEntityStorageConnector(
					undefined as unknown as {
						entitySchema: string;
						config: { storageKey: string };
					}
				)
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.objectUndefined",
				properties: { property: "options", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no schema", () => {
		expect(
			() =>
				new MemoryEntityStorageConnector(
					{} as unknown as {
						entitySchema: string;
						config: { storageKey: string };
					}
				)
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.entitySchema", value: "undefined" }
			})
		);
	});

	test("can construct", () => {
		const connector = new MemoryEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "test" }
		});
		expect(connector).toBeDefined();
	});

	test("can get health as ok", async () => {
		const connector = new MemoryEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "test" }
		});
		const result = await connector.health();
		expect(result).toHaveLength(1);
		expect(result[0].status).toEqual(HealthStatus.Ok);
		expect(result[0].description).toEqual("healthDescription");
	});
});
