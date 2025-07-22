// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ComponentFactory } from "@twin.org/core";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@twin.org/entity";
import { MemoryEntityStorageConnector } from "@twin.org/entity-storage-connector-memory";
import { EntityStorageConnectorFactory } from "@twin.org/entity-storage-models";
import { LocalEventBusConnector } from "@twin.org/event-bus-connector-local";
import {
	EventBusConnectorFactory,
	type IEvent,
	type IEventBusComponent,
	type IEventBusConnector
} from "@twin.org/event-bus-models";
import { EventBusService } from "@twin.org/event-bus-service";
import { nameof } from "@twin.org/nameof";
import {
	type ISyncConsolidationBatchRequest,
	type ISyncConsolidationBatchResponse,
	SynchronisedStorageTopics,
	type ISyncItemSet,
	type ISyncItemRemove,
	type ISyncRegisterSchemaType
} from "@twin.org/synchronised-storage-models";
import { SynchronisedEntityStorageConnector } from "../src/synchronisedEntityStorageConnector";

/**
 * Test Type Definition.
 */
@entity()
class TestType {
	/**
	 * Id.
	 */
	@property({ type: "string", isPrimary: true })
	public id!: string;

	/**
	 * Node Identity.
	 */
	@property({ type: "string", isSecondary: true })
	public nodeIdentity!: string;

	/**
	 * Date Modified.
	 */
	@property({ type: "string", isSecondary: true })
	public dateModified!: string;
}

let eventBusConnector: IEventBusConnector;
let eventBusService: IEventBusComponent;
let memoryStorageConnector: MemoryEntityStorageConnector<TestType>;

