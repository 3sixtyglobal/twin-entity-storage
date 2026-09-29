// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	entity,
	property
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { Client } from "cassandra-driver";
import { TEST_SCYLLA_CONFIG } from "./setupTestEnv.js";
import type { IScyllaDBViewConnectorConstructorOptions } from "../src/models/IScyllaDBViewConnectorConstructorOptions.js";
import { ScyllaDBTableConnector } from "../src/scyllaDBTableConnector.js";
import { ScyllaDBViewConnector } from "../src/scyllaDBViewConnector.js";

@entity()
class BaseType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", isSecondary: true })
	public category!: string;

	@property({ type: "string", optional: true })
	public status?: string;

	@property({ type: "string" })
	public description!: string;
}

@entity()
class ViewByStatus {
	@property({ type: "string", isPrimary: true })
	public status!: string;

	@property({ type: "string" })
	public id!: string;

	@property({ type: "string" })
	public category!: string;
}

const BASE_TABLE_NAME = `${TEST_SCYLLA_CONFIG.tableName}_view_base`;
const VIEW_NAME = "test-view";

let currentTenant = "tenant-a";

/**
 * Build the view connector options over a base table.
 * @param tableName The base table name.
 * @param viewName The view name.
 * @param partitionContextIds The optional partition context ids.
 * @returns The options.
 */
function createViewOptions(
	tableName: string,
	viewName: string,
	partitionContextIds?: string[]
): IScyllaDBViewConnectorConstructorOptions {
	return {
		entitySchema: nameof<BaseType>(),
		viewSchema: nameof<ViewByStatus>(),
		partitionContextIds,
		config: { ...TEST_SCYLLA_CONFIG, tableName, viewName }
	};
}

/**
 * Read the column kinds of a view from the schema tables.
 * @param viewName The sanitized view name.
 * @returns The column name mapped to its kind and position.
 */
async function readViewColumns(viewName: string): Promise<{ [column: string]: string }> {
	const client = new Client({
		contactPoints: TEST_SCYLLA_CONFIG.hosts,
		localDataCenter: TEST_SCYLLA_CONFIG.localDataCenter,
		protocolOptions: { port: TEST_SCYLLA_CONFIG.port }
	});
	try {
		const result = await client.execute(
			"SELECT column_name, kind, position FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?",
			[TEST_SCYLLA_CONFIG.keyspace, viewName],
			{ prepare: true }
		);
		const columns: { [column: string]: string } = {};
		for (const row of result.rows) {
			columns[row.get("column_name")] = `${row.get("kind")}:${row.get("position")}`;
		}
		return columns;
	} finally {
		await client.shutdown();
	}
}

beforeAll(() => {
	EntitySchemaFactory.register(nameof<BaseType>(), () => EntitySchemaHelper.getSchema(BaseType));
	EntitySchemaFactory.register(nameof<ViewByStatus>(), () =>
		EntitySchemaHelper.getSchema(ViewByStatus)
	);
});

