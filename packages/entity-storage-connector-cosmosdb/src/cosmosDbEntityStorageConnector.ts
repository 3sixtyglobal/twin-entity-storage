// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	BulkOperationType,
	type CompositePath,
	type Container,
	CosmosClient,
	type FeedOptions,
	type IndexingPolicy,
	type ItemDefinition,
	type JSONValue,
	type OperationInput,
	PartitionKeyKind,
	type Resource,
	type SqlParameter,
	type SqlQuerySpec
} from "@azure/cosmos";
import {
	HealthCategory,
	HealthStatus,
	type IHealth,
	type IHealthProviderComponent
} from "@twin.org/api-models";
import { ContextIdHelper, ContextIdStore, type IContextIds } from "@twin.org/context";
import {
	BaseError,
	Coerce,
	ComponentFactory,
	ConflictError,
	GeneralError,
	Guards,
	Is,
	Mutex,
	type IValidationFailure,
	ObjectHelper,
	RandomHelper,
	Validation
} from "@twin.org/core";
import {
	ComparisonOperator,
	type EntityCondition,
	EntitySchemaFactory,
	EntitySchemaHelper,
	type EntitySchemaPropertyType,
	type IComparator,
	type IEntitySchema,
	type IEntitySchemaProperty,
	LogicalOperator,
	SortDirection
} from "@twin.org/entity";
import {
	ConnectionHelper,
	EntityStorageHelper,
	MigrationHelper,
	type IEntityStorageConnector,
	type IEntityStorageMigrationConnector,
	type IMigrationOptions
} from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import type { ICosmosDbEntityStorageConnectorConfig } from "./models/ICosmosDbEntityStorageConnectorConfig.js";
import type { ICosmosDbEntityStorageConnectorConstructorOptions } from "./models/ICosmosDbEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations using Cosmos DB.
 */
