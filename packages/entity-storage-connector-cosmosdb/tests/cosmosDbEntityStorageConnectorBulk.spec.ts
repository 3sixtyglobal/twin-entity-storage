// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { BulkOperationResult, Container, OperationInput } from "@azure/cosmos";
import { ContextIdStore } from "@twin.org/context";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { TEST_COSMOS_CONFIG } from "./setupTestEnv.js";
import { CosmosDbEntityStorageConnector } from "../src/cosmosDbEntityStorageConnector.js";

@entity()
class BulkTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "number" })
	public value!: number;
}

type BulkHandler = (operations: OperationInput[]) => BulkOperationResult[];

function result(operationInput: OperationInput, statusCode: number): BulkOperationResult {
	return statusCode < 400
		? { operationInput, response: { statusCode, requestCharge: 1, diagnostics: {} as never } }
		: {
				operationInput,
				error: Object.assign(new Error(`status ${statusCode}`), { code: statusCode })
			};
}

function createConnector(handler: BulkHandler): {
	connector: CosmosDbEntityStorageConnector<BulkTestType>;
	executeBulkOperations: ReturnType<typeof vi.fn>;
} {
	const connector = new CosmosDbEntityStorageConnector<BulkTestType>({
		entitySchema: nameof<BulkTestType>(),
		config: TEST_COSMOS_CONFIG
	});
	const executeBulkOperations = vi.fn(async (operations: OperationInput[]) => handler(operations));
	const containerProvider = connector as unknown as { getContainer: () => Promise<Container> };
	const container = { items: { executeBulkOperations } } as unknown as Container;
	vi.spyOn(containerProvider, "getContainer").mockResolvedValue(container);
	return { connector, executeBulkOperations };
}

function items(count: number): BulkTestType[] {
	return Array.from({ length: count }, (v, i) => ({ id: String(i + 1), value: i }));
}

describe("CosmosDbEntityStorageConnector bulk operations", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<BulkTestType>(), () =>
			EntitySchemaHelper.getSchema(BulkTestType)
		);

		ContextIdStore.getContextIds = vi
			.fn()
			.mockReturnValue({ node: "node", tenant: "tenant", user: "user" });
	});

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("setBatch retries only the throttled operations until they succeed", async () => {
		let call = 0;
		const { connector, executeBulkOperations } = createConnector(operations => {
			call++;
			return operations.map((op, i) => result(op, call === 1 && i % 2 === 0 ? 429 : 200));
		});

		const promise = connector.setBatch(items(10));
		await vi.runAllTimersAsync();
		await expect(promise).resolves.toBeUndefined();

		expect(executeBulkOperations).toHaveBeenCalledTimes(2);
		expect(executeBulkOperations.mock.calls[1][0]).toHaveLength(5);
	});

	test("setBatch fails when an operation fails with a non transient status", async () => {
		const { connector, executeBulkOperations } = createConnector(operations =>
			operations.map((op, i) => result(op, i === 3 ? 400 : 200))
		);

		await expect(connector.setBatch(items(10))).rejects.toMatchObject({
			name: "GeneralError",
			message: "cosmosDbEntityStorageConnector.setBatchFailed",
			cause: {
				name: "GeneralError",
				message: "cosmosDbEntityStorageConnector.bulkOperationFailed",
				properties: { failedCount: 1, totalCount: 10, statusCode: 400 }
			}
		});
		expect(executeBulkOperations).toHaveBeenCalledTimes(1);
	});

	test("setBatch fails when throttling persists beyond the retry limit", async () => {
		const { connector, executeBulkOperations } = createConnector(operations =>
			operations.map(op => result(op, 429))
		);

		const promise = connector.setBatch(items(3));
		const assertion = expect(promise).rejects.toMatchObject({
			message: "cosmosDbEntityStorageConnector.setBatchFailed",
			cause: {
				message: "cosmosDbEntityStorageConnector.bulkOperationFailed",
				properties: { failedCount: 3, totalCount: 3, statusCode: 429 }
			}
		});
		await vi.runAllTimersAsync();
		await assertion;
		expect(executeBulkOperations).toHaveBeenCalledTimes(5);
	});

	test("setBatch fails when a result has neither a response nor an error", async () => {
		const { connector } = createConnector(operations =>
			operations.map(operationInput => ({ operationInput }))
		);

		await expect(connector.setBatch(items(2))).rejects.toMatchObject({
			message: "cosmosDbEntityStorageConnector.setBatchFailed",
			cause: { message: "cosmosDbEntityStorageConnector.bulkOperationFailed" }
		});
	});

	test("removeBatch treats not found as success", async () => {
		const { connector, executeBulkOperations } = createConnector(operations =>
			operations.map((op, i) => result(op, i === 0 ? 404 : 204))
		);

		await expect(connector.removeBatch(["1", "2", "3"])).resolves.toBeUndefined();
		expect(executeBulkOperations).toHaveBeenCalledTimes(1);
	});

	test("removeBatch fails when a delete fails with a non transient status", async () => {
		const { connector } = createConnector(operations =>
			operations.map((op, i) => result(op, i === 0 ? 403 : 204))
		);

		await expect(connector.removeBatch(["1", "2"])).rejects.toMatchObject({
			message: "cosmosDbEntityStorageConnector.removeBatchFailed",
			cause: {
				message: "cosmosDbEntityStorageConnector.bulkOperationFailed",
				properties: { failedCount: 1, totalCount: 2, statusCode: 403 }
			}
		});
	});
});
