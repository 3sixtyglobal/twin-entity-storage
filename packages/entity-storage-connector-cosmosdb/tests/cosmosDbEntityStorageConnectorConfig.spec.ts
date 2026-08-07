// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { HealthStatus } from "@twin.org/api-models";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { TEST_COSMOS_CONFIG } from "./setupTestEnv.js";
import { CosmosDbEntityStorageConnector } from "../src/cosmosDbEntityStorageConnector.js";
import type { ICosmosDbEntityStorageConnectorConfig } from "../src/models/ICosmosDbEntityStorageConnectorConfig.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("CosmosDbEntityStorageConnector - constructor and health", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
	});

	test("can fail to construct when there are no options", () => {
		expect(
			() =>
				new CosmosDbEntityStorageConnector(
					undefined as unknown as {
						entitySchema: string;
						config: ICosmosDbEntityStorageConnectorConfig;
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
				new CosmosDbEntityStorageConnector(
					{} as unknown as {
						entitySchema: string;
						config: ICosmosDbEntityStorageConnectorConfig;
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

	test("can fail to construct when there is no config", () => {
		expect(
			() =>
				new CosmosDbEntityStorageConnector({ entitySchema: nameof<TestType>() } as unknown as {
					entitySchema: string;
					config: ICosmosDbEntityStorageConnectorConfig;
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.objectUndefined",
				properties: { property: "options.config", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config endpoint", () => {
		expect(
			() =>
				new CosmosDbEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {} as ICosmosDbEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.endpoint", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config key", () => {
		expect(
			() =>
				new CosmosDbEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: { endpoint: "https://localhost:8081" } as ICosmosDbEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.key", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config databaseId", () => {
		expect(
			() =>
				new CosmosDbEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {
						endpoint: "https://localhost:8081",
						key: "test-key"
					} as ICosmosDbEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.databaseId", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config containerId", () => {
		expect(
			() =>
				new CosmosDbEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {
						endpoint: "https://localhost:8081",
						key: "test-key",
						databaseId: "test-db"
					} as ICosmosDbEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.containerId", value: "undefined" }
			})
		);
	});

	test("can construct", () => {
		const connector = new CosmosDbEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_COSMOS_CONFIG
		});
		expect(connector).toBeDefined();
	});

	test("can bootstrap and get health as ok", async () => {
		const connector = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: {
				...TEST_COSMOS_CONFIG,
				containerId: `${TEST_COSMOS_CONFIG.containerId}_cfg`
			}
		});
		await connector.bootstrap();
		const result = await connector.health();
		expect(result).toHaveLength(1);
		expect(result[0].status).toEqual(HealthStatus.Ok);
		expect(result[0].description).toEqual("healthDescription");
		await connector.teardown();
	});
});