describe("synchronisedEntityStorageConnector", () => {
	beforeEach(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
		memoryStorageConnector = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>()
		});
		EntityStorageConnectorFactory.register("memory", () => memoryStorageConnector);

		eventBusConnector = new LocalEventBusConnector();
		EventBusConnectorFactory.register("local", () => eventBusConnector);

		eventBusService = new EventBusService({
			eventBusConnectorType: "local"
		});
		ComponentFactory.register("event-bus", () => eventBusService);
	});

	test("can create an instance of the connector", async () => {
		const connector = new SynchronisedEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			entityStorageConnectorType: "memory",
			eventBusComponentType: "event-bus"
		});
		expect(connector).toBeInstanceOf(SynchronisedEntityStorageConnector);
	});

	test("can register its schema type when started", async () => {
		const connector = new SynchronisedEntityStorageConnector({
			entitySchema: nameof<TestType>(),
			entityStorageConnectorType: "memory",
			eventBusComponentType: "event-bus"
		});

		let registeredEventData: IEvent<ISyncRegisterSchemaType> | undefined;

		eventBusService.subscribe<ISyncRegisterSchemaType>(
			SynchronisedStorageTopics.RegisterSchemaType,
			async data => {
				registeredEventData = data;
			}
		);

		await connector?.start("test-node-identity", undefined);

		expect(registeredEventData).toBeDefined();
		expect(registeredEventData?.topic).toEqual("synchronised-storage:register-schema-type");
		expect(registeredEventData?.data.schemaType).toBe("test-type");
	});

	test("can set an item", async () => {
		const connector = new SynchronisedEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			entityStorageConnectorType: "memory",
			eventBusComponentType: "event-bus"
		});
		await connector?.start("test-node-identity", undefined);

		let setEventData: IEvent<ISyncItemSet<TestType>> | undefined;

		eventBusService.subscribe<ISyncItemSet<TestType>>(
			SynchronisedStorageTopics.LocalItemSet,
			async data => {
				setEventData = data;
			}
		);

		await connector.set({
			id: "test-id",
			nodeIdentity: "test-node",
			dateModified: new Date().toISOString()
		});

		expect(setEventData).toBeDefined();
		expect(setEventData?.topic).toEqual("synchronised-storage:local-item-set");
		expect(setEventData?.data.id).toBe("test-id");
		expect(setEventData?.data.schemaType).toBe("test-type");
		expect(setEventData?.data?.entity.id).toBe("test-id");
		expect(setEventData?.data?.entity?.nodeIdentity).toBe("test-node");
		expect(setEventData?.data?.entity?.dateModified).toBeDefined();

		expect(memoryStorageConnector.getStore()).toEqual([
			{
				id: "test-id",
				nodeIdentity: "test-node",
				dateModified: expect.any(String)
			}
		]);
	});

	test("can remove an item", async () => {
		const connector = new SynchronisedEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			entityStorageConnectorType: "memory",
			eventBusComponentType: "event-bus"
		});
		await connector?.start("test-node-identity", undefined);

		let removeEventData: IEvent<ISyncItemSet<TestType>> | undefined;

		eventBusService.subscribe<ISyncItemSet<TestType>>(
			SynchronisedStorageTopics.LocalItemRemove,
			async data => {
				removeEventData = data;
			}
		);

		await connector.set({
			id: "test-id",
			nodeIdentity: "test-node",
			dateModified: new Date().toISOString()
		});

		await connector.remove("test-id");

		expect(removeEventData).toBeDefined();
		expect(removeEventData?.topic).toEqual("synchronised-storage:local-item-remove");
		expect(removeEventData?.data.id).toBe("test-id");
		expect(removeEventData?.data.schemaType).toBe("test-type");
		expect(removeEventData?.data?.entity).toBeUndefined();

		expect(memoryStorageConnector.getStore()).toEqual([]);
	});

	test("can respond to a consolidation batch request", async () => {
		const connector = new SynchronisedEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			entityStorageConnectorType: "memory",
			eventBusComponentType: "event-bus"
		});
		await connector?.start("test-node-identity", undefined);

		let consolidateBatchResponseData1:
			| IEvent<ISyncConsolidationBatchResponse<TestType>>
			| undefined;
		let consolidateBatchResponseData2:
			| IEvent<ISyncConsolidationBatchResponse<TestType>>
			| undefined;

		eventBusService.subscribe<ISyncConsolidationBatchResponse<TestType>>(
			SynchronisedStorageTopics.ConsolidationBatchResponse,
			async event => {
				if (event.data.lastEntry) {
					consolidateBatchResponseData2 = event;
				} else {
					consolidateBatchResponseData1 = event;
				}
			}
		);

		for (let i = 0; i < 5; i++) {
			await connector.set({
				id: `test-id-${i}`,
				nodeIdentity: "test-node",
				dateModified: new Date().toISOString()
			});
		}

		await eventBusService.publish<ISyncConsolidationBatchRequest>(
			SynchronisedStorageTopics.ConsolidationBatchRequest,
			{
				schemaType: "test-type",
				consolidationBatchSize: 3
			}
		);

		expect(consolidateBatchResponseData1).toBeDefined();
		expect(consolidateBatchResponseData1?.topic).toEqual(
			"synchronised-storage:consolidation-batch-response"
		);
		expect(consolidateBatchResponseData1?.data.entities.length).toEqual(3);
		expect(consolidateBatchResponseData1?.data.lastEntry).toEqual(false);

		expect(consolidateBatchResponseData2).toBeDefined();
		expect(consolidateBatchResponseData2?.topic).toEqual(
			"synchronised-storage:consolidation-batch-response"
		);
		expect(consolidateBatchResponseData2?.data.entities.length).toEqual(2);
		expect(consolidateBatchResponseData2?.data.lastEntry).toEqual(true);
	});

	test("can populate from a remote item set", async () => {
		const connector = new SynchronisedEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			entityStorageConnectorType: "memory",
			eventBusComponentType: "event-bus"
		});
		await connector?.start("test-node-identity", undefined);

		await eventBusService.publish<ISyncItemSet<TestType>>(SynchronisedStorageTopics.RemoteItemSet, {
			schemaType: "test-type",
			id: "test-id",
			entity: {
				id: "test-id",
				nodeIdentity: "test-node",
				dateModified: new Date().toISOString()
			}
		});

		expect(memoryStorageConnector.getStore()).toEqual([
			{
				id: "test-id",
				nodeIdentity: "test-node",
				dateModified: expect.any(String)
			}
		]);
	});

	test("can remove from a remote item remove", async () => {
		const connector = new SynchronisedEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			entityStorageConnectorType: "memory",
			eventBusComponentType: "event-bus"
		});
		await connector?.start("test-node-identity", undefined);

		await connector.set({
			id: "test-id",
			nodeIdentity: "test-node",
			dateModified: new Date().toISOString()
		});

		await eventBusService.publish<ISyncItemRemove>(SynchronisedStorageTopics.RemoteItemRemove, {
			schemaType: "test-type",
			id: "test-id"
		});

		expect(memoryStorageConnector.getStore()).toEqual([]);
	});
});
