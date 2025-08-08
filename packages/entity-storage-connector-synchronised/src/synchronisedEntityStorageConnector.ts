// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ComponentFactory, GeneralError, Guards, Is, StringHelper } from "@twin.org/core";
import {
	type EntityCondition,
	EntitySchemaFactory,
	EntitySchemaHelper,
	type IEntitySchema,
	type IEntitySchemaProperty,
	SortDirection
} from "@twin.org/entity";
import {
	EntityStorageConnectorFactory,
	type IEntityStorageConnector
} from "@twin.org/entity-storage-models";
import type { IEventBusComponent } from "@twin.org/event-bus-models";
import { nameof } from "@twin.org/nameof";
import {
	type ISyncBatchRequest,
	type ISyncBatchResponse,
	type ISynchronisedEntity,
	type ISyncItemChange,
	type ISyncItemRemove,
	type ISyncItemRequest,
	type ISyncItemResponse,
	type ISyncItemSet,
	type ISyncRegisterStorageKey,
	SyncChangeOperation,
	SynchronisedStorageTopics
} from "@twin.org/synchronised-storage-models";
import type { ISynchronisedEntityStorageConnectorConstructorOptions } from "./models/ISynchronisedEntityStorageConnectorConstructorOptions";

/**
 * Class for performing entity storage operations in synchronised storage.
 */
