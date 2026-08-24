// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { rm } from "node:fs/promises";
import { HealthStatus } from "@twin.org/api-models";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { FileEntityStorageConnector } from "../src/fileEntityStorageConnector.js";

const TEST_DIRECTORY = "./.tmp/test-config/";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

@entity()
class LongNameTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", isSecondary: true })
	public dateCreatedWithLongerNameForIndex!: string;

	@property({ type: "string", isSecondary: true })
	public dateModifiedWithLongerNameForIndex!: string;
}

describe("FileEntityStorageConnector - constructor, bootstrap, and health", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
	});

	afterAll(async () => {
		await rm(TEST_DIRECTORY, { recursive: true, force: true });
	});

	test("can fail to construct when there are no options", () => {
		expect(
			() =>
				new FileEntityStorageConnector(
					undefined as unknown as {
						entitySchema: string;
						config: { directory: string };
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
				new FileEntityStorageConnector(
					{} as unknown as {
						entitySchema: string;
						config: { directory: string };
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
				new FileEntityStorageConnector({ entitySchema: nameof<TestType>() } as unknown as {
					entitySchema: string;
					config: { directory: string };
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.objectUndefined",
				properties: { property: "options.config", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config directory", () => {
		expect(
			() =>
				new FileEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {} as { directory: string }
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.directory", value: "undefined" }
			})
		);
	});

	test("can construct", () => {
		const connector = new FileEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		expect(connector).toBeDefined();
	});

	test("can bootstrap and create directory", async () => {
		const connector = new FileEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: { directory: `${TEST_DIRECTORY}bootstrap-new/` }
		});
		const result = await connector.bootstrap?.();
		expect(result).toBe(true);
		await connector.teardown?.();
	});

	test("can bootstrap when directory already exists", async () => {
		const connector = new FileEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: { directory: `${TEST_DIRECTORY}bootstrap-exists/` }
		});
		await connector.bootstrap?.();
		const result = await connector.bootstrap?.();
		expect(result).toBe(true);
		await connector.teardown?.();
	});

	test("can get health as ok with default thresholds", async () => {
		const connector = new FileEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: { directory: `${TEST_DIRECTORY}health-ok/` }
		});
		await connector.bootstrap?.();
		const result = await connector.health();
		expect(result).toHaveLength(1);
		expect(result[0].status).toEqual(HealthStatus.Ok);
		expect(result[0].description).toEqual("healthDescription");
		await connector.teardown?.();
	});

	test("can get health as warning when disk space is below warning threshold", async () => {
		const connector = new FileEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: {
				directory: `${TEST_DIRECTORY}health-warn/`,
				diskWarningThresholdBytes: Number.MAX_SAFE_INTEGER,
				diskErrorThresholdBytes: 1
			}
		});
		await connector.bootstrap?.();
		const result = await connector.health();
		expect(result).toHaveLength(1);
		expect(result[0].status).toEqual(HealthStatus.Warning);
		expect(result[0].description).toEqual("healthDescription");
		await connector.teardown?.();
	});

	test("can get health as error when disk space is below error threshold", async () => {
		const connector = new FileEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: {
				directory: `${TEST_DIRECTORY}health-error/`,
				diskErrorThresholdBytes: Number.MAX_SAFE_INTEGER
			}
		});
		await connector.bootstrap?.();
		const result = await connector.health();
		expect(result).toHaveLength(1);
		expect(result[0].status).toEqual(HealthStatus.Error);
		expect(result[0].description).toEqual("healthDescription");
		await connector.teardown?.();
	});
});

describe("FileEntityStorageConnector - long identifier bootstrap", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<LongNameTestType>(), () =>
			EntitySchemaHelper.getSchema(LongNameTestType)
		);
	});

	afterAll(async () => {
		await rm("./.tmp/long-identifier-test/", { recursive: true, force: true });
	});

	test("can bootstrap with a long identifier name", async () => {
		const connector = new FileEntityStorageConnector<LongNameTestType>({
			entitySchema: nameof<LongNameTestType>(),
			config: { directory: "./.tmp/long-identifier-test/" }
		});
		const bootstrapped = await connector.bootstrap?.();
		expect(bootstrapped).toBe(true);
		await connector.teardown?.();
	});
});
