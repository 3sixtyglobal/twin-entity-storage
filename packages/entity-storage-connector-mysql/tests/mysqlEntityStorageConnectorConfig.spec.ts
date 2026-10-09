// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { HealthStatus } from "@3sixty/api-models";
import { ComponentFactory } from "@3sixty/core";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@3sixty/entity";
import type { ILogEntry } from "@3sixty/logging-models";
import { nameof } from "@3sixty/nameof";
import { TEST_MYSQL_CONFIG } from "./setupTestEnv.js";
import type { IMySqlEntityStorageConnectorConfig } from "../src/models/IMySqlEntityStorageConnectorConfig.js";
import { MySqlEntityStorageConnector } from "../src/mysqlEntityStorageConnector.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("MySqlEntityStorageConnector - constructor and health", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
	});

	test("can fail to construct when there are no options", () => {
		expect(
			() =>
				new MySqlEntityStorageConnector(
					undefined as unknown as {
						entitySchema: string;
						config: IMySqlEntityStorageConnectorConfig;
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
				new MySqlEntityStorageConnector(
					{} as unknown as {
						entitySchema: string;
						config: IMySqlEntityStorageConnectorConfig;
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
				new MySqlEntityStorageConnector({ entitySchema: nameof<TestType>() } as unknown as {
					entitySchema: string;
					config: IMySqlEntityStorageConnectorConfig;
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
				new MySqlEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {} as IMySqlEntityStorageConnectorConfig
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
				new MySqlEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: { host: "localhost" } as IMySqlEntityStorageConnectorConfig
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
				new MySqlEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: { host: "localhost", user: "root" } as IMySqlEntityStorageConnectorConfig
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
				new MySqlEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {
						host: "localhost",
						user: "root",
						password: "pass"
					} as IMySqlEntityStorageConnectorConfig
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
				new MySqlEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {
						host: "localhost",
						user: "root",
						password: "pass",
						database: "test"
					} as IMySqlEntityStorageConnectorConfig
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
		const connector = new MySqlEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_MYSQL_CONFIG
		});
		expect(connector).toBeDefined();
	});

	test("can bootstrap and get health as ok", async () => {
		const connector = new MySqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: {
				...TEST_MYSQL_CONFIG,
				tableName: `${TEST_MYSQL_CONFIG.tableName}_cfg`
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

@entity()
class LongNameTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", isSecondary: true })
	public dateCreatedWithLongerNameForIndex!: string;

	@property({ type: "string", isSecondary: true })
	public dateModifiedWithLongerNameForIndex!: string;
}

describe("MySqlEntityStorageConnector - long identifier bootstrap", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<LongNameTestType>(), () =>
			EntitySchemaHelper.getSchema(LongNameTestType)
		);
	});

	test("can bootstrap with a long identifier name", async () => {
		const connector = new MySqlEntityStorageConnector<LongNameTestType>({
			entitySchema: nameof<LongNameTestType>(),
			config: {
				...TEST_MYSQL_CONFIG,
				tableName: "long-org-prefix-entity-storage-record-type-with-long-name"
			}
		});
		const bootstrapped = await connector.bootstrap();
		expect(bootstrapped).toBe(true);
		await connector.teardown();
		await connector.stop?.();
	});

	test("reports a table creation failure against the table name", async () => {
		const tooLongTableName = "x".repeat(65);
		const logEntries: ILogEntry[] = [];
		ComponentFactory.register("test-logging-long-table", () => ({
			className: () => "TestLogging",
			log: async (entry: ILogEntry) => {
				logEntries.push(entry);
			}
		}));

		const connector = new MySqlEntityStorageConnector<LongNameTestType>({
			entitySchema: nameof<LongNameTestType>(),
			config: {
				...TEST_MYSQL_CONFIG,
				tableName: tooLongTableName
			}
		});

		try {
			const bootstrapped = await connector.bootstrap("test-logging-long-table");
			expect(bootstrapped).toBe(false);

			const errorEntries = logEntries.filter(entry => entry.level === "error");
			expect(errorEntries).toHaveLength(1);
			expect(errorEntries[0].source).toEqual(MySqlEntityStorageConnector.CLASS_NAME);
			expect(errorEntries[0].message).toEqual("tableCreateFailed");
			expect(errorEntries[0].data).toEqual({ tableName: tooLongTableName });
			expect(errorEntries[0].error?.message).toContain("is too long");
		} finally {
			ComponentFactory.unregister("test-logging-long-table");
			await connector.teardown();
			await connector.stop?.();
		}
	});
});
