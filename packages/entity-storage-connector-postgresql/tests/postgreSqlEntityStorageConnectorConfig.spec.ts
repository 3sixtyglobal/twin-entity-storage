// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { HealthStatus } from "@twin.org/core";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { TEST_POSTGRESQL_CONFIG } from "./setupTestEnv.js";
import type { IPostgreSqlEntityStorageConnectorConfig } from "../src/models/IPostgreSqlEntityStorageConnectorConfig.js";
import { PostgreSqlEntityStorageConnector } from "../src/postgreSqlEntityStorageConnector.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("PostgreSqlEntityStorageConnector — constructor and health", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
	});

	test("can fail to construct when there are no options", () => {
		expect(
			() =>
				new PostgreSqlEntityStorageConnector(
					undefined as unknown as {
						entitySchema: string;
						config: IPostgreSqlEntityStorageConnectorConfig;
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
				new PostgreSqlEntityStorageConnector(
					{} as unknown as {
						entitySchema: string;
						config: IPostgreSqlEntityStorageConnectorConfig;
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
				new PostgreSqlEntityStorageConnector({ entitySchema: nameof<TestType>() } as unknown as {
					entitySchema: string;
					config: IPostgreSqlEntityStorageConnectorConfig;
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
				new PostgreSqlEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {} as IPostgreSqlEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.host", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config user", () => {
		expect(
			() =>
				new PostgreSqlEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: { host: "localhost" } as IPostgreSqlEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.user", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config password", () => {
		expect(
			() =>
				new PostgreSqlEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: { host: "localhost", user: "postgres" } as IPostgreSqlEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.password", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config database", () => {
		expect(
			() =>
				new PostgreSqlEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {
						host: "localhost",
						user: "postgres",
						password: "pass"
					} as IPostgreSqlEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.database", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config tableName", () => {
		expect(
			() =>
				new PostgreSqlEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {
						host: "localhost",
						user: "postgres",
						password: "pass",
						database: "test"
					} as IPostgreSqlEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.tableName", value: "undefined" }
			})
		);
	});

	test("can construct", () => {
		const connector = new PostgreSqlEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_POSTGRESQL_CONFIG
		});
		expect(connector).toBeDefined();
	});

	test("can bootstrap and get health as ok", async () => {
		const connector = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: {
				...TEST_POSTGRESQL_CONFIG,
				tableName: `${TEST_POSTGRESQL_CONFIG.tableName}_cfg`
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