export class CosmosDbEntityStorageConnector<T = unknown>
	implements IEntityStorageMigrationConnector<T>, IHealthProviderComponent
{
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<CosmosDbEntityStorageConnector>();

	/**
	 * Limit the number of entities when finding.
	 * @internal
	 */
	private static readonly _DEFAULT_LIMIT: number = 40;

	/**
	 * Partition id field name.
	 * @internal
	 */
	private static readonly _PARTITION_KEY: string = "partitionId";

	/**
	 * Partition id field value.
	 * @internal
	 */
	private static readonly _PARTITION_KEY_VALUE: string = "root";

	/**
	 * Batch chunk size for bulk write operations.
	 * @internal
	 */
	private static readonly _BATCH_CHUNK_SIZE: number = 1000;

	/**
	 * Cosmos DB's maximum container id length in characters.
	 * @internal
	 */
	private static readonly _MAX_IDENTIFIER_LENGTH: number = 255;

	/**
	 * Number of bulk operation chunks to dispatch concurrently in setBatch.
	 * @internal
	 */
	private static readonly _WRITE_CONCURRENCY: number = 10;

	/**
	 * The name for the schema.
	 * @internal
	 */
	private readonly _entitySchemaName: string;

	/**
	 * The schema for the entity.
	 * @internal
	 */
	private readonly _entitySchema: IEntitySchema<T>;

	/**
	 * The keys to use from the context ids to create partitions.
	 * @internal
	 */
	private readonly _partitionContextIds?: string[];

	/**
	 * The primary key.
	 * @internal
	 */
	private readonly _primaryKey: IEntitySchemaProperty<T>;

	/**
	 * The name of the version property, if any.
	 * @internal
	 */
	private readonly _versionKey?: string;

	/**
	 * The configuration for the connector.
	 * @internal
	 */
	private readonly _config: ICosmosDbEntityStorageConnectorConfig;

	/**
	 * Milliseconds to wait for optimistic-lock mutexes before throwing.
	 * @internal
	 */
	private readonly _mutexTimeoutMs?: number;

	/**
	 * Unique identifier for this connector instance, used to track references in SharedStore.
	 * @internal
	 */
	private readonly _instanceId: string;

	/**
	 * Create a new instance of CosmosDbEntityStorageConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: ICosmosDbEntityStorageConnectorConstructorOptions) {
		Guards.object(CosmosDbEntityStorageConnector.CLASS_NAME, nameof(options), options);
		Guards.stringValue(
			CosmosDbEntityStorageConnector.CLASS_NAME,
			nameof(options.entitySchema),
			options.entitySchema
		);
		Guards.object<ICosmosDbEntityStorageConnectorConfig>(
			CosmosDbEntityStorageConnector.CLASS_NAME,
			nameof(options.config),
			options.config
		);
		Guards.stringValue(
			CosmosDbEntityStorageConnector.CLASS_NAME,
			nameof(options.config.endpoint),
			options.config.endpoint
		);
		Guards.stringValue(
			CosmosDbEntityStorageConnector.CLASS_NAME,
			nameof(options.config.key),
			options.config.key
		);
		Guards.stringValue(
			CosmosDbEntityStorageConnector.CLASS_NAME,
			nameof(options.config.databaseId),
			options.config.databaseId
		);
		Guards.stringValue(
			CosmosDbEntityStorageConnector.CLASS_NAME,
			nameof(options.config.containerId),
			options.config.containerId
		);

		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._entitySchemaName = options.entitySchema;
		this._partitionContextIds = options.partitionContextIds;

		this._primaryKey = EntitySchemaHelper.getPrimaryKey<T>(this._entitySchema);
		this._versionKey = EntitySchemaHelper.findVersionProperty(this._entitySchema);

		this._config = options.config;
		this._mutexTimeoutMs = Coerce.integer(options.config.mutexTimeoutMs);
		this._instanceId = RandomHelper.generateUuidV7("compact");
	}

	/**
	 * The component needs to be stopped when the node is closed.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns Nothing.
	 */
	public async stop(nodeLoggingComponentType?: string): Promise<void> {
		await ConnectionHelper.closeClient<CosmosClient>(
			"cosmosDbClients",
			this.createClientId(),
			this._instanceId,
			this._mutexTimeoutMs,
			async client => client.dispose()
		);
	}

	/**
	 * Initialize the Cosmos DB environment.
	 * @param nodeLoggingComponentType Optional type of the logging component.
	 * @returns A promise that resolves to a boolean indicating success.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);
		const client = await this.getClient();

		// Create the database if it does not exist
		try {
			const databaseExists = await this.databaseExists();

			if (databaseExists) {
				await nodeLogging?.log({
					level: "info",
					source: CosmosDbEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "databaseExists",
					data: {
						databaseId: this._config.databaseId
					}
				});
			} else {
				await nodeLogging?.log({
					level: "info",
					source: CosmosDbEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "databaseCreating",
					data: {
						databaseId: this._config.databaseId
					}
				});

				await client.databases.create({
					id: this._config.databaseId
				});

				await this.waitForDatabaseExists();
			}
		} catch (error) {
			await nodeLogging?.log({
				level: "error",
				source: CosmosDbEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "databaseCreateFailed",
				error: BaseError.fromError(error),
				data: {
					databaseId: this._config.databaseId
				}
			});
			return false;
		}

		// Create the container if it does not exist
		try {
			const containerExists = await this.containerExists();

			if (containerExists) {
				await nodeLogging?.log({
					level: "info",
					source: CosmosDbEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "containerExists",
					data: {
						containerId: this._config.containerId
					}
				});

				// The container predates the current schema, so any composite indexes it is
				// missing have to be added to its indexing policy.
				try {
					await this.ensureIndexingPolicy(nodeLogging);
				} catch (error) {
					await nodeLogging?.log({
						level: "error",
						source: CosmosDbEntityStorageConnector.CLASS_NAME,
						ts: Date.now(),
						message: "indexPolicyUpdateFailed",
						error: BaseError.fromError(error),
						data: {
							containerId: this._config.containerId
						}
					});
					return false;
				}
			} else {
				await nodeLogging?.log({
					level: "info",
					source: CosmosDbEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "containerCreating",
					data: {
						containerId: this._config.containerId
					}
				});

				await client.database(this._config.databaseId).containers.create(
					{
						id: this._config.containerId,
						partitionKey: {
							kind: PartitionKeyKind.Hash,
							paths: [`/${CosmosDbEntityStorageConnector._PARTITION_KEY}`]
						},
						indexingPolicy: this.buildIndexingPolicy()
					},
					{ offerThroughput: this._config.offerThroughput }
				);

				await this.waitForContainerExists();
			}
		} catch (error) {
			await nodeLogging?.log({
				level: "error",
				source: CosmosDbEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "containerCreateFailed",
				error: BaseError.fromError(error),
				data: {
					containerId: this._config.containerId
				}
			});
			return false;
		}

		return true;
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return CosmosDbEntityStorageConnector.CLASS_NAME;
	}

	/**
	 * Returns the health status of the component.
	 * @returns The health status of the component.
	 */
	public async health(): Promise<IHealth[]> {
		try {
			const container = await this.getContainer();
			await container.read();
			return [
				{
					source: CosmosDbEntityStorageConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Ok,
					description: "healthDescription",
					data: { databaseId: this._config.databaseId, containerId: this._config.containerId }
				}
			];
		} catch {
			return [
				{
					source: CosmosDbEntityStorageConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Error,
					description: "healthDescription",
					message: "connectionFailed",
					data: { databaseId: this._config.databaseId, containerId: this._config.containerId }
				}
			];
		}
	}

	/**
	 * Get the schema for the entities.
	 * @returns The schema for the entities.
	 */
	public getSchema(): IEntitySchema {
		return this._entitySchema as IEntitySchema;
	}

	/**
	 * Get an entity from Cosmos DB.
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
		Guards.stringValue(CosmosDbEntityStorageConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const container = await this.getContainer();
			// No secondary index or conditions
			if (Is.empty(secondaryIndex) && !Is.arrayValue(conditions)) {
				const { resource: item } = await container
					.item(id, partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE)
					.read<ItemDefinition>();
				if (Is.empty(item)) {
					return undefined;
				}
				return this.itemToEntity(item);
			}

			const conditionValues: SqlParameter[] = [];

			const whereQuery: string[] = [
				`c.${CosmosDbEntityStorageConnector._PARTITION_KEY} = @partitionKey`
			];
			conditionValues.push({
				name: "@partitionKey",
				value: partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE
			});

			// With a secondary index
			if (Is.stringValue(secondaryIndex)) {
				const secIndex = secondaryIndex.toString();
				whereQuery.push(`c.${secIndex} = @id`);
			} else {
				whereQuery.push(`c.${this._primaryKey.property as string} = @id`);
			}
			conditionValues.push({ name: "@id", value: id });

			// With conditions
			if (Is.arrayValue(conditions)) {
				for (const c of conditions) {
					whereQuery.push(`c.${c.property as string} = @${c.property as string}`);
					conditionValues.push({
						name: `@${c.property as string}`,
						value: c.value as JSONValue
					});
				}
			}

			const query: SqlQuerySpec = {
				query: `SELECT * FROM c WHERE ${whereQuery.join(" AND ")}`,
				parameters: conditionValues
			};

			const { resources: items } = await container.items.query(query).fetchAll();

			if (items.length === 1) {
				return this.itemToEntity(items[0]);
			}
		} catch (err) {
			if (BaseError.isErrorCode(err, "NotFound")) {
				throw new GeneralError(
					CosmosDbEntityStorageConnector.CLASS_NAME,
					"containerDoesNotExist",
					{
						containerId: this._config.containerId
					},
					err
				);
			}
			throw new GeneralError(
				CosmosDbEntityStorageConnector.CLASS_NAME,
				"getFailed",
				{
					id
				},
				err
			);
		}
		return undefined;
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The id of the entity.
	 */
	public async set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void> {
		Guards.object<T>(CosmosDbEntityStorageConnector.CLASS_NAME, nameof(entity), entity);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const submittedVersion = Is.stringValue(this._versionKey)
			? ObjectHelper.propertyGet<number>(entity, this._versionKey)
			: undefined;
		const hasVersionCheck =
			!Is.empty(this._versionKey) && !Is.empty(submittedVersion) && submittedVersion > 0;

		const prepared = EntityStorageHelper.prepareEntity(entity, this._entitySchema, undefined, {
			nullBehavior: "omit"
		});

		const id = prepared[this._primaryKey.property] as string;
		const optimisticMutexKey = Is.stringValue(this._versionKey)
			? this.buildOptimisticMutexKey(partitionKey, id)
			: undefined;

		if (Is.stringValue(optimisticMutexKey)) {
			await Mutex.lock(optimisticMutexKey, {
				throwOnTimeout: true,
				timeoutMs: this._mutexTimeoutMs
			});
		}

		try {
			const container = await this.getContainer();
			let itemEtag: string | undefined;

			if (Is.stringValue(this._versionKey) || Is.arrayValue(conditions)) {
				const item = container.item(
					id,
					partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE
				);
				const { resource: itemData } = await item.read<ItemDefinition>();
				if (!Is.empty(itemData)) {
					if (hasVersionCheck) {
						const storedVersion = ObjectHelper.propertyGet<number>(itemData, this._versionKey) ?? 0;
						if (storedVersion !== submittedVersion) {
							throw new ConflictError(
								CosmosDbEntityStorageConnector.CLASS_NAME,
								"optimisticLockFailed",
								id
							);
						}
					}
					if (Is.arrayValue(conditions) && !this.verifyConditions(conditions, itemData as T)) {
						if (Is.stringValue(this._versionKey)) {
							throw new ConflictError(
								CosmosDbEntityStorageConnector.CLASS_NAME,
								"conditionFailed",
								id
							);
						}
						return;
					}
					itemEtag = ObjectHelper.propertyGet(itemData, "_etag");
				}
				if (Is.stringValue(this._versionKey)) {
					const storedVersion = !Is.empty(itemData)
						? (ObjectHelper.propertyGet<number>(itemData, this._versionKey) ?? 0)
						: 0;
					ObjectHelper.propertySet(prepared, this._versionKey, storedVersion + 1);
				}
			}

			await container.items.upsert(
				{
					id,
					[CosmosDbEntityStorageConnector._PARTITION_KEY]:
						partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE,
					...prepared
				},
				Is.stringValue(itemEtag)
					? { accessCondition: { type: "IfMatch", condition: itemEtag } }
					: undefined
			);
		} catch (err) {
			if (BaseError.isErrorName(err, ConflictError.CLASS_NAME)) {
				throw err;
			}
			if (Is.object<{ code?: number }>(err) && err.code === 412) {
				throw new ConflictError(
					CosmosDbEntityStorageConnector.CLASS_NAME,
					"optimisticLockFailed",
					id
				);
			}
			if (BaseError.isAggregateError(err)) {
				const errors = BaseError.fromAggregate(err);
				if (BaseError.someErrorCode(errors, "ResourceNotFoundException")) {
					throw new GeneralError(
						CosmosDbEntityStorageConnector.CLASS_NAME,
						"containerDoesNotExist",
						{
							containerId: this._config.containerId
						},
						err
					);
				}
			}
			throw new GeneralError(
				CosmosDbEntityStorageConnector.CLASS_NAME,
				"setFailed",
				{
					id
				},
				err
			);
		} finally {
			if (Is.stringValue(optimisticMutexKey)) {
				Mutex.unlock(optimisticMutexKey);
			}
		}
	}

	/**
	 * Set multiple entities in a batch.
	 * @param entities The entities to set.
	 * @returns Nothing.
	 */
	public async setBatch(entities: T[]): Promise<void> {
		Guards.arrayValue(CosmosDbEntityStorageConnector.CLASS_NAME, nameof(entities), entities);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const preparedEntities = entities.map(entity =>
			EntityStorageHelper.prepareEntity(entity, this._entitySchema, undefined, {
				nullBehavior: "omit"
			})
		);

		try {
			const container = await this.getContainer();
			const pk = partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE;
			const chunkSize = CosmosDbEntityStorageConnector._BATCH_CHUNK_SIZE;
			const concurrency = CosmosDbEntityStorageConnector._WRITE_CONCURRENCY;
			const windowSize = chunkSize * concurrency;
			for (let offset = 0; offset < preparedEntities.length; offset += windowSize) {
				const window = preparedEntities.slice(offset, offset + windowSize);
				const sends: Promise<void>[] = [];
				for (let j = 0; j < window.length; j += chunkSize) {
					const chunk = window.slice(j, j + chunkSize);
					sends.push(
						(async () => {
							await container.items.executeBulkOperations(
								chunk.map(
									prepared =>
										({
											operationType: BulkOperationType.Upsert,
											partitionKey: pk,
											resourceBody: {
												id: prepared[this._primaryKey.property] as string,
												[CosmosDbEntityStorageConnector._PARTITION_KEY]: pk,
												...(prepared as { [key: string]: unknown })
											}
										}) as OperationInput
								)
							);
						})()
					);
				}
				await Promise.all(sends);
			}
		} catch (err) {
			throw new GeneralError(
				CosmosDbEntityStorageConnector.CLASS_NAME,
				"setBatchFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Empty all entities from the storage.
	 * @returns Nothing.
	 */
	public async empty(): Promise<void> {
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);
		const pk = partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE;

		try {
			const container = await this.getContainer();
			let continuationToken: string | undefined;
			do {
				const feedOptions: FeedOptions = { maxItemCount: 100, continuationToken };
				const { resources, continuationToken: nextToken } = await container.items
					.query<{ id: string }>(
						{
							query: `SELECT c.id FROM c WHERE c.${CosmosDbEntityStorageConnector._PARTITION_KEY} = @pk`,
							parameters: [{ name: "@pk", value: pk }]
						},
						feedOptions
					)
					.fetchNext();

				continuationToken = nextToken;

				if (Is.arrayValue(resources)) {
					const operations: OperationInput[] = resources.map(r => ({
						operationType: BulkOperationType.Delete,
						id: r.id,
						partitionKey: pk
					}));
					await container.items.executeBulkOperations(operations);
				}
			} while (Is.stringValue(continuationToken));
		} catch (err) {
			throw new GeneralError(
				CosmosDbEntityStorageConnector.CLASS_NAME,
				"emptyFailed",
				undefined,
				err
			);
		}
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
		Guards.stringValue(CosmosDbEntityStorageConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);
		const optimisticMutexKey = Is.stringValue(this._versionKey)
			? this.buildOptimisticMutexKey(partitionKey, id)
			: undefined;

		if (Is.stringValue(optimisticMutexKey)) {
			await Mutex.lock(optimisticMutexKey, {
				throwOnTimeout: true,
				timeoutMs: this._mutexTimeoutMs
			});
		}

		try {
			const container = await this.getContainer();
			const item = container.item(
				id,
				partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE
			);
			const { resource: itemData } = await item.read<ItemDefinition>();
			if (Is.notEmpty(itemData)) {
				if (Is.arrayValue(conditions) && !this.verifyConditions(conditions, itemData as T)) {
					if (Is.stringValue(this._versionKey)) {
						throw new ConflictError(
							CosmosDbEntityStorageConnector.CLASS_NAME,
							"conditionFailed",
							id
						);
					}
					return;
				}

				await item.delete();
			}
		} catch (err) {
			if (BaseError.isErrorName(err, ConflictError.CLASS_NAME)) {
				throw err;
			}
			if (
				BaseError.fromError(err) &&
				Is.object<{ body?: { code?: string } }>(err) &&
				err.body?.code === "NotFound"
			) {
				return;
			}
			throw new GeneralError(
				CosmosDbEntityStorageConnector.CLASS_NAME,
				"removeFailed",
				{
					id
				},
				err
			);
		} finally {
			if (Is.stringValue(optimisticMutexKey)) {
				Mutex.unlock(optimisticMutexKey);
			}
		}
	}

	/**
	 * Remove multiple entities by id.
	 * @param ids The ids of the entities to remove.
	 * @returns Nothing.
	 */
	public async removeBatch(ids: string[]): Promise<void> {
		Guards.arrayValue(CosmosDbEntityStorageConnector.CLASS_NAME, nameof(ids), ids);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const container = await this.getContainer();
			const operations: OperationInput[] = ids.map(id => ({
				operationType: BulkOperationType.Delete,
				id,
				partitionKey: partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE
			}));

			await container.items.executeBulkOperations(operations);
		} catch (err) {
			throw new GeneralError(
				CosmosDbEntityStorageConnector.CLASS_NAME,
				"removeBatchFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Teardown the storage by deleting the underlying container.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the teardown process was successful.
	 */
	public async teardown(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		await nodeLogging?.log({
			level: "info",
			source: CosmosDbEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "containerDeleting",
			data: { containerId: this._config.containerId }
		});

		try {
			const container = await this.getContainer();
			if (await this.containerExists()) {
				await container.delete();
				await this.waitForContainerNotExists();
			}

			await nodeLogging?.log({
				level: "info",
				source: CosmosDbEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "containerDeleted",
				data: { containerId: this._config.containerId }
			});

			return true;
		} catch (err) {
			await nodeLogging?.log({
				level: "error",
				source: CosmosDbEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "teardownFailed",
				error: BaseError.fromError(err)
			});
			return false;
		}
	}

	/**
	 * Find all the entities which match the conditions.
	 * @param conditions The conditions to match for the entities.
	 * @param sortProperties The optional sort order.
	 * @param properties The optional properties to return, defaults to all.
	 * @param cursor The cursor to request the next chunk of entities.
	 * @param limit The suggested number of entities to return in each chunk, in some scenarios can return a different amount.
	 * @returns All the entities for the storage matching the conditions,
	 * and a cursor which can be used to request more entities.
	 */
	public async query(
		conditions?: EntityCondition<T>,
		sortProperties?: { property: keyof T; sortDirection: SortDirection }[],
		properties?: (keyof T)[],
		cursor?: string,
		limit?: number
	): Promise<{ entities: Partial<T>[]; cursor?: string }> {
		let sql = "";

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		EntityStorageHelper.validateSortProperties(this._entitySchema, sortProperties);
		EntityStorageHelper.validateProperties(this._entitySchema, properties);
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);

		// Only the sort shapes covered by the composite indexes from buildIndexingPolicy are accepted.
		if (Is.arrayValue(sortProperties)) {
			const nonPrimarySorts = sortProperties.filter(
				sortProperty => sortProperty.property !== this._primaryKey.property
			);
			if (nonPrimarySorts.length > 1) {
				throw new GeneralError(CosmosDbEntityStorageConnector.CLASS_NAME, "sortUnsupported", {
					properties: sortProperties.map(sortProperty => sortProperty.property),
					primaryKey: this._primaryKey.property
				});
			}
		}

		if (!Is.empty(limit)) {
			const validationFailures: IValidationFailure[] = [];
			Validation.integer(nameof(limit), limit, validationFailures, undefined, { minValue: 1 });
			Validation.asValidationError(
				CosmosDbEntityStorageConnector.CLASS_NAME,
				"query",
				validationFailures
			);
		}

		try {
			const container = await this.getContainer();
			const returnSize = limit ?? CosmosDbEntityStorageConnector._DEFAULT_LIMIT;

			let orderByClause: string = "";
			if (Is.arrayValue(sortProperties)) {
				// The primary key is unique so no property after its first occurrence can affect
				// the order, truncating keeps the ORDER BY within the provisioned composite indexes.
				const primaryKeyIndex = sortProperties.findIndex(
					sortProperty => sortProperty.property === this._primaryKey.property
				);
				const effectiveSorts =
					primaryKeyIndex === -1 ? sortProperties : sortProperties.slice(0, primaryKeyIndex + 1);
				const orderClauses = effectiveSorts.map(sortProperty => {
					const direction = sortProperty.sortDirection === SortDirection.Ascending ? "asc" : "desc";
					return `c.${String(sortProperty.property)} ${direction}`;
				});
				orderByClause = `ORDER BY ${orderClauses.join(", ")}`;
			}

			const attributeNames: { [id: string]: string } = {};
			const attributeValues: { [id: string]: unknown } = {};
			let queryClause = this.buildQueryParameters("", conditions, attributeNames, attributeValues);

			if (queryClause.length > 0) {
				queryClause = ` AND ${queryClause}`;
			}

			const selectClause = properties ? properties.map(p => `c.${p as string}`).join(", ") : "*";
			const baseQuery = `SELECT ${selectClause} FROM c WHERE c.${CosmosDbEntityStorageConnector._PARTITION_KEY} = @partitionId${queryClause}`;
			const queryParameters: SqlParameter[] = [
				{
					name: "@partitionId",
					value: partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE
				},
				...Object.keys(attributeValues).map(
					key => ({ name: `@${key}`, value: attributeValues[key] }) as SqlParameter
				)
			];
			const queryPartitionKey = partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE;

			// For sorted queries use OFFSET LIMIT - CosmosDB continuation tokens are
			// not reliably returned for ORDER BY queries across all service versions.
			// The cursor is a numeric offset encoded as a string (same as SQL connectors).
			const startIndex = Coerce.number(cursor) ?? 0;
			sql = `${baseQuery} ${orderByClause} OFFSET ${startIndex} LIMIT ${returnSize + 1}`;
			const sortedQuerySpecs: SqlQuerySpec = { query: sql, parameters: queryParameters };
			const sortedResponse = await container.items
				.query(sortedQuerySpecs, {
					partitionKey: queryPartitionKey,
					maxItemCount: returnSize + 1
				})
				.fetchNext();
			const allItems = sortedResponse.resources;
			const hasMore = allItems.length > returnSize;
			return {
				entities: (hasMore ? allItems.slice(0, returnSize) : allItems).map(i =>
					this.itemToEntity(i)
				),
				cursor: hasMore ? Coerce.string(startIndex + returnSize) : undefined
			};
		} catch (err) {
			throw new GeneralError(
				CosmosDbEntityStorageConnector.CLASS_NAME,
				"queryFailed",
				{ sql },
				err
			);
		}
	}

	/**
	 * Count all the entities which match the conditions.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The total count of entities in the storage.
	 */
	public async count(conditions?: EntityCondition<T>): Promise<number> {
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);
		try {
			const container = await this.getContainer();
			const contextIds = await ContextIdStore.getContextIds();
			const partitionKey = ContextIdHelper.combinedContextKey(
				contextIds,
				this._partitionContextIds
			);

			const attributeNames: { [id: string]: string } = {};
			const attributeValues: { [id: string]: unknown } = {};
			let queryClause = Is.empty(conditions)
				? ""
				: this.buildQueryParameters("", conditions, attributeNames, attributeValues);

			if (queryClause.length > 0) {
				queryClause = ` AND ${queryClause}`;
			}

			const querySpec: SqlQuerySpec = {
				query: `SELECT VALUE COUNT(1) FROM c WHERE c.${CosmosDbEntityStorageConnector._PARTITION_KEY} = @partitionId${queryClause}`,
				parameters: [
					{
						name: "@partitionId",
						value: partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE
					},
					...Object.keys(attributeValues).map(
						key => ({ name: `@${key}`, value: attributeValues[key] }) as SqlParameter
					)
				]
			};
			const { resources } = await container.items.query(querySpec).fetchAll();
			return resources[0] ?? 0;
		} catch (err) {
			throw new GeneralError(
				CosmosDbEntityStorageConnector.CLASS_NAME,
				"countFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Get a unique list of all the context ids from the storage.
	 * @param loggingComponentType The optional component type to use for logging skipped partition ids.
	 * @returns The list of unique context ids.
	 */
	public async getPartitionContextIds(
		loggingComponentType?: string
	): Promise<IContextIds[] | undefined> {
		const partitionContextIds = this._partitionContextIds;
		if (!Is.arrayValue(partitionContextIds)) {
			return undefined;
		}
		try {
			const container = await this.getContainer();
			const { resources: partitionIds } = await container.items
				.query<string>({
					query: `SELECT DISTINCT VALUE c.${CosmosDbEntityStorageConnector._PARTITION_KEY} FROM c`
				})
				.fetchAll();
			const contextIds: IContextIds[] = [];
			const skipped: string[] = [];
			for (const partitionId of partitionIds.filter(id => Is.stringValue(id))) {
				const split = EntityStorageHelper.tryShortSplit(partitionContextIds, partitionId);
				if (Is.undefined(split)) {
					skipped.push(partitionId);
				} else {
					contextIds.push(split);
				}
			}
			if (Is.arrayValue(skipped)) {
				const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(loggingComponentType);
				await nodeLogging?.log({
					level: "warn",
					source: CosmosDbEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "partitionIdsSkipped",
					data: {
						expected: partitionContextIds.length,
						partitionIds: skipped.join(", ")
					}
				});
			}
			return contextIds;
		} catch (err) {
			throw new GeneralError(
				CosmosDbEntityStorageConnector.CLASS_NAME,
				"getPartitionContextIdsFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Get the connector implementation version.
	 * @returns The connector implementation version.
	 */
	public connectorVersion(): number {
		return 0;
	}

	/**
	 * Create the target connector for performing the migration using a temporary container.
	 * @param newEntitySchema The name of the new entity schema to create the connector for.
	 * @returns Connector for performing the migration.
	 */
	public async createTargetConnector<U>(
		newEntitySchema: string
	): Promise<IEntityStorageConnector<U>> {
		const migrationContainerId = MigrationHelper.generateTargetName(
			this._config.containerId,
			CosmosDbEntityStorageConnector._MAX_IDENTIFIER_LENGTH
		);
		return new CosmosDbEntityStorageConnector<U>({
			entitySchema: newEntitySchema,
			config: { ...this._config, containerId: migrationContainerId },
			partitionContextIds: this._partitionContextIds
		});
	}

	/**
	 * Finalize the migration by tearing down the old container and replacing it with the target container.
	 * @param targetConnector The target connector to finalize the migration with.
	 * @param options The options to control how the migration is finalized.
	 * @param loggingComponentType The optional component type to use for logging.
	 * @returns The final connector pointing at the original container id.
	 */
	public async finalizeMigration<U>(
		targetConnector: CosmosDbEntityStorageConnector<U>,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<CosmosDbEntityStorageConnector<U>> {
		// There is no rename operation in DynamoDB so we have to create a new table with the original name and copy the data over

		// Teardown the existing table with the original name to free up the name for the new table
		await this.teardown(loggingComponentType);

		// Create a new connector with the original table name but with the new schema
		// and copy the data from the migration table to the new table using batch operations
		const finalConnector = new CosmosDbEntityStorageConnector<U>({
			entitySchema: targetConnector._entitySchemaName,
			config: this._config,
			partitionContextIds: this._partitionContextIds
		});
		if (await finalConnector.bootstrap(loggingComponentType)) {
			// Since there is no rename, we need to copy the data from the migration table to the new table
			const partitions = await targetConnector.getPartitionContextIds();
			const batchSize = options?.batchSize ?? CosmosDbEntityStorageConnector._DEFAULT_LIMIT;
			await this.bulkCopy(targetConnector, finalConnector, partitions, batchSize);

			await targetConnector.teardown(loggingComponentType);

			return finalConnector;
		}

		throw new GeneralError(
			CosmosDbEntityStorageConnector.CLASS_NAME,
			"finalizeMigrationFailedBootstrap"
		);
	}

	/**
	 * Cleanup the migration if a migration fails or needs to be aborted.
	 * @param targetConnector The target connector to cleanup.
	 * @param options The options to control how the migration is cleaned up.
	 * @param loggingComponentType The optional component type to use for logging.
	 */
	public async cleanupMigration<U>(
		targetConnector: IEntityStorageConnector<U> | undefined,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<void> {
		// If something failed the only thing to cleanup is the migration table
		await targetConnector?.teardown?.(loggingComponentType);
	}

	/**
	 * Copy all entities from sourceConnector to destConnector, paging through each partition.
	 * @param sourceConnector The connector to read entities from.
	 * @param destConnector The connector to write entities to.
	 * @param partitions The partition list returned by getPartitionContextIds.
	 * @param batchSize The number of entities to read per page.
	 * @internal
	 */
	private async bulkCopy<U>(
		sourceConnector: CosmosDbEntityStorageConnector<U>,
		destConnector: CosmosDbEntityStorageConnector<U>,
		partitions: IContextIds[] | undefined,
		batchSize: number
	): Promise<void> {
		// undefined → not partitioned: one pass with no partition key.
		// []        → partitioned but empty: nothing to copy, return early.
		// [{…}, …]  → partitioned with data: iterate over each partition.
		if (partitions?.length === 0) {
			return;
		}
		const partitionList = partitions ?? [{}];

		for (let i = 0; i < partitionList.length; i++) {
			// Values from getPartitionContextIds are already short-form, so we join them
			// directly rather than using combinedContextKey, which expects long-form input
			// and calls guardAll (throwing if a registered handler rejects short-form values).
			const partitionKey = Is.arrayValue(sourceConnector._partitionContextIds)
				? sourceConnector._partitionContextIds.map(k => partitionList[i][k]).join("/")
				: CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE;

			let continuationToken: string | undefined;
			do {
				const feedOptions: FeedOptions = { maxItemCount: batchSize, continuationToken };
				const { resources, continuationToken: nextToken } = await (
					await sourceConnector.getContainer()
				).items
					.query<ItemDefinition & Resource>(
						{
							query: `SELECT * FROM c WHERE c.${CosmosDbEntityStorageConnector._PARTITION_KEY} = @partitionId`,
							parameters: [{ name: "@partitionId", value: partitionKey }]
						},
						feedOptions
					)
					.fetchNext();

				continuationToken = nextToken;

				if (Is.arrayValue(resources)) {
					const operations: OperationInput[] = resources.map(
						({
							_rid: rid,
							_self: self,
							_ts: ts,
							_etag: etag,
							_attachments: attachments,
							...rest
						}) => ({
							operationType: BulkOperationType.Upsert,
							partitionKey,
							resourceBody: rest
						})
					);
					await (await destConnector.getContainer()).items.executeBulkOperations(operations);
				}
			} while (Is.stringValue(continuationToken));
		}
	}

	/**
	 * Create an SQL condition clause.
	 * @param objectPath The path for the nested object.
	 * @param condition The conditions to create the query from.
	 * @param attributeNames The attribute names to use in the query.
	 * @param attributeValues The attribute values to use in the query.
	 * @returns The condition clause.
	 * @internal
	 */
	private buildQueryParameters(
		objectPath: string,
		condition: EntityCondition<T> | undefined,
		attributeNames: { [id: string]: string },
		attributeValues: { [id: string]: unknown }
	): string {
		// If no conditions are defined then return empty string
		if (Is.undefined(condition)) {
			return "";
		}

		if ("conditions" in condition) {
			if (condition.conditions.length === 0) {
				return "";
			}
			// It's a group of comparisons, so check the individual items and combine with the logical operator
			const joinConditions: string[] = condition.conditions.map(c =>
				this.buildQueryParameters(objectPath, c, attributeNames, attributeValues)
			);

			const logicalOperator = this.mapConditionalOperator(condition.logicalOperator);
			const queryClause = joinConditions
				.filter(j => j.length > 0)
				.map(j => j)
				.join(` ${logicalOperator} `);

			return Is.stringValue(queryClause) ? ` (${queryClause}) ` : "";
		}

		const schemaProp = this._entitySchema.properties?.find(p => p.property === condition.property);

		// It's a single value so just create the property comparison for the condition
		const comparison = this.mapComparisonOperator(
			objectPath,
			condition,
			schemaProp?.type,
			attributeNames,
			attributeValues
		);

		return comparison;
	}

	/**
	 * Map the framework comparison operators to those in CosmosDB.
	 * @param objectPath The prefix to use for the condition.
	 * @param comparator The operator to map.
	 * @param type The type of the property.
	 * @param attributeNames The attribute names to use in the query.
	 * @returns The comparison expression.
	 * @throws GeneralError if the comparison operator is not supported.
	 * @internal
	 */
	private mapComparisonOperator(
		objectPath: string,
		comparator: IComparator,
		type: EntitySchemaPropertyType | undefined,
		attributeNames: { [id: string]: string },
		attributeValues: { [id: string]: unknown }
	): string {
		let prop = objectPath;
		if (prop.length > 0) {
			prop += ".";
		}
		prop += comparator.property;

		let attributeName = this.populateAttributeNames(prop, attributeNames);
		let propName = `${attributeName.replace(/\./g, "").replace(/@/g, "")}`;

		if (
			(comparator.comparison === ComparisonOperator.Equals ||
				comparator.comparison === ComparisonOperator.NotEquals) &&
			(comparator.value === null || comparator.value === undefined)
		) {
			// Cosmos DB SQL null semantics mirror standard SQL: any comparison using = or <>
			// against null evaluates to UNKNOWN, not TRUE, so no rows are returned.
			// IS_NULL() and IS_DEFINED() must be used instead (no bound parameter needed).
			if (comparator.comparison === ComparisonOperator.Equals) {
				return `(IS_NULL(c.${attributeName}) OR NOT IS_DEFINED(c.${attributeName}))`;
			}
			return `(IS_DEFINED(c.${attributeName}) AND NOT IS_NULL(c.${attributeName}))`;
		} else if (Is.array(comparator.value)) {
			const dbValues = comparator.value.map(v => this.propertyToDbValue(v, type));
			if (dbValues.length === 0 && comparator.comparison === ComparisonOperator.In) {
				// CosmosDB rejects `IN ()` - return always-false sentinel (#141).
				return "1=0";
			}
			const arrAttributeNames = [];
			for (let i = 0; i < dbValues.length; i++) {
				const arrAttributeName = `${propName}${i}`;
				attributeValues[arrAttributeName] = dbValues[i];
				arrAttributeNames.push(arrAttributeName);
			}
			propName = attributeName;
			attributeName = `(${arrAttributeNames.map(name => `@${name}`).join(", ")})`;
		} else if (
			Is.object(comparator.value) &&
			(comparator.comparison === ComparisonOperator.Equals ||
				comparator.comparison === ComparisonOperator.NotEquals)
		) {
			// CosmosDB SQL does not support object equality with =; expand to per-property comparisons.
			const op = comparator.comparison === ComparisonOperator.Equals ? "=" : "<>";
			const join = comparator.comparison === ComparisonOperator.Equals ? " AND " : " OR ";
			const clauses: string[] = [];
			for (const [key, val] of Object.entries(comparator.value)) {
				const paramName = `${propName}${key}`;
				attributeValues[paramName] = val;
				clauses.push(`c.${attributeName}.${key} ${op} @${paramName}`);
			}
			return clauses.length === 1 ? clauses[0] : `(${clauses.join(join)})`;
		} else {
			// Avoid parameter name conflicts by ensuring unique parameter names in the query
			let counter = 1;
			while (propName in attributeValues) {
				propName = `${attributeName.replace(/\./g, "").replace(/@/g, "")}${counter}`;
				counter++;
			}
			attributeValues[propName] = comparator.value;
		}

		const matches = attributeName.split(".").length;
		if (matches && comparator.comparison === ComparisonOperator.Equals) {
			attributeName = attributeName
				.split(".")
				.map(part => `["${part}"]`)
				.join("");
			return `c${attributeName} = @${propName}`;
		} else if (comparator.comparison === ComparisonOperator.Equals) {
			return `c.${attributeName} = @${propName}`;
		} else if (comparator.comparison === ComparisonOperator.NotEquals) {
			return `c.${attributeName} <> @${propName}`;
		} else if (comparator.comparison === ComparisonOperator.GreaterThan) {
			return `c.${attributeName} > @${propName}`;
		} else if (comparator.comparison === ComparisonOperator.LessThan) {
			return `c.${attributeName} < @${propName}`;
		} else if (comparator.comparison === ComparisonOperator.GreaterThanOrEqual) {
			return `c.${attributeName} >= @${propName}`;
		} else if (comparator.comparison === ComparisonOperator.LessThanOrEqual) {
			return `c.${attributeName} <= @${propName}`;
		} else if (
			Is.object(attributeValues[propName]) &&
			comparator.comparison === ComparisonOperator.Includes
		) {
			return `ARRAY_CONTAINS(c.${attributeName}, @${propName}, true)`;
		} else if (
			(type === "array" || type === "object") &&
			comparator.comparison === ComparisonOperator.Includes
		) {
			return `ARRAY_CONTAINS(c.${attributeName}, @${propName})`;
		} else if (
			(type === "array" || type === "object") &&
			comparator.comparison === ComparisonOperator.NotIncludes
		) {
			return `NOT ARRAY_CONTAINS(c.${attributeName}, @${propName})`;
		} else if (comparator.comparison === ComparisonOperator.Includes) {
			return `CONTAINS(c.${attributeName}, @${propName})`;
		} else if (comparator.comparison === ComparisonOperator.NotIncludes) {
			return `NOT CONTAINS(c.${attributeName}, @${propName})`;
		} else if (comparator.comparison === ComparisonOperator.In) {
			return `c.${propName} IN ${attributeName}`;
		}

		throw new GeneralError(CosmosDbEntityStorageConnector.CLASS_NAME, "comparisonNotSupported", {
			comparison: comparator.comparison
		});
	}

	/**
	 * Format a value to insert into DB.
	 * @param value The value to format.
	 * @param type The type for the property.
	 * @returns The value after conversion.
	 * @internal
	 */
	private propertyToDbValue(value: unknown, type?: EntitySchemaPropertyType): unknown {
		if (Is.object(value)) {
			const map: { [id: string]: unknown } = {};
			for (const key in value) {
				map[key] = this.propertyToDbValue(value[key]);
			}
			return map;
		}

		if (type === "string") {
			return `${Coerce.string(value)}`;
		} else if (type === "integer" || type === "number") {
			return Coerce.number(value) ?? 0;
		} else if (type === "boolean") {
			return Coerce.boolean(value) ?? false;
		}

		return Coerce.string(value) ?? "";
	}

	/**
	 * Create a unique name for the attribute.
	 * @param name The name to create a unique name for.
	 * @param attributeNames The attribute names to use in the query.
	 * @returns The unique name.
	 * @internal
	 */
	private populateAttributeNames(name: string, attributeNames: { [id: string]: string }): string {
		const parts = name.split(".");
		const attributeNameParts: string[] = [];

		for (const part of parts) {
			const hashPart = `${part}`;
			if (Is.empty(attributeNames[hashPart])) {
				attributeNames[hashPart] = part;
			}
			attributeNameParts.push(hashPart);
		}

		return attributeNameParts.join(".");
	}

	/**
	 * Map the framework conditional operators to those in CosmosDB.
	 * @param operator The operator to map.
	 * @returns The conditional operator.
	 * @throws GeneralError if the conditional operator is not supported.
	 * @internal
	 */
	private mapConditionalOperator(operator?: LogicalOperator): string {
		if ((operator ?? LogicalOperator.And) === LogicalOperator.And) {
			return "AND";
		} else if (operator === LogicalOperator.Or) {
			return "OR";
		}

		throw new GeneralError(CosmosDbEntityStorageConnector.CLASS_NAME, "conditionalNotSupported", {
			operator
		});
	}

	/**
	 * Verify the conditions for the entity.
	 * @param conditions The conditions to verify.
	 * @param obj The object to verify the conditions against.
	 * @returns True if all conditions are met, false otherwise.
	 * @internal
	 */
	private verifyConditions(
		conditions: { property: keyof T; value: unknown }[],
		obj: { [key in keyof T]: unknown }
	): boolean {
		return conditions.every(
			condition => ObjectHelper.propertyGet(obj, condition.property as string) === condition.value
		);
	}

	/**
	 * Build a mutex key for optimistic-locking critical sections.
	 * @param partitionKey The resolved partition key.
	 * @param id The entity id.
	 * @returns The mutex key.
	 * @internal
	 */
	private buildOptimisticMutexKey(partitionKey: string | undefined, id: string): string {
		return `${CosmosDbEntityStorageConnector.CLASS_NAME}:optimistic:${this._config.databaseId}:${this._config.containerId}:${partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE}:${id}`;
	}

	/**
	 * Convert an entity to an item.
	 * @param item The item to convert.
	 * @returns The entity.
	 * @internal
	 */
	private itemToEntity(item: (ItemDefinition & Resource) | undefined): T {
		return EntityStorageHelper.unPrepareEntity<T>(item as T, [
			CosmosDbEntityStorageConnector._PARTITION_KEY,
			"_attachments",
			"_etag",
			"_rid",
			"_self",
			"_ts"
		]);
	}

	/**
	 * Retrieve (or lazily create) the shared Cosmos DB client for this endpoint.
	 * @returns The shared client.
	 * @internal
	 */
	private async getClient(): Promise<CosmosClient> {
		return ConnectionHelper.openClient<CosmosClient>(
			"cosmosDbClients",
			this.createClientId(),
			this._instanceId,
			this._mutexTimeoutMs,
			async () =>
				new CosmosClient({
					endpoint: this._config.endpoint,
					key: this._config.key,
					connectionPolicy: {
						enableEndpointDiscovery: !this._config.disableEndpointDiscovery
					}
				})
		);
	}

	/**
	 * Get the container for this connector's configured database and container.
	 * @returns The container reference.
	 * @internal
	 */
	private async getContainer(): Promise<Container> {
		return (await this.getClient())
			.database(this._config.databaseId)
			.container(this._config.containerId);
	}

	/**
	 * Build a stable cache key for the shared client based on connection parameters.
	 * @returns The client cache key.
	 * @internal
	 */
	private createClientId(): string {
		return `${this._config.endpoint}|${this._config.databaseId}|${this._config.containerId}`;
	}

	/**
	 * Check if the database exists.
	 * @returns True if the database exists, false otherwise.
	 * @internal
	 */
	private async databaseExists(): Promise<boolean> {
		try {
			const client = await this.getClient();
			const { resources: databaseList } = await client.databases.readAll().fetchAll();

			return databaseList.some((db: Resource) => db.id === this._config.databaseId);
		} catch {
			return false;
		}
	}

	/**
	 * Wait for a database to exist.
	 * @returns Nothing.
	 * @internal
	 */
	private async waitForDatabaseExists(): Promise<void> {
		for (let attempt = 0; attempt < 20; attempt++) {
			const databaseExists = await this.databaseExists();
			if (databaseExists) {
				break;
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}
	}

	/**
	 * Build the composite indexes needed to serve multi-property ORDER BY queries.
	 * Pairing each sortable property with the primary key in both directions covers all
	 * four direction combinations, as Cosmos DB also serves each index reversed.
	 * @returns The indexing policy for the container, or undefined if the schema has no
	 * sortable properties.
	 * @internal
	 */
	private buildIndexingPolicy(): IndexingPolicy | undefined {
		const primaryKeyPath = `/${this._primaryKey.property as string}`;
		const compositeIndexes: CompositePath[][] = [];

		if (Is.arrayValue(this._entitySchema.properties)) {
			for (const prop of this._entitySchema.properties) {
				if (!prop.isPrimary && (Is.stringValue(prop.sortDirection) || prop.isSecondary)) {
					const propertyPath = `/${prop.property as string}`;
					compositeIndexes.push([
						{ path: propertyPath, order: "ascending" },
						{ path: primaryKeyPath, order: "ascending" }
					]);
					compositeIndexes.push([
						{ path: propertyPath, order: "ascending" },
						{ path: primaryKeyPath, order: "descending" }
					]);
				}
			}
		}

		return compositeIndexes.length > 0
			? {
					indexingMode: "consistent",
					automatic: true,
					includedPaths: [{ path: "/*" }],
					compositeIndexes
				}
			: undefined;
	}

	/**
	 * Add any composite indexes the current schema needs which are missing from an existing
	 * container, leaving the rest of its indexing policy untouched.
	 * @param nodeLogging The logging component.
	 * @returns Nothing.
	 * @internal
	 */
	private async ensureIndexingPolicy(nodeLogging?: ILoggingComponent): Promise<void> {
		const desiredCompositeIndexes = this.buildIndexingPolicy()?.compositeIndexes;

		if (!Is.arrayValue(desiredCompositeIndexes)) {
			return;
		}

		const container = await this.getContainer();
		const { resource: containerDefinition } = await container.read();

		if (Is.empty(containerDefinition)) {
			return;
		}

		const existingPolicy = containerDefinition.indexingPolicy ?? {};
		const existingCompositeIndexes = existingPolicy.compositeIndexes ?? [];
		const existingKeys = existingCompositeIndexes.map(compositeIndex =>
			this.compositeIndexKey(compositeIndex)
		);

		const missingCompositeIndexes = desiredCompositeIndexes.filter(
			compositeIndex => !existingKeys.includes(this.compositeIndexKey(compositeIndex))
		);

		if (missingCompositeIndexes.length === 0) {
			return;
		}

		await nodeLogging?.log({
			level: "info",
			source: CosmosDbEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "indexPolicyUpdating",
			data: {
				containerId: this._config.containerId,
				count: missingCompositeIndexes.length
			}
		});

		await container.replace({
			...containerDefinition,
			indexingPolicy: {
				...existingPolicy,
				compositeIndexes: [...existingCompositeIndexes, ...missingCompositeIndexes]
			}
		});

		await nodeLogging?.log({
			level: "info",
			source: CosmosDbEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "indexPolicyUpdated",
			data: {
				containerId: this._config.containerId,
				count: missingCompositeIndexes.length
			}
		});
	}

	/**
	 * Build a comparable key for a composite index so existing ones can be matched.
	 * @param compositeIndex The composite index paths.
	 * @returns The comparable key.
	 * @internal
	 */
	private compositeIndexKey(compositeIndex: CompositePath[]): string {
		return compositeIndex.map(path => `${path.path}:${path.order ?? "ascending"}`).join("|");
	}

	/**
	 * Check if the container exists.
	 * @returns True if the container exists, false otherwise.
	 * @internal
	 */
	private async containerExists(): Promise<boolean> {
		try {
			const client = await this.getClient();
			const { resources: containers } = await client
				.database(this._config.databaseId)
				.containers.readAll()
				.fetchAll();

			return containers.some((c: Resource) => c.id === this._config.containerId);
		} catch {
			return false;
		}
	}

	/**
	 * Wait for a container to exist.
	 * @returns Nothing.
	 * @internal
	 */
	private async waitForContainerExists(): Promise<void> {
		for (let attempt = 0; attempt < 20; attempt++) {
			const containerExists = await this.containerExists();
			if (containerExists) {
				break;
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}
	}

	/**
	 * Wait for a container to not exist.
	 * @returns Nothing.
	 * @internal
	 */
	private async waitForContainerNotExists(): Promise<void> {
		for (let attempt = 0; attempt < 20; attempt++) {
			const containerExists = await this.containerExists();
			if (!containerExists) {
				break;
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}
	}
}
