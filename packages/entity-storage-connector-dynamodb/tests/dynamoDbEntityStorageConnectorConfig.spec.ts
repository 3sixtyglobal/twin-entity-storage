// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { HealthStatus } from "@3sixty/api-models";
import { ContextIdStore } from "@3sixty/context";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@3sixty/entity";
import { nameof } from "@3sixty/nameof";
import { TEST_DYNAMODB_CONFIG } from "./setupTestEnv.js";
import { DynamoDbEntityStorageConnector } from "../src/dynamoDbEntityStorageConnector.js";
import type { IDynamoDbEntityStorageConnectorConfig } from "../src/models/IDynamoDbEntityStorageConnectorConfig.js";

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

describe("DynamoDbEntityStorageConnector - constructor and health", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));

		ContextIdStore.getContextIds = vi
			.fn()
			.mockImplementation(() => ({ node: "node", tenant: "tenant", user: "user" }));
	});

	test("can fail to construct when there are no options", () => {
		expect(
			() =>
				new DynamoDbEntityStorageConnector(
					undefined as unknown as {
						entitySchema: string;
						config: IDynamoDbEntityStorageConnectorConfig;
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
				new DynamoDbEntityStorageConnector(
					{} as unknown as {
						entitySchema: string;
						config: IDynamoDbEntityStorageConnectorConfig;
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
				new DynamoDbEntityStorageConnector({ entitySchema: nameof<TestType>() } as unknown as {
					entitySchema: string;
					config: IDynamoDbEntityStorageConnectorConfig;
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.objectUndefined",
				properties: { property: "options.config", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config region", () => {
		expect(
			() =>
				new DynamoDbEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {
						accessKeyId: "test",
						secretAccessKey: "test",
						tableName: "test"
					} as IDynamoDbEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.region", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config tableName", () => {
		expect(
			() =>
				new DynamoDbEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {
						region: "us-east-1",
						accessKeyId: "test",
						secretAccessKey: "test"
					} as IDynamoDbEntityStorageConnectorConfig
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
		const connector = new DynamoDbEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		expect(connector).toBeDefined();
	});

	test("can construct and bootstrap", async () => {
		const connector = new DynamoDbEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: { ...TEST_DYNAMODB_CONFIG, tableName: `${TEST_DYNAMODB_CONFIG.tableName}_cfg` }
		});
		const result = await connector.bootstrap();
		expect(result).toBe(true);
		await connector.teardown();
	});

	test("can get health as ok when connection succeeds", async () => {
		const connector = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: {
				...TEST_DYNAMODB_CONFIG,
				tableName: `${TEST_DYNAMODB_CONFIG.tableName}_health`
			}
		});
		await connector.bootstrap();
		const result = await connector.health();
		expect(result).toHaveLength(1);
		expect(result[0].status).toEqual(HealthStatus.Ok);
		expect(result[0].description).toEqual("healthDescription");
		await connector.teardown();
	});

	test("can get health as error when connection fails", async () => {
		const connector = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_DYNAMODB_CONFIG
		});
		const connectorInternal = connector as unknown as { getClient: () => Promise<unknown> };
		vi.spyOn(connectorInternal, "getClient").mockResolvedValue({
			describeTable: vi.fn().mockRejectedValueOnce(new Error("Connection refused"))
		});
		const result = await connector.health();
		expect(result).toHaveLength(1);
		expect(result[0].status).toEqual(HealthStatus.Error);
		expect(result[0].message).toEqual("connectionFailed");
	});

	test("partition key mismatch: different context ids between write and read produce no result", async () => {
		const connector = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			partitionContextIds: ["node"],
			config: {
				...TEST_DYNAMODB_CONFIG,
				tableName: `${TEST_DYNAMODB_CONFIG.tableName}_partition_mismatch`
			}
		});
		await connector.bootstrap();

		const rawDid =
			"did:iota:testnet:0x4f90da6f080e04dac1be0d13cc8bfe0097236b0c37f150f876921c3d06919a9f";

		ContextIdStore.getContextIds = vi.fn().mockResolvedValue({
			node: rawDid,
			tenant: "tenant",
			user: "user"
		});

		const recordId = "test-record-id";
		await connector.set({ id: recordId, value1: "data" });
		const writtenRecord = await connector.get(recordId);
		expect(writtenRecord).toBeDefined();

		const base64Did = "T5DabwgOBNrBvg0TzIv-AJcjaww38VD4dpIcPQaRmp8";
		ContextIdStore.getContextIds = vi.fn().mockResolvedValue({
			node: base64Did,
			tenant: "tenant",
			user: "user"
		});

		const readRecord = await connector.get(recordId);
		expect(readRecord).toBeUndefined();

		ContextIdStore.getContextIds = vi
			.fn()
			.mockImplementation(() => ({ node: "node", tenant: "tenant", user: "user" }));

		await connector.teardown();
	});
});

describe("DynamoDbEntityStorageConnector - long identifier bootstrap", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<LongNameTestType>(), () =>
			EntitySchemaHelper.getSchema(LongNameTestType)
		);

		ContextIdStore.getContextIds = vi
			.fn()
			.mockImplementation(() => ({ node: "node", tenant: "tenant", user: "user" }));
	});

	test("can bootstrap with a long identifier name", async () => {
		const connector = new DynamoDbEntityStorageConnector<LongNameTestType>({
			entitySchema: nameof<LongNameTestType>(),
			config: {
				...TEST_DYNAMODB_CONFIG,
				tableName: "long-org-prefix-entity-storage-record-type-with-long-name"
			}
		});
		const bootstrapped = await connector.bootstrap();
		expect(bootstrapped).toBe(true);
		await connector.teardown();
	});
});