describe("ScyllaDBViewConnector - constructor", () => {
	test("can fail to construct when there are no options", () => {
		expect(
			() =>
				new ScyllaDBViewConnector(undefined as unknown as IScyllaDBViewConnectorConstructorOptions)
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.objectUndefined",
				properties: { property: "options", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no view schema", () => {
		expect(
			() => new ScyllaDBViewConnector({} as unknown as IScyllaDBViewConnectorConstructorOptions)
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.viewSchema", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no entity schema", () => {
		expect(
			() =>
				new ScyllaDBViewConnector({
					viewSchema: nameof<ViewByStatus>(),
					config: { ...TEST_SCYLLA_CONFIG, viewName: VIEW_NAME }
				} as unknown as IScyllaDBViewConnectorConstructorOptions)
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.entitySchema", value: "undefined" }
			})
		);
	});

	test("can fail to construct when there is no view name", () => {
		expect(
			() =>
				new ScyllaDBViewConnector({
					entitySchema: nameof<BaseType>(),
					viewSchema: nameof<ViewByStatus>(),
					config: { ...TEST_SCYLLA_CONFIG }
				} as unknown as IScyllaDBViewConnectorConstructorOptions)
		).toThrow(
			expect.objectContaining({
				name: "GuardError",
				message: "guard.string",
				properties: { property: "options.config.viewName", value: "undefined" }
			})
		);
	});

	test("can construct with the documented options", () => {
		const connector = new ScyllaDBViewConnector<ViewByStatus>(
			createViewOptions(BASE_TABLE_NAME, VIEW_NAME)
		);
		expect(connector.getSchema()).toEqual(EntitySchemaHelper.getSchema(ViewByStatus));
	});
});

describe("ScyllaDBViewConnector - materialized view", () => {
	let baseConnector: ScyllaDBTableConnector<BaseType>;
	let viewConnector: ScyllaDBViewConnector<ViewByStatus>;

	beforeAll(async () => {
		ContextIdStore.getContextIds = vi
			.fn()
			.mockImplementation(() => ({ node: "node", tenant: currentTenant }));

		baseConnector = new ScyllaDBTableConnector<BaseType>({
			entitySchema: nameof<BaseType>(),
			config: { ...TEST_SCYLLA_CONFIG, tableName: BASE_TABLE_NAME }
		});
		expect(await baseConnector.bootstrap()).toBe(true);

		viewConnector = new ScyllaDBViewConnector<ViewByStatus>(
			createViewOptions(BASE_TABLE_NAME, VIEW_NAME)
		);
	});

	afterAll(async () => {
		await viewConnector.teardown();
		await baseConnector.teardown();
	});

	test("can bootstrap a view keyed by the view primary property followed by the base table key", async () => {
		expect(await viewConnector.bootstrap()).toBe(true);

		expect(await readViewColumns("testview")).toEqual({
			partitionId: "partition_key:0",
			status: "clustering:0",
			id: "clustering:1",
			category: "clustering:2",
			description: "regular:-1"
		});
	});

	test("can read base table rows through the view projected to the view schema", async () => {
		await baseConnector.set({ id: "1", category: "a", status: "active", description: "one" });
		await baseConnector.set({ id: "2", category: "b", status: "active", description: "two" });
		await baseConnector.set({ id: "3", category: "c", status: "inactive", description: "three" });
		await baseConnector.set({ id: "4", category: "d", description: "no status" });

		const active = await viewConnector.query({
			property: "status",
			comparison: ComparisonOperator.Equals,
			value: "active"
		});
		expect(active.entities).toEqual([
			{ status: "active", id: "1", category: "a" },
			{ status: "active", id: "2", category: "b" }
		]);

		expect(await viewConnector.get("inactive")).toEqual({
			status: "inactive",
			id: "3",
			category: "c"
		});

		expect(await viewConnector.count()).toEqual(3);
	});

	test("can scope view reads to the partition of the caller", async () => {
		const partitionedBase = new ScyllaDBTableConnector<BaseType>({
			entitySchema: nameof<BaseType>(),
			partitionContextIds: ["tenant"],
			config: { ...TEST_SCYLLA_CONFIG, tableName: `${BASE_TABLE_NAME}_partitioned` }
		});
		const partitionedView = new ScyllaDBViewConnector<ViewByStatus>(
			createViewOptions(`${BASE_TABLE_NAME}_partitioned`, `${VIEW_NAME}_partitioned`, ["tenant"])
		);

		try {
			expect(await partitionedBase.bootstrap()).toBe(true);
			expect(await partitionedView.bootstrap()).toBe(true);

			await partitionedBase.set({ id: "1", category: "a", status: "active", description: "one" });
			expect((await partitionedView.query()).entities).toEqual([
				{ status: "active", id: "1", category: "a" }
			]);

			currentTenant = "tenant-b";
			expect((await partitionedView.query()).entities).toEqual([]);
		} finally {
			currentTenant = "tenant-a";
			await partitionedView.teardown();
			await partitionedBase.teardown();
		}
	});

	test("can fail write operations as not supported", async () => {
		const viewEntity: ViewByStatus = { status: "active", id: "9", category: "z" };
		const operations: { methodName: string; run: () => Promise<void> }[] = [
			{ methodName: "set", run: async () => viewConnector.set(viewEntity) },
			{ methodName: "setBatch", run: async () => viewConnector.setBatch([viewEntity]) },
			{ methodName: "remove", run: async () => viewConnector.remove("9") },
			{ methodName: "removeBatch", run: async () => viewConnector.removeBatch(["9"]) },
			{ methodName: "empty", run: async () => viewConnector.empty() }
		];

		for (const operation of operations) {
			await expect(operation.run()).rejects.toMatchObject({
				name: "NotSupportedError",
				message: "scyllaDBViewConnector.notSupported",
				properties: { methodName: operation.methodName }
			});
		}
	});

	test("can teardown the view so that the base table can be dropped", async () => {
		expect(await baseConnector.teardown()).toBe(false);
		expect(await viewConnector.teardown()).toBe(true);
		expect(await baseConnector.teardown()).toBe(true);
	});
});
