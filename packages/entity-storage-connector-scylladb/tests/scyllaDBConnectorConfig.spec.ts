// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { HealthStatus } from "@twin.org/core";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { TEST_SCYLLA_CONFIG } from "./setupTestEnv.js";
import type { IScyllaDBTableConfig } from "../src/models/IScyllaDBTableConfig.js";
import { ScyllaDBTableConnector } from "../src/scyllaDBTableConnector.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("ScyllaDBTableConnector — constructor and health", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
	});

	test("can fail to construct when there are no options", () => {
		expect(
			() =>
				new ScyllaDBTableConnector(
					undefined as unknown as {
						entitySchema: string;
						config: IScyllaDBTableConfig;
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
				new ScyllaDBTableConnector(
					{} as unknown as {
						entitySchema: string;
						config: IScyllaDBTableConfig;
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
				new ScyllaDBTableConnector({ entitySchema: nameof<TestType>() } as unknown as {
					entitySchema: string;
					config: IScyllaDBTableConfig;
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.objectUndefined",
				properties: { property: "options.config", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there are no config hosts", () => {
		expect(
			() =>
				new ScyllaDBTableConnector({
					entitySchema: nameof<TestType>(),
					config: {} as IScyllaDBTableConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				properties: expect.objectContaining({ property: "options.config.hosts" })
			})
		);
	});

	test("can fail to construct when there is no config localDataCenter", () => {
		expect(
			() =>
				new ScyllaDBTableConnector({
					entitySchema: nameof<TestType>(),
					config: { hosts: ["localhost"] } as IScyllaDBTableConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.localDataCenter", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config keyspace", () => {
		expect(
			() =>
				new ScyllaDBTableConnector({
					entitySchema: nameof<TestType>(),
					config: { hosts: ["localhost"], localDataCenter: "datacenter1" } as IScyllaDBTableConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.keyspace", value: "undefined" }
			})
		);
	});

	test("can construct", () => {
		const connector = new ScyllaDBTableConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_SCYLLA_CONFIG
		});
		expect(connector).toBeDefined();
	});

	test("can bootstrap and get health as ok", async () => {
		const connector = new ScyllaDBTableConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: {
				...TEST_SCYLLA_CONFIG,
				tableName: `${TEST_SCYLLA_CONFIG.tableName}_cfg`
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