export class SynchronisedEntityStorageConnector<T extends ISynchronisedEntity = ISynchronisedEntity>
	implements IEntityStorageConnector<T>
{
	/**
	 * Runtime name for the class.
	 */
	public readonly CLASS_NAME: string = nameof<SynchronisedEntityStorageConnector>();

	/**
	 * The schema for the entity.
	 * @internal
	 */
	private readonly _entitySchema: IEntitySchema<T>;

	/**
	 * The primary key for the entity schema.
	 * @internal
	 */
	private readonly _primaryKey: IEntitySchemaProperty<T>;

	/**
	 * The storage key for the entity.
	 * @internal
	 */
	private readonly _storageKey: string;

	/**
	 * The entity storage connector to use for actual data.
	 * @internal
	 */
	private readonly _entityStorageConnector: IEntityStorageConnector<T>;

	/**
	 * The event bus component.
	 * @internal
	 */
	private readonly _eventBusComponent: IEventBusComponent;

	/**
	 * Create a new instance of SynchronisedEntityStorageConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: ISynchronisedEntityStorageConnectorConstructorOptions) {
		Guards.object<ISynchronisedEntityStorageConnectorConstructorOptions>(
			this.CLASS_NAME,
			nameof(options),
			options
		);
		Guards.stringValue(this.CLASS_NAME, nameof(options.entitySchema), options.entitySchema);
		Guards.stringValue(
			this.CLASS_NAME,
			nameof(options.entityStorageConnectorType),
			options.entityStorageConnectorType
		);

		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._storageKey = options?.config?.storageKey ?? StringHelper.kebabCase(options.entitySchema);

		this._primaryKey = EntitySchemaHelper.getPrimaryKey(this._entitySchema);

		const requiredProperties: (keyof ISynchronisedEntity)[] = ["id", "nodeIdentity", "dateModified"];

		for (const requiredProperty of requiredProperties) {
			const foundProperty = this._entitySchema.properties?.find(
				prop => prop.property === requiredProperty
			);
			if (Is.empty(foundProperty)) {
				throw new GeneralError(this.CLASS_NAME, "missingRequiredProperty", { requiredProperty });
			} else if (Is.empty(foundProperty.isPrimary) && Is.empty(foundProperty.isSecondary) && Is.empty(foundProperty.sortDirection)) {
				throw new GeneralError(this.CLASS_NAME, "missingRequiredPropertySort", {
					requiredProperty
				});
			}
		}

		this._entityStorageConnector = EntityStorageConnectorFactory.get(
			options.entityStorageConnectorType
		);

		this._eventBusComponent = ComponentFactory.get(options.eventBusComponentType ?? "event-bus");
	}

	/**
	 * Get the schema for the entities.
	 * @returns The schema for the entities.
	 */
	public getSchema(): IEntitySchema {
		return this._entitySchema as IEntitySchema;
	}

	/**
	 * The component needs to be started when the node is initialized.
	 * @param nodeIdentity The identity of the node starting the component.
	 * @param nodeLoggingConnectorType The node logging connector type, defaults to "node-logging".
	 * @param componentState A persistent state which can be modified by the method.
	 * @returns Nothing.
	 */
	public async start(
		nodeIdentity: string,
		nodeLoggingConnectorType: string | undefined,
		componentState?: {
			[id: string]: unknown;
		}
	): Promise<void> {
		// Tell the synchronised storage about this storage key
		await this._eventBusComponent.publish<ISyncRegisterStorageKey>(
			SynchronisedStorageTopics.RegisterStorageKey,
			{
				storageKey: this._storageKey
			}
		);

		this.handleEventBusMessages();
	}

	/**
	 * Get an entity.
	 * @param id The id of the entity to get, or the index value if secondaryIndex is set.
	 * @param secondaryIndex Get the item using a secondary index.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The object if it can be found or undefined.
	 */
	public async get(
		id: string,
		secondaryIndex?: keyof T,
		conditions?: { property: keyof T; value: unknown }[]
	): Promise<T | undefined> {
		Guards.stringValue(this.CLASS_NAME, nameof(id), id);

		return this._entityStorageConnector.get(id, secondaryIndex, conditions);
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The id of the entity.
	 */
	public async set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void> {
		Guards.object<T>(this.CLASS_NAME, nameof(entity), entity);

		// Make sure the entity has the required properties
		entity.dateModified = new Date(Date.now()).toISOString();

		await this._entityStorageConnector.set(entity, conditions);

		// Tell the synchronised storage about the entity changes
		await this._eventBusComponent.publish<ISyncItemChange>(
			SynchronisedStorageTopics.LocalItemChange,
			{
				storageKey: this._storageKey,
				operation: SyncChangeOperation.Set,
				id: entity[this._primaryKey.property] as string
			}
		);
	}

	/**
	 * Remove the entity.
	 * @param id The id of the entity to remove.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns Nothing.
	 */
	public async remove(
		id: string,
		conditions?: { property: keyof T; value: unknown }[]
	): Promise<void> {
		Guards.stringValue(this.CLASS_NAME, nameof(id), id);

		await this._entityStorageConnector.remove(id, conditions);

		// Tell the synchronised storage about the entity removal
		await this._eventBusComponent.publish<ISyncItemChange>(
			SynchronisedStorageTopics.LocalItemChange,
			{
				storageKey: this._storageKey,
				operation: SyncChangeOperation.Delete,
				id
			}
		);
	}

	/**
	 * Find all the entities which match the conditions.
	 * @param conditions The conditions to match for the entities.
	 * @param sortProperties The optional sort order.
	 * @param properties The optional properties to return, defaults to all.
	 * @param cursor The cursor to request the next page of entities.
	 * @param pageSize The suggested number of entities to return in each chunk, in some scenarios can return a different amount.
	 * @returns All the entities for the storage matching the conditions,
	 * and a cursor which can be used to request more entities.
	 */
	public async query(
		conditions?: EntityCondition<T>,
		sortProperties?: {
			property: keyof T;
			sortDirection: SortDirection;
		}[],
		properties?: (keyof T)[],
		cursor?: string,
		pageSize?: number
	): Promise<{
		/**
		 * The entities, which can be partial if a limited keys list was provided.
		 */
		entities: Partial<T>[];
		/**
		 * An optional cursor, when defined can be used to call find to get more entities.
		 */
		cursor?: string;
	}> {
		return this._entityStorageConnector.query(
			conditions,
			sortProperties,
			properties,
			cursor,
			pageSize
		);
	}

	/**
	 * Handle the event bus messages.
	 * @internal
	 */
	private handleEventBusMessages(): void {
		// When the synchronised storage requests an item, we need to provide it
		this._eventBusComponent.subscribe<ISyncItemRequest>(
			SynchronisedStorageTopics.LocalItemRequest,
			async params => {
				// Only handle the request if it matches the storage key
				if (params.data.storageKey === this._storageKey) {
					let entity: T | undefined;
					try {
						entity = await this._entityStorageConnector.get(params.data.id);
					} catch {}

					// Publish the item response with the entity
					this._eventBusComponent.publish<ISyncItemResponse<T>>(
						SynchronisedStorageTopics.LocalItemResponse,
						{
							storageKey: this._storageKey,
							id: params.data.id,
							entity
						}
					);
				}
			}
		);

		// When the synchronised storage requests a batch, we need to provide it
		this._eventBusComponent.subscribe<ISyncBatchRequest>(
			SynchronisedStorageTopics.BatchRequest,
			async params => {
				// Only handle the request if it matches the storage key
				if (params.data.storageKey === this._storageKey) {
					let cursor;
					do {
						const result = await this._entityStorageConnector.query(
							undefined,
							[{ property: "dateModified", sortDirection: SortDirection.Ascending }],
							undefined,
							cursor,
							params.data.batchSize
						);

						cursor = result.cursor;

						// Publish the batch response with the entities
						this._eventBusComponent.publish<ISyncBatchResponse<T>>(
							SynchronisedStorageTopics.BatchResponse,
							{
								storageKey: this._storageKey,
								primaryKey: this._primaryKey.property,
								entities: result.entities as T[],
								lastEntry: !Is.stringValue(cursor)
							}
						);
					} while (Is.stringValue(cursor));
				}
			}
		);

		// Subscribe to remote item set events from the synchronised storage and update the local storage
		this._eventBusComponent.subscribe<ISyncItemSet<T>>(
			SynchronisedStorageTopics.RemoteItemSet,
			async params => {
				// Only remove the item if it matches the storage key
				if (params.data.storageKey === this._storageKey) {
					await this.set(params.data.entity);
				}
			}
		);

		// Subscribe to remote item remove events from the synchronised storage and update the local storage
		this._eventBusComponent.subscribe<ISyncItemRemove>(
			SynchronisedStorageTopics.RemoteItemRemove,
			async params => {
				// Only remove the item if it matches the storage key
				if (params.data.storageKey === this._storageKey) {
					await this.remove(params.data.id);
				}
			}
		);
	}
}
