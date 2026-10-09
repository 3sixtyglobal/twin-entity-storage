// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@3sixty/context";
import { RandomHelper, StringHelper } from "@3sixty/core";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	LogicalOperator,
	SortDirection,
	entity,
	property
} from "@3sixty/entity";
import type {
	IEntityStorageConnector,
	IEntityStorageJoinOptions
} from "@3sixty/entity-storage-models";
import { nameof } from "@3sixty/nameof";
import type { Pool } from "mysql2/promise";
import { TEST_MYSQL_CONFIG } from "./setupTestEnv.js";
import { MySqlEntityStorageConnector } from "../src/mysqlEntityStorageConnector.js";

// These tests are duplicated across every connector which implements queryJoin. If you modify
// anything here make sure to apply the same change to all the other connectors to keep them in
// sync. Only three things should differ between the files: the constants immediately below, the
// createConnector factory, and the connector specific tests at the end of the file.

// Does the connector support optional secondary index fields being null or undefined.
const SUPPORT_NULLABLE_SECONDARY_INDEX = true;
// Does the connector support sorting by properties other than the primary key.
const SUPPORT_SECONDARY_INDEX_SORT = true;
// Does the connector support sorting by a nullable property.
const SUPPORT_NULLABLE_SORT_PROPERTY = true;
// Does the connector support a condition which narrows on the group property and another property
// at the same time, which is what a group condition asks of it.
const SUPPORT_GROUP_CONDITIONS = true;

@entity()
class OrderType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", isSecondary: SUPPORT_NULLABLE_SECONDARY_INDEX, optional: true })
	public customerId?: string;

	@property({ type: "string", isSecondary: SUPPORT_NULLABLE_SECONDARY_INDEX, optional: true })
	public region?: string;

	@property({ type: "number", format: "uint32", optional: true })
	public total?: number;

	@property({ type: "boolean", optional: true })
	public express?: boolean;
}

@entity()
class ShipmentType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string", isSecondary: true })
	public orderId!: string;

	@property({ type: "string", isSecondary: SUPPORT_NULLABLE_SECONDARY_INDEX, optional: true })
	public carrier?: string;

	@property({
		type: "number",
		format: "uint32",
		sortDirection: SortDirection.Ascending,
		optional: true
	})
	public position?: number;

	@property({ type: "string", optional: true })
	public note?: string;
}

type JoinOptions = IEntityStorageJoinOptions<OrderType, ShipmentType>;

let currentUser = "user";
const openConnectors: IEntityStorageConnector[] = [];

/**
 * Create a fresh bootstrapped connector against a uniquely named table.
 * @param entitySchema The name of the entity schema to use.
 * @param partitionContextIds The optional context ids to partition the table by.
 * @returns The connector.
 */
async function createConnector<T>(
	entitySchema: string,
	partitionContextIds?: string[]
): Promise<MySqlEntityStorageConnector<T>> {
	const connector = new MySqlEntityStorageConnector<T>({
		entitySchema,
		partitionContextIds,
		config: {
			...TEST_MYSQL_CONFIG,
			tableName: `${TEST_MYSQL_CONFIG.tableName}_${RandomHelper.generateUuidV7("compact")}`
		}
	});
	await connector.bootstrap();
	openConnectors.push(connector);
	return connector;
}

/**
 * Create the order and shipment connectors together.
 * @param partitionContextIds The optional context ids to partition both tables by.
 * @returns Both connectors.
 */
async function createPair(partitionContextIds?: string[]): Promise<{
	orders: MySqlEntityStorageConnector<OrderType>;
	shipments: MySqlEntityStorageConnector<ShipmentType>;
}> {
	const orders = await createConnector<OrderType>(nameof<OrderType>(), partitionContextIds);
	const shipments = await createConnector<ShipmentType>(
		nameof<ShipmentType>(),
		partitionContextIds
	);
	return { orders, shipments };
}

/**
 * Get the pool a connector runs its statements on so the calls can be counted.
 * @param connector The connector to read the pool from.
 * @returns The pool.
 */
async function poolOf(connector: MySqlEntityStorageConnector): Promise<Pool> {
	return (connector as unknown as { getPool(): Promise<Pool> }).getPool();
}

