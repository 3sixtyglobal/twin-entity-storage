// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { HealthStatus } from "@twin.org/api-models";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { TEST_FIRESTORE_CONFIG } from "./setupTestEnv.js";
import { FirestoreEntityStorageConnector } from "../src/firestoreEntityStorageConnector.js";
import type { IFirestoreEntityStorageConnectorConfig } from "../src/models/IFirestoreEntityStorageConnectorConfig.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("FirestoreEntityStorageConnector - constructor and health", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
	});

	test("can fail to construct when there are no options", () => {
		expect(
			() =>
				new FirestoreEntityStorageConnector(
					undefined as unknown as {
						entitySchema: string;
						config: IFirestoreEntityStorageConnectorConfig;
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
				new FirestoreEntityStorageConnector(
					{} as unknown as {
						entitySchema: string;
						config: IFirestoreEntityStorageConnectorConfig;
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
				new FirestoreEntityStorageConnector({ entitySchema: nameof<TestType>() } as unknown as {
					entitySchema: string;
					config: IFirestoreEntityStorageConnectorConfig;
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.objectUndefined",
				properties: { property: "options.config", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config projectId", () => {
		expect(
			() =>
				new FirestoreEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: {} as IFirestoreEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.projectId", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no config collectionName", () => {
		expect(
			() =>
				new FirestoreEntityStorageConnector({
					entitySchema: nameof<TestType>(),
					config: { projectId: "test-project" } as IFirestoreEntityStorageConnectorConfig
				})
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.collectionName", value: "undefined" }
			})
		);
	});

	test("can construct", () => {
		const connector = new FirestoreEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			config: TEST_FIRESTORE_CONFIG
		});
		expect(connector).toBeDefined();
	});

	test("can bootstrap and get health as ok", async () => {
		const connector = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: {
				...TEST_FIRESTORE_CONFIG,
				collectionName: `${TEST_FIRESTORE_CONFIG.collectionName}_cfg`
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
