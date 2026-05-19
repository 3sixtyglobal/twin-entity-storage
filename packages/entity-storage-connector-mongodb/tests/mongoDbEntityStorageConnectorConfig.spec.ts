// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { HealthStatus } from "@twin.org/core";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { TEST_MONGODB_CONFIG } from "./setupTestEnv.js";
import type { IMongoDbEntityStorageConnectorConfig } from "../src/models/IMongoDbEntityStorageConnectorConfig.js";
import { MongoDbEntityStorageConnector } from "../src/mongoDbEntityStorageConnector.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("MongoDbEntityStorageConnector — constructor and health", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
	});

	test("can fail to construct when there are no options", () => {
		expect(
			() =>
				new MongoDbEntityStorageConnector(
					undefined as unknown as {
						entitySchema: string;
						config: IMongoDbEntityStorageConnectorConfig;
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
				new MongoDbEntityStorageConnector(
					{} as unknown as {
						entitySchema: string;
						config: IMongoDbEntityStorageConnectorConfig;
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
				new MongoDbEntityStorageConnector({ entitySchema: nameof<TestType>() } as unknown as {
					entitySchema: string;
					config: IMongoDbEntityStorageConnectorConfig;
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.objectUndefined",
				properties: { property: "options.config", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config host", () => {
		expect(
			() =>
				new MongoDbEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {} as IMongoDbEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.host", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config database", () => {
		expect(
			() =>
				new MongoDbEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: { host: "localhost" } as IMongoDbEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.database", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config collection", () => {
		expect(
			() =>
				new MongoDbEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: { host: "localhost", database: "test" } as IMongoDbEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.collection", value: "undefined" }
			})
		);
	});

	test("can construct", () => {
		const connector = new MongoDbEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_MONGODB_CONFIG
		});
		expect(connector).toBeDefined();
	});

	test("can bootstrap and get health as ok", async () => {
		const connector = new MongoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: {
				...TEST_MONGODB_CONFIG,
				collection: `${TEST_MONGODB_CONFIG.collection}_cfg`
			}
		});
		await connector.bootstrap();
		const result = await connector.health();
		expect(result).toHaveLength(1);
		expect(result[0].status).toEqual(HealthStatus.Ok);
		expect(result[0].description).toEqual("healthDescription");
		await connector.teardown();
		await connector.stop?.();
	});
});