describe("MySqlEntityStorageConnector queryJoin", () => {
	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<OrderType>(), () =>
			EntitySchemaHelper.getSchema(OrderType)
		);
		EntitySchemaFactory.register(nameof<ShipmentType>(), () =>
			EntitySchemaHelper.getSchema(ShipmentType)
		);

		ContextIdStore.getContextIds = vi
			.fn()
			.mockImplementation(() => ({ node: "node", tenant: "tenant", user: currentUser }));
	});

	afterEach(async () => {
		currentUser = "user";
		for (const connector of openConnectors) {
			try {
				await connector.teardown?.();
			} catch {}
			try {
				await connector.stop?.();
			} catch {}
		}
		openConnectors.length = 0;
	});

	test("can fail to join with no join connector", async () => {
		const orders = await createConnector<OrderType>(nameof<OrderType>());
		await expect(
			orders.queryJoin(undefined as unknown as IEntityStorageConnector<ShipmentType>, {
				property: "id",
				joinProperty: "orderId"
			})
		).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.objectUndefined",
			properties: { property: "joinConnector" }
		});
	});

	test("can fail to join with no join options", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, undefined as unknown as JoinOptions)
		).rejects.toMatchObject({
			name: "GuardError",
			message: "guard.objectUndefined",
			properties: { property: "joinOptions" }
		});
	});

	test("can fail to join with no property", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, {
				property: undefined as unknown as keyof OrderType,
				joinProperty: "orderId"
			})
		).rejects.toMatchObject({
			name: "GuardError",
			properties: { property: "joinOptions.property" }
		});
	});

	test("can fail to join with no join property", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, {
				property: "id",
				joinProperty: undefined as unknown as keyof ShipmentType
			})
		).rejects.toMatchObject({
			name: "GuardError",
			properties: { property: "joinOptions.joinProperty" }
		});
	});

	test("can fail to join on a property missing from the primary schema", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, {
				property: "nonExistent" as keyof OrderType,
				joinProperty: "orderId"
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.propertyNotInSchema"
		});
	});

	test("can fail to join on a property missing from the joined schema", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "nonExistent" as keyof ShipmentType
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.propertyNotInSchema"
		});
	});

	test("can fail to join with an unknown primary projection property", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				properties: ["nonExistent" as keyof OrderType]
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.propertyNotInSchema"
		});
	});

	test("can fail to join with an unknown joined projection property", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				joinProperties: ["nonExistent" as keyof ShipmentType]
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.propertyNotInSchema"
		});
	});

	test("can fail to join with an unknown property in the primary conditions", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				conditions: {
					property: "nonExistent",
					comparison: ComparisonOperator.Equals,
					value: "x"
				}
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditionProperty"
		});
	});

	test("can fail to join with an unknown property in the joined conditions", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				joinConditions: {
					property: "nonExistent",
					comparison: ComparisonOperator.Equals,
					value: "x"
				}
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditionProperty"
		});
	});

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can fail to join when the primary sort property is not indexed",
		async () => {
			const { orders, shipments } = await createPair();
			await expect(
				orders.queryJoin(shipments, {
					property: "id",
					joinProperty: "orderId",
					sortProperties: [{ property: "total", sortDirection: SortDirection.Ascending }]
				})
			).rejects.toMatchObject({
				name: "GeneralError",
				message: "entityStorageHelper.sortNotIndexed"
			});
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can fail to join when the joined sort property is not indexed",
		async () => {
			const { orders, shipments } = await createPair();
			await expect(
				orders.queryJoin(shipments, {
					property: "id",
					joinProperty: "orderId",
					joinSortProperties: [{ property: "note", sortDirection: SortDirection.Ascending }]
				})
			).rejects.toMatchObject({
				name: "GeneralError",
				message: "entityStorageHelper.sortNotIndexed"
			});
		}
	);

	test("can fail to join with an invalid limit", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, { property: "id", joinProperty: "orderId", limit: 0 })
		).rejects.toMatchObject({
			name: "ValidationError",
			message: "common.validation"
		});
	});

	test("can fail to join with a malformed cursor", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				cursor: "not-a-cursor"
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.cursorInvalid"
		});
	});

	test("can fail to join with a cursor from a different query", async () => {
		const { orders, shipments } = await createPair();
		for (let i = 1; i <= 5; i++) {
			await orders.set({ id: `o${i}`, region: "eu" });
		}

		const first = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			limit: 2
		});
		expect(first.cursor).toBeDefined();

		// The same cursor against a query which pages differently must be rejected rather than
		// silently restarting the page somewhere else.
		await expect(
			orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				groupProperty: "region",
				cursor: first.cursor,
				limit: 2
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.cursorInvalid"
		});
	});

	test("can fail to join with a cursor from a query with different conditions", async () => {
		const { orders, shipments } = await createPair();
		for (let i = 1; i <= 5; i++) {
			await orders.set({ id: `o${i}`, region: "eu" });
		}

		const first = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			limit: 2
		});

		await expect(
			orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				conditions: { property: "region", comparison: ComparisonOperator.Equals, value: "eu" },
				cursor: first.cursor,
				limit: 2
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.cursorInvalid"
		});
	});

	test("can fail to join with a group property missing from the primary schema", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				groupProperty: "nonExistent" as keyof OrderType
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.propertyNotInSchema"
		});
	});

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can join and apply the limit to the primary entities not the joined entities",
		async () => {
			const { orders, shipments } = await createPair();
			for (let i = 1; i <= 4; i++) {
				await orders.set({ id: `o${i}` });
				for (let j = 1; j <= 3; j++) {
					await shipments.set({ id: `s${i}${j}`, orderId: `o${i}`, position: j });
				}
			}

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }],
				joinSortProperties: [{ property: "position", sortDirection: SortDirection.Ascending }],
				limit: 2
			});

			expect(result.entities.map(e => e.id)).toEqual(["o1", "o2"]);
			expect(result.entities[0].joined.map(j => j.id)).toEqual(["s11", "s12", "s13"]);
			expect(result.entities[1].joined.map(j => j.id)).toEqual(["s21", "s22", "s23"]);
			expect(result.cursor).toBeDefined();
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can join and group applying the limit to the groups not the joined entities",
		async () => {
			const { orders, shipments } = await createPair();
			const regions = ["ap", "eu", "us"];
			for (let i = 0; i < regions.length; i++) {
				await orders.set({ id: `o${i}`, region: regions[i] });
				for (let j = 1; j <= 3; j++) {
					await shipments.set({ id: `s${i}${j}`, orderId: `o${i}`, position: j });
				}
			}

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				groupProperty: "region",
				sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }],
				joinSortProperties: [{ property: "position", sortDirection: SortDirection.Ascending }],
				limit: 2
			});

			expect(result.entities.map(e => e.region)).toEqual(["ap", "eu"]);
			expect(result.entities[0].joined.length).toEqual(3);
			expect(result.entities[1].joined.length).toEqual(3);
			expect(result.cursor).toBeDefined();
		}
	);

	test("can fail to join with group conditions and no group property", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				groupConditions: [
					{ property: "region", comparison: ComparisonOperator.Equals, value: "eu" }
				]
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.groupConditionsWithoutGroup"
		});
	});

	test("can fail to join with an unknown property in the group conditions", async () => {
		const { orders, shipments } = await createPair();
		await expect(
			orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				groupProperty: "region",
				groupConditions: [
					{ property: "nonExistent", comparison: ComparisonOperator.Equals, value: "x" }
				]
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditionProperty"
		});
	});

	test("can join requiring a joined entity to drop unmatched primary entities", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1" });
		await orders.set({ id: "o2" });
		await orders.set({ id: "o3" });
		await shipments.set({ id: "s1", orderId: "o1" });
		await shipments.set({ id: "s3", orderId: "o3" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			joinRequired: true,
			sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }]
		});

		expect(result.entities.map(e => e.id)).toEqual(["o1", "o3"]);
		expect(result.entities.every(e => e.joined.length > 0)).toEqual(true);
	});

	test("can join requiring a joined entity so the join conditions narrow the page", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1" });
		await orders.set({ id: "o2" });
		await shipments.set({ id: "s1", orderId: "o1", carrier: "dhl" });
		await shipments.set({ id: "s2", orderId: "o2", carrier: "ups" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			joinConditions: { property: "carrier", comparison: ComparisonOperator.Equals, value: "dhl" },
			joinRequired: true
		});

		// Without joinRequired o2 would come back with an empty joined list and take a page slot.
		expect(result.entities.map(e => e.id)).toEqual(["o1"]);
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
	});

	test("can join requiring a joined entity so the limit counts only matched entities", async () => {
		const { orders, shipments } = await createPair();
		for (let i = 1; i <= 6; i++) {
			await orders.set({ id: `o${i}` });
		}
		// Only the even ids have a shipment.
		await shipments.set({ id: "s2", orderId: "o2" });
		await shipments.set({ id: "s4", orderId: "o4" });
		await shipments.set({ id: "s6", orderId: "o6" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			joinRequired: true,
			sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }],
			limit: 2
		});

		expect(result.entities.map(e => e.id)).toEqual(["o2", "o4"]);
		expect(result.cursor).toBeDefined();

		const second = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			joinRequired: true,
			sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }],
			limit: 2,
			cursor: result.cursor
		});
		expect(second.entities.map(e => e.id)).toEqual(["o6"]);
		expect(second.cursor).toBeUndefined();
	});

	test("can join and group requiring a joined entity", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu" });
		await orders.set({ id: "o2", region: "us" });
		await shipments.set({ id: "s1", orderId: "o1" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "region",
			joinRequired: true
		});

		expect(result.entities.map(e => e.region)).toEqual(["eu"]);
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
	});

	test.skipIf(!SUPPORT_GROUP_CONDITIONS)(
		"can join and group keeping only groups which hold an entity matching each condition",
		async () => {
			const { orders, shipments } = await createPair();
			// The eu group holds one entity for each condition, the us group only holds one of them.
			await orders.set({ id: "o1", region: "eu", customerId: "c1" });
			await orders.set({ id: "o2", region: "eu", customerId: "c2" });
			await orders.set({ id: "o3", region: "us", customerId: "c1" });
			await shipments.set({ id: "s1", orderId: "o1" });
			await shipments.set({ id: "s2", orderId: "o2" });
			await shipments.set({ id: "s3", orderId: "o3" });

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				groupProperty: "region",
				groupConditions: [
					{ property: "customerId", comparison: ComparisonOperator.Equals, value: "c1" },
					{ property: "customerId", comparison: ComparisonOperator.Equals, value: "c2" }
				]
			});

			expect(result.entities.map(e => e.region)).toEqual(["eu"]);
			// The group still carries the joined entities of every entity it holds.
			expect(result.entities[0].joined.map(j => j.id).sort()).toEqual(["s1", "s2"]);
		}
	);

	test.skipIf(!SUPPORT_GROUP_CONDITIONS)(
		"can join and group with a single group condition",
		async () => {
			const { orders, shipments } = await createPair();
			await orders.set({ id: "o1", region: "eu", customerId: "c1" });
			await orders.set({ id: "o2", region: "us", customerId: "c2" });
			await shipments.set({ id: "s1", orderId: "o1" });
			await shipments.set({ id: "s2", orderId: "o2" });

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				groupProperty: "region",
				groupConditions: [
					{ property: "customerId", comparison: ComparisonOperator.Equals, value: "c2" }
				]
			});

			expect(result.entities.map(e => e.region)).toEqual(["us"]);
		}
	);

	test.skipIf(!SUPPORT_GROUP_CONDITIONS)(
		"can join and group with a group condition on a property the caller did not ask for",
		async () => {
			const { orders, shipments } = await createPair();
			await orders.set({ id: "o1", region: "eu", customerId: "c1" });
			await orders.set({ id: "o2", region: "us", customerId: "c2" });
			await shipments.set({ id: "s1", orderId: "o1" });
			await shipments.set({ id: "s2", orderId: "o2" });

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				groupProperty: "region",
				properties: ["region"],
				groupConditions: [
					{ property: "customerId", comparison: ComparisonOperator.Equals, value: "c2" }
				]
			});

			expect(result.entities.map(e => e.region)).toEqual(["us"]);
			// The property the condition tested is read to check it and dropped again afterwards.
			expect(result.entities[0].customerId).toBeUndefined();
		}
	);

	test("can join and group returning each joined entity once however many entities reach it", async () => {
		const { orders, shipments } = await createPair();
		// Every order in the group points at the same joined entity.
		await orders.set({ id: "o1", region: "eu", customerId: "shared" });
		await orders.set({ id: "o2", region: "eu", customerId: "shared" });
		await orders.set({ id: "o3", region: "eu", customerId: "shared" });
		await shipments.set({ id: "s1", orderId: "shared" });

		const result = await orders.queryJoin(shipments, {
			property: "customerId",
			joinProperty: "orderId",
			groupProperty: "region"
		});

		expect(result.entities.length).toEqual(1);
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
	});

	test("can join when there are no entities", async () => {
		const { orders, shipments } = await createPair();
		const result = await orders.queryJoin(shipments, { property: "id", joinProperty: "orderId" });
		expect(result.entities).toEqual([]);
		expect(result.cursor).toBeUndefined();
	});

	test("can join the primary key to a secondary property", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", customerId: "c1", region: "eu", total: 10 });
		await orders.set({ id: "o2", customerId: "c2", region: "us", total: 20 });
		await shipments.set({ id: "s1", orderId: "o1", carrier: "dhl", position: 1 });
		await shipments.set({ id: "s2", orderId: "o1", carrier: "ups", position: 2 });
		await shipments.set({ id: "s3", orderId: "o2", carrier: "dhl", position: 1 });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }]
		});

		expect(result.entities.length).toEqual(2);
		expect(result.entities[0].id).toEqual("o1");
		expect(result.entities[0].joined.map(j => j.id).sort()).toEqual(["s1", "s2"]);
		expect(result.entities[1].id).toEqual("o2");
		expect(result.entities[1].joined.map(j => j.id)).toEqual(["s3"]);
	});

	test("can join and return an empty list for a primary entity with no matches", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", customerId: "c1" });
		await orders.set({ id: "o2", customerId: "c2" });
		await shipments.set({ id: "s1", orderId: "o1" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }]
		});

		expect(result.entities.length).toEqual(2);
		expect(result.entities[0].joined.length).toEqual(1);
		expect(result.entities[1].joined).toEqual([]);
	});

	test("can join on a non primary-key property of the primary entity", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", customerId: "c1" });
		await orders.set({ id: "o2", customerId: "c1" });
		await orders.set({ id: "o3", customerId: "c2" });
		await shipments.set({ id: "s1", orderId: "c1", carrier: "dhl" });
		await shipments.set({ id: "s2", orderId: "c2", carrier: "ups" });

		const result = await orders.queryJoin(shipments, {
			property: "customerId",
			joinProperty: "orderId",
			sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }]
		});

		expect(result.entities.length).toEqual(3);
		// Both o1 and o2 share customerId c1 so both receive the same joined entity.
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
		expect(result.entities[1].joined.map(j => j.id)).toEqual(["s1"]);
		expect(result.entities[2].joined.map(j => j.id)).toEqual(["s2"]);
	});

	test("can join and return an empty list when the join value is not set", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", customerId: "c1" });
		await orders.set({ id: "o2" });
		await shipments.set({ id: "s1", orderId: "c1" });

		const result = await orders.queryJoin(shipments, {
			property: "customerId",
			joinProperty: "orderId",
			sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }]
		});

		expect(result.entities.length).toEqual(2);
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
		expect(result.entities[1].joined).toEqual([]);
	});

	test("can join with conditions on the primary entities", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu" });
		await orders.set({ id: "o2", region: "us" });
		await shipments.set({ id: "s1", orderId: "o1" });
		await shipments.set({ id: "s2", orderId: "o2" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			conditions: { property: "region", comparison: ComparisonOperator.Equals, value: "eu" }
		});

		expect(result.entities.length).toEqual(1);
		expect(result.entities[0].id).toEqual("o1");
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
	});

	test("can join with conditions on the joined entities without removing primary entities", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1" });
		await orders.set({ id: "o2" });
		await shipments.set({ id: "s1", orderId: "o1", carrier: "dhl" });
		await shipments.set({ id: "s2", orderId: "o1", carrier: "ups" });
		await shipments.set({ id: "s3", orderId: "o2", carrier: "ups" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			joinConditions: { property: "carrier", comparison: ComparisonOperator.Equals, value: "dhl" },
			sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }]
		});

		expect(result.entities.length).toEqual(2);
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
		expect(result.entities[1].joined).toEqual([]);
	});

	test("can join with conditions on both sides", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu" });
		await orders.set({ id: "o2", region: "eu" });
		await orders.set({ id: "o3", region: "us" });
		await shipments.set({ id: "s1", orderId: "o1", carrier: "dhl" });
		await shipments.set({ id: "s2", orderId: "o2", carrier: "ups" });
		await shipments.set({ id: "s3", orderId: "o3", carrier: "dhl" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			joinConditions: { property: "carrier", comparison: ComparisonOperator.Equals, value: "dhl" },
			conditions: {
				conditions: [{ property: "region", comparison: ComparisonOperator.Equals, value: "eu" }],
				logicalOperator: LogicalOperator.And
			},
			sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }]
		});

		expect(result.entities.map(e => e.id)).toEqual(["o1", "o2"]);
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
		expect(result.entities[1].joined).toEqual([]);
	});

	test("can join with the primary entities sorted descending", async () => {
		const { orders, shipments } = await createPair();
		for (let i = 1; i <= 3; i++) {
			await orders.set({ id: `o${i}` });
			await shipments.set({ id: `s${i}`, orderId: `o${i}` });
		}

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			sortProperties: [{ property: "id", sortDirection: SortDirection.Descending }]
		});

		expect(result.entities.map(e => e.id)).toEqual(["o3", "o2", "o1"]);
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s3"]);
	});

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can join with the joined entities sorted ascending",
		async () => {
			const { orders, shipments } = await createPair();
			await orders.set({ id: "o1" });
			await shipments.set({ id: "s1", orderId: "o1", position: 3 });
			await shipments.set({ id: "s2", orderId: "o1", position: 1 });
			await shipments.set({ id: "s3", orderId: "o1", position: 2 });

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				joinSortProperties: [{ property: "position", sortDirection: SortDirection.Ascending }]
			});

			expect(result.entities[0].joined.map(j => j.id)).toEqual(["s2", "s3", "s1"]);
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can join with the joined entities sorted descending",
		async () => {
			const { orders, shipments } = await createPair();
			await orders.set({ id: "o1" });
			await shipments.set({ id: "s1", orderId: "o1", position: 3 });
			await shipments.set({ id: "s2", orderId: "o1", position: 1 });
			await shipments.set({ id: "s3", orderId: "o1", position: 2 });

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				joinSortProperties: [{ property: "position", sortDirection: SortDirection.Descending }]
			});

			expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1", "s3", "s2"]);
		}
	);

	test("can join with a projection on the primary entities", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", customerId: "c1", region: "eu", total: 10 });
		await shipments.set({ id: "s1", orderId: "o1" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			properties: ["region"]
		});

		expect(result.entities.length).toEqual(1);
		expect(result.entities[0]).toEqual({ region: "eu", joined: [expect.objectContaining({})] });
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
	});

	test("can join with a projection which already contains the join property", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", customerId: "c1", region: "eu", total: 10 });
		await shipments.set({ id: "s1", orderId: "o1" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			properties: ["id", "region"]
		});

		expect(result.entities[0].id).toEqual("o1");
		expect(result.entities[0].region).toEqual("eu");
		expect(result.entities[0].customerId).toBeUndefined();
		expect(result.entities[0].total).toBeUndefined();
	});

	test("can join with a projection on the joined entities", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1" });
		await shipments.set({ id: "s1", orderId: "o1", carrier: "dhl", note: "fragile" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			joinProperties: ["carrier"]
		});

		expect(result.entities[0].joined).toEqual([{ carrier: "dhl" }]);
	});

	test("can join with a projection on the joined entities which contains the join property", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1" });
		await shipments.set({ id: "s1", orderId: "o1", carrier: "dhl", note: "fragile" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			joinProperties: ["orderId", "carrier"]
		});

		expect(result.entities[0].joined).toEqual([{ orderId: "o1", carrier: "dhl" }]);
	});

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can join with a joined projection which excludes the joined sort property",
		async () => {
			const { orders, shipments } = await createPair();
			await orders.set({ id: "o1" });
			await shipments.set({ id: "s1", orderId: "o1", carrier: "c", position: 3 });
			await shipments.set({ id: "s2", orderId: "o1", carrier: "b", position: 1 });
			await shipments.set({ id: "s3", orderId: "o1", carrier: "a", position: 2 });

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				joinProperties: ["carrier"],
				joinSortProperties: [{ property: "position", sortDirection: SortDirection.Ascending }]
			});

			expect(result.entities[0].joined).toEqual([
				{ carrier: "b" },
				{ carrier: "a" },
				{ carrier: "c" }
			]);
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT || !SUPPORT_NULLABLE_SORT_PROPERTY)(
		"can join and page over a nullable sort property with no skips or duplicates",
		async () => {
			const { orders, shipments } = await createPair();
			for (let i = 1; i <= 6; i++) {
				// Half the orders leave the sort property unset.
				await orders.set({ id: `o${i}`, region: i % 2 === 0 ? undefined : `r${i}` });
				await shipments.set({ id: `s${i}`, orderId: `o${i}` });
			}

			for (const sortDirection of [SortDirection.Ascending, SortDirection.Descending]) {
				const pageOptions: JoinOptions = {
					property: "id",
					joinProperty: "orderId",
					sortProperties: [{ property: "region", sortDirection }],
					limit: 2
				};

				const seen = new Set<string>();
				let cursor: string | undefined;
				let pages = 0;
				do {
					const page = await orders.queryJoin(shipments, { ...pageOptions, cursor });
					for (const e of page.entities) {
						expect(seen.has(e.id as string), `duplicate id ${e.id}`).toBe(false);
						seen.add(e.id as string);
					}
					cursor = page.cursor;
					expect(++pages).toBeLessThan(100);
				} while (cursor !== undefined);

				for (let i = 1; i <= 6; i++) {
					expect(seen.has(`o${i}`), `id o${i} missing from cursor walk`).toBe(true);
				}
			}
		}
	);

	test("can join and page through the primary entities with a cursor", async () => {
		const { orders, shipments } = await createPair();
		for (let i = 1; i <= 5; i++) {
			await orders.set({ id: `o${i}` });
			await shipments.set({ id: `s${i}`, orderId: `o${i}` });
		}

		const pageOptions: JoinOptions = {
			property: "id",
			joinProperty: "orderId",
			sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }],
			limit: 2
		};

		const first = await orders.queryJoin(shipments, pageOptions);
		expect(first.entities.map(e => e.id)).toEqual(["o1", "o2"]);
		expect(first.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
		expect(first.cursor).toBeDefined();

		const second = await orders.queryJoin(shipments, { ...pageOptions, cursor: first.cursor });
		expect(second.entities.map(e => e.id)).toEqual(["o3", "o4"]);
		expect(second.entities[1].joined.map(j => j.id)).toEqual(["s4"]);

		const third = await orders.queryJoin(shipments, { ...pageOptions, cursor: second.cursor });
		expect(third.entities.map(e => e.id)).toEqual(["o5"]);
		expect(third.cursor).toBeUndefined();
	});

	test("can join and group the primary entities merging their joined entities", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu" });
		await orders.set({ id: "o2", region: "eu" });
		await orders.set({ id: "o3", region: "us" });
		await shipments.set({ id: "s1", orderId: "o1" });
		await shipments.set({ id: "s2", orderId: "o1" });
		await shipments.set({ id: "s3", orderId: "o2" });
		await shipments.set({ id: "s4", orderId: "o3" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "region"
		});

		expect(result.entities.length).toEqual(2);
		expect(result.entities[0].region).toEqual("eu");
		expect(result.entities[0].joined.map(j => j.id).sort()).toEqual(["s1", "s2", "s3"]);
		expect(result.entities[1].region).toEqual("us");
		expect(result.entities[1].joined.map(j => j.id)).toEqual(["s4"]);
	});

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can join and group taking the values of the first entity in the sort order",
		async () => {
			const { orders, shipments } = await createPair();
			await orders.set({ id: "o1", region: "eu", customerId: "c2", total: 10 });
			await orders.set({ id: "o2", region: "eu", customerId: "c1", total: 20 });
			await shipments.set({ id: "s1", orderId: "o1" });
			await shipments.set({ id: "s2", orderId: "o2" });

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				groupProperty: "region",
				sortProperties: [{ property: "customerId", sortDirection: SortDirection.Ascending }]
			});

			// o2 sorts first within the group, so the group carries its values, and the joined lists
			// of every entity in the group are still merged.
			expect(result.entities.length).toEqual(1);
			expect(result.entities[0].id).toEqual("o2");
			expect(result.entities[0].customerId).toEqual("c1");
			expect(result.entities[0].total).toEqual(20);
			expect(result.entities[0].region).toEqual("eu");
			expect(result.entities[0].joined.map(j => j.id).sort()).toEqual(["s1", "s2"]);
		}
	);

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can join and group ordered by a property other than the group property",
		async () => {
			const { orders, shipments } = await createPair();
			await orders.set({ id: "o1", region: "eu", customerId: "c3" });
			await orders.set({ id: "o2", region: "us", customerId: "c1" });
			await orders.set({ id: "o3", region: "ap", customerId: "c2" });
			await shipments.set({ id: "s1", orderId: "o1" });
			await shipments.set({ id: "s2", orderId: "o2" });
			await shipments.set({ id: "s3", orderId: "o3" });

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				groupProperty: "region",
				sortProperties: [{ property: "customerId", sortDirection: SortDirection.Ascending }]
			});

			// The groups follow the order of the entities they took their values from, not the order
			// of the group values themselves.
			expect(result.entities.map(e => e.region)).toEqual(["us", "ap", "eu"]);
			expect(result.entities.map(e => e.joined.map(j => j.id))).toEqual([["s2"], ["s3"], ["s1"]]);
		}
	);

	test("can join and group with a projection of properties other than the group property", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu", customerId: "c1", total: 10 });
		await shipments.set({ id: "s1", orderId: "o1" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "region",
			properties: ["region", "customerId"]
		});

		expect(result.entities.length).toEqual(1);
		expect(result.entities[0]).toEqual({
			region: "eu",
			customerId: "c1",
			joined: [expect.objectContaining({})]
		});
	});

	test("can join and group where the group property is also the join property", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", customerId: "c1" });
		await orders.set({ id: "o2", customerId: "c1" });
		await orders.set({ id: "o3", customerId: "c2" });
		await shipments.set({ id: "s1", orderId: "c1" });
		await shipments.set({ id: "s2", orderId: "c1" });
		await shipments.set({ id: "s3", orderId: "c2" });

		const result = await orders.queryJoin(shipments, {
			property: "customerId",
			joinProperty: "orderId",
			groupProperty: "customerId"
		});

		expect(result.entities.length).toEqual(2);
		expect(result.entities[0].customerId).toEqual("c1");
		expect(result.entities[0].joined.map(j => j.id).sort()).toEqual(["s1", "s2"]);
		expect(result.entities[1].customerId).toEqual("c2");
		expect(result.entities[1].joined.map(j => j.id)).toEqual(["s3"]);
	});

	test("can join and group excluding primary entities with no group value", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu" });
		await orders.set({ id: "o2" });
		await shipments.set({ id: "s1", orderId: "o1" });
		await shipments.set({ id: "s2", orderId: "o2" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "region"
		});

		expect(result.entities.length).toEqual(1);
		expect(result.entities[0].region).toEqual("eu");
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
	});

	test("can join and group with an empty joined list when nothing matches", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu" });
		await orders.set({ id: "o2", region: "us" });
		await shipments.set({ id: "s1", orderId: "o1" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "region"
		});

		expect(result.entities.length).toEqual(2);
		expect(result.entities[1].region).toEqual("us");
		expect(result.entities[1].joined).toEqual([]);
	});

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can join and group sorted descending by the group property",
		async () => {
			const { orders, shipments } = await createPair();
			await orders.set({ id: "o1", region: "eu" });
			await orders.set({ id: "o2", region: "us" });
			await orders.set({ id: "o3", region: "ap" });
			await shipments.set({ id: "s1", orderId: "o1" });

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				groupProperty: "region",
				sortProperties: [{ property: "region", sortDirection: SortDirection.Descending }]
			});

			expect(result.entities.map(e => e.region)).toEqual(["us", "eu", "ap"]);
		}
	);

	test("can join and group with conditions on the primary entities", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu", customerId: "c1" });
		await orders.set({ id: "o2", region: "eu", customerId: "c2" });
		await orders.set({ id: "o3", region: "us", customerId: "c1" });
		await shipments.set({ id: "s1", orderId: "o1" });
		await shipments.set({ id: "s2", orderId: "o2" });
		await shipments.set({ id: "s3", orderId: "o3" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "region",
			conditions: { property: "customerId", comparison: ComparisonOperator.Equals, value: "c1" }
		});

		expect(result.entities.length).toEqual(2);
		expect(result.entities[0].region).toEqual("eu");
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
		expect(result.entities[1].region).toEqual("us");
		expect(result.entities[1].joined.map(j => j.id)).toEqual(["s3"]);
	});

	test("can join and group with conditions on the joined entities", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu" });
		await orders.set({ id: "o2", region: "eu" });
		await shipments.set({ id: "s1", orderId: "o1", carrier: "dhl" });
		await shipments.set({ id: "s2", orderId: "o2", carrier: "ups" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "region",
			joinConditions: { property: "carrier", comparison: ComparisonOperator.Equals, value: "dhl" }
		});

		expect(result.entities.length).toEqual(1);
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
	});

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can join and group with the joined entities sorted",
		async () => {
			const { orders, shipments } = await createPair();
			await orders.set({ id: "o1", region: "eu" });
			await orders.set({ id: "o2", region: "eu" });
			await shipments.set({ id: "s1", orderId: "o1", position: 4 });
			await shipments.set({ id: "s2", orderId: "o2", position: 1 });
			await shipments.set({ id: "s3", orderId: "o1", position: 3 });
			await shipments.set({ id: "s4", orderId: "o2", position: 2 });

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				groupProperty: "region",
				joinSortProperties: [{ property: "position", sortDirection: SortDirection.Ascending }]
			});

			expect(result.entities.length).toEqual(1);
			expect(result.entities[0].joined.map(j => j.id)).toEqual(["s2", "s4", "s3", "s1"]);
		}
	);

	test("can join and group with a projection on the joined entities", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu" });
		await shipments.set({ id: "s1", orderId: "o1", carrier: "dhl", note: "fragile" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "region",
			joinProperties: ["carrier"]
		});

		expect(result.entities[0].joined).toEqual([{ carrier: "dhl" }]);
	});

	test("can join and group with the group property in the projection", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu" });
		await shipments.set({ id: "s1", orderId: "o1" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "region",
			properties: ["region"]
		});

		expect(result.entities[0].region).toEqual("eu");
	});

	test("can join and group by a boolean property returning a boolean value", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", express: false });
		await orders.set({ id: "o2", express: true });
		await shipments.set({ id: "s1", orderId: "o1" });
		await shipments.set({ id: "s2", orderId: "o2" });

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "express"
		});

		// With no sort order the groups follow the primary key of the entity they stand on.
		expect(result.entities.length).toEqual(2);
		expect(result.entities[0].express).toEqual(false);
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
		expect(result.entities[1].express).toEqual(true);
		expect(result.entities[1].joined.map(j => j.id)).toEqual(["s2"]);
	});

	test("can join and page through the groups with a cursor", async () => {
		const { orders, shipments } = await createPair();
		const regions = ["ap", "eu", "me", "us"];
		for (let i = 0; i < regions.length; i++) {
			await orders.set({ id: `o${i}`, region: regions[i] });
			await shipments.set({ id: `s${i}`, orderId: `o${i}` });
		}

		const pageOptions: JoinOptions = {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "region",
			sortProperties: [{ property: "id", sortDirection: SortDirection.Ascending }],
			limit: 2
		};

		const first = await orders.queryJoin(shipments, pageOptions);
		expect(first.entities.map(e => e.region)).toEqual(["ap", "eu"]);
		expect(first.entities[0].joined.map(j => j.id)).toEqual(["s0"]);
		expect(first.cursor).toBeDefined();

		const second = await orders.queryJoin(shipments, { ...pageOptions, cursor: first.cursor });
		expect(second.entities.map(e => e.region)).toEqual(["me", "us"]);
		expect(second.entities[1].joined.map(j => j.id)).toEqual(["s3"]);
		expect(second.cursor).toBeUndefined();
	});

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can join and page through the groups descending with a cursor",
		async () => {
			const { orders, shipments } = await createPair();
			const regions = ["ap", "eu", "me", "us"];
			for (let i = 0; i < regions.length; i++) {
				await orders.set({ id: `o${i}`, region: regions[i] });
			}

			const pageOptions: JoinOptions = {
				property: "id",
				joinProperty: "orderId",
				groupProperty: "region",
				sortProperties: [{ property: "region", sortDirection: SortDirection.Descending }],
				limit: 2
			};

			const first = await orders.queryJoin(shipments, pageOptions);
			expect(first.entities.map(e => e.region)).toEqual(["us", "me"]);

			const second = await orders.queryJoin(shipments, { ...pageOptions, cursor: first.cursor });
			expect(second.entities.map(e => e.region)).toEqual(["eu", "ap"]);
		}
	);

	test("can join without leaking joined entities from another partition", async () => {
		const { orders, shipments } = await createPair(["user"]);
		await orders.set({ id: "o1" });
		await shipments.set({ id: "s1", orderId: "o1", carrier: "dhl" });

		currentUser = "other";
		await shipments.set({ id: "s2", orderId: "o1", carrier: "ups" });

		currentUser = "user";
		const result = await orders.queryJoin(shipments, { property: "id", joinProperty: "orderId" });

		expect(result.entities.length).toEqual(1);
		expect(result.entities[0].joined.map(j => j.id)).toEqual(["s1"]);
	});

	test("can join and group without leaking primary entities from another partition", async () => {
		const { orders, shipments } = await createPair(["user"]);
		await orders.set({ id: "o1", region: "eu" });
		await shipments.set({ id: "s1", orderId: "o1" });

		currentUser = "other";
		await orders.set({ id: "o2", region: "us" });

		currentUser = "user";
		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "region"
		});

		expect(result.entities.map(e => e.region)).toEqual(["eu"]);
	});

	test.skipIf(!SUPPORT_SECONDARY_INDEX_SORT)(
		"can join with more joined entities than the default query page size",
		async () => {
			const { orders, shipments } = await createPair();
			await orders.set({ id: "o1" });
			const shipmentEntities: ShipmentType[] = [];
			for (let i = 0; i < 120; i++) {
				shipmentEntities.push({
					id: `s${i.toString().padStart(3, "0")}`,
					orderId: "o1",
					position: i
				});
			}
			await shipments.setBatch(shipmentEntities);

			const result = await orders.queryJoin(shipments, {
				property: "id",
				joinProperty: "orderId",
				joinSortProperties: [{ property: "position", sortDirection: SortDirection.Ascending }]
			});

			expect(result.entities.length).toEqual(1);
			expect(result.entities[0].joined.length).toEqual(120);
			expect(result.entities[0].joined[0].id).toEqual("s000");
			expect(result.entities[0].joined[119].id).toEqual("s119");
		}
	);

	// ------------------------------------------------------------------------------------------
	// Connector specific tests. Everything above this point is shared with the other connectors.
	// ------------------------------------------------------------------------------------------

	test("can fail to join to a connector it cannot join to", async () => {
		const orders = await createConnector<OrderType>(nameof<OrderType>());
		const otherConnector = {
			className: () => "SomeOtherConnector",
			getSchema: () => EntitySchemaHelper.getSchema(ShipmentType),
			query: async () => ({ entities: [] })
		} as unknown as IEntityStorageConnector<ShipmentType>;

		await expect(
			orders.queryJoin(otherConnector, { property: "id", joinProperty: "orderId" })
		).rejects.toMatchObject({
			name: "GeneralError",
			message: `${StringHelper.camelCase(orders.className())}.joinConnectorMismatch`
		});
	});

	test("can fail to join to a connector using a different database", async () => {
		const orders = await createConnector<OrderType>(nameof<OrderType>());
		const otherDatabase = new MySqlEntityStorageConnector<ShipmentType>({
			entitySchema: nameof<ShipmentType>(),
			config: { ...TEST_MYSQL_CONFIG, database: `${TEST_MYSQL_CONFIG.database}_other` }
		});

		await expect(
			orders.queryJoin(otherDatabase, { property: "id", joinProperty: "orderId" })
		).rejects.toMatchObject({
			name: "GeneralError",
			message: `${StringHelper.camelCase(orders.className())}.joinConnectorMismatch`,
			properties: { database: TEST_MYSQL_CONFIG.database }
		});
	});

	test("can join using a single database statement", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu" });
		await orders.set({ id: "o2", region: "eu" });
		await shipments.set({ id: "s1", orderId: "o1" });
		await shipments.set({ id: "s2", orderId: "o2" });

		const pool = await poolOf(orders as MySqlEntityStorageConnector);
		const querySpy = vi.spyOn(pool, "query");

		const result = await orders.queryJoin(shipments, { property: "id", joinProperty: "orderId" });

		expect(querySpy).toHaveBeenCalledTimes(1);
		expect(result.entities.length).toEqual(2);
		querySpy.mockRestore();
	});

	test("can join and group using a single database statement", async () => {
		const { orders, shipments } = await createPair();
		await orders.set({ id: "o1", region: "eu" });
		await orders.set({ id: "o2", region: "us" });
		await shipments.set({ id: "s1", orderId: "o1" });

		const pool = await poolOf(orders as MySqlEntityStorageConnector);
		const querySpy = vi.spyOn(pool, "query");

		const result = await orders.queryJoin(shipments, {
			property: "id",
			joinProperty: "orderId",
			groupProperty: "region"
		});

		expect(querySpy).toHaveBeenCalledTimes(1);
		expect(result.entities.length).toEqual(2);
		querySpy.mockRestore();
	});
});
