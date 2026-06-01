// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	BulkOperationType,
	type Container,
	CosmosClient,
	type FeedOptions,
	type ItemDefinition,
	type JSONValue,
	type OperationInput,
	PartitionKeyKind,
	type Resource,
	type SqlParameter,
	type SqlQuerySpec
} from "@azure/cosmos";
import { ContextIdHelper, ContextIdStore, type IContextIds } from "@twin.org/context";
import {
	BaseError,
	Coerce,
	ComponentFactory,
	GeneralError,
	Guards,
	HealthStatus,
	type IHealth,
	Is,
	ObjectHelper
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
	EntityStorageHelper,
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
export class CosmosDbEntityStorageConnector<
	T = unknown
> implements IEntityStorageMigrationConnector<T> {
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
	 * The configuration for the connector.
	 * @internal
	 */
	private readonly _config: ICosmosDbEntityStorageConnectorConfig;

	/**
	 * The Cosmos DB client.
	 * @internal
	 */
	private readonly _client: CosmosClient;

	/**
	 * Container user for the data storage.
	 * @internal
	 */
	private readonly _container: Container;

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

		this._config = options.config;

		this._client = new CosmosClient({
			endpoint: this._config.endpoint,
			key: this._config.key,
			connectionPolicy: {
				enableEndpointDiscovery: !this._config.disableEndpointDiscovery
			}
		});

		this._container = this._client
			.database(this._config.databaseId)
			.container(this._config.containerId);
	}

	/**
	 * Initialize the Cosmos DB environment.
	 * @param nodeLoggingComponentType Optional type of the logging component.
	 * @returns A promise that resolves to a boolean indicating success.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

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

				await this._client.databases.create({
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

				await this._client.database(this._config.databaseId).containers.create(
					{
						id: this._config.containerId,
						partitionKey: {
							kind: PartitionKeyKind.Hash,
							paths: [`/${CosmosDbEntityStorageConnector._PARTITION_KEY}`]
						}
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
			await this._client
				.database(this._config.databaseId)
				.container(this._config.containerId)
				.read();
			return [
				{
					source: CosmosDbEntityStorageConnector.CLASS_NAME,
					status: HealthStatus.Ok,
					description: "healthDescription",
					data: { databaseId: this._config.databaseId, containerId: this._config.containerId }
				}
			];
		} catch {
			return [
				{
					source: CosmosDbEntityStorageConnector.CLASS_NAME,
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

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			// No secondary index or conditions
			if (Is.empty(secondaryIndex) && !Is.arrayValue(conditions)) {
				const { resource: item } = await this._container
					.item(id, partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE)
					.read<ItemDefinition>();
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

			const { resources: items } = await this._container.items.query(query).fetchAll();

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

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const prepared = EntityStorageHelper.prepareEntity(entity, this._entitySchema, undefined, {
			nullBehavior: "omit"
		});

		const id = prepared[this._primaryKey.property] as string;

		try {
			if (Is.arrayValue(conditions)) {
				const item = this._container.item(
					id,
					partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE
				);
				const { resource: itemData } = await item.read<ItemDefinition>();
				if (Is.notEmpty(itemData) && !this.verifyConditions(conditions, itemData as T)) {
					return;
				}
			}

			await this._container.items.upsert({
				id,
				[CosmosDbEntityStorageConnector._PARTITION_KEY]:
					partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE,
				...prepared
			});
		} catch (err) {
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
			await this._container.items.executeBulkOperations(
				preparedEntities.map(
					prepared =>
						({
							operationType: BulkOperationType.Upsert,
							partitionKey: partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE,
							resourceBody: {
								id: prepared[this._primaryKey.property] as string,
								[CosmosDbEntityStorageConnector._PARTITION_KEY]:
									partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE,
								...(prepared as { [key: string]: unknown })
							}
						}) as OperationInput
				)
			);
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
			let continuationToken: string | undefined;
			do {
				const feedOptions: FeedOptions = { maxItemCount: 100, continuationToken };
				const { resources, continuationToken: nextToken } = await this._container.items
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
					await this._container.items.executeBulkOperations(operations);
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

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const item = this._container.item(
				id,
				partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE
			);
			const { resource: itemData } = await item.read<ItemDefinition>();
			if (Is.notEmpty(itemData)) {
				if (Is.arrayValue(conditions) && !this.verifyConditions(conditions, itemData as T)) {
					return;
				}

				await item.delete();
			}
		} catch (err) {
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
			const operations: OperationInput[] = ids.map(id => ({
				operationType: BulkOperationType.Delete,
				id,
				partitionKey: partitionKey ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE
			}));

			await this._container.items.executeBulkOperations(operations);
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
			if (await this.containerExists()) {
				await this._container.delete();
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

		try {
			const returnSize = limit ?? CosmosDbEntityStorageConnector._DEFAULT_LIMIT;

			let orderByClause: string = "";
			if (Array.isArray(sortProperties)) {
				if (sortProperties.length > 1) {
					throw new GeneralError(CosmosDbEntityStorageConnector.CLASS_NAME, "sortSingle");
				}
				for (const sortProperty of sortProperties) {
					const propertySchema = this._entitySchema.properties?.find(
						e => e.property === sortProperty.property
					);
					if (
						!propertySchema ||
						(!propertySchema.isPrimary &&
							!propertySchema.isSecondary &&
							!propertySchema.sortDirection)
					) {
						throw new GeneralError(CosmosDbEntityStorageConnector.CLASS_NAME, "sortNotIndexed", {
							property: sortProperty.property
						});
					}
					const direction = sortProperty.sortDirection === SortDirection.Ascending ? "asc" : "desc";
					orderByClause = `ORDER BY c.${String(sortProperty.property)} ${direction}`;
				}
			}

			const attributeNames: { [id: string]: string } = {};
			const attributeValues: { [id: string]: unknown } = {};
			let queryClause = this.buildQueryParameters("", conditions, attributeNames, attributeValues);

			if (queryClause.length > 0) {
				queryClause = ` AND ${queryClause}`;
			}

			sql = `SELECT ${properties ? properties.map(p => `c.${p as string}`).join(", ") : "*"} FROM c WHERE c.${CosmosDbEntityStorageConnector._PARTITION_KEY} = @partitionId ${queryClause} ${orderByClause}`;
			const querySpecs: SqlQuerySpec = {
				query: sql,
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

			const feedOptions: FeedOptions = {
				maxItemCount: returnSize,
				continuationToken: cursor
			};

			const feedResponse = await this._container.items.query(querySpecs, feedOptions).fetchNext();

			// CosmosDB returns a continuation token even on the last page, so peek ahead
			// to confirm there are actually more results before exposing the cursor.
			let resultCursor: string | undefined;
			if (feedResponse.resources.length >= returnSize && feedResponse.continuationToken) {
				const peekResponse = await this._container.items
					.query(querySpecs, {
						maxItemCount: 1,
						continuationToken: feedResponse.continuationToken
					})
					.fetchNext();
				if (peekResponse.resources.length > 0) {
					resultCursor = feedResponse.continuationToken;
				}
			}

			return {
				entities: feedResponse.resources.map(i => this.itemToEntity(i)),
				cursor: resultCursor
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
		try {
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
			const { resources } = await this._container.items.query(querySpec).fetchAll();
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
	 * @returns The list of unique context ids.
	 */
	public async getPartitionContextIds(): Promise<IContextIds[]> {
		const partitionContextIds = this._partitionContextIds;
		if (!Is.arrayValue(partitionContextIds)) {
			return [];
		}
		try {
			const { resources: partitionIds } = await this._container.items
				.query<string>({
					query: `SELECT DISTINCT VALUE c.${CosmosDbEntityStorageConnector._PARTITION_KEY} FROM c`
				})
				.fetchAll();
			return partitionIds
				.filter(id => Is.stringValue(id))
				.map(id => ContextIdHelper.shortSplit(partitionContextIds, id));
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
	 * Create the target connector for performing the migration using a temporary container.
	 * @param newEntitySchema The name of the new entity schema to create the connector for.
	 * @returns Connector for performing the migration.
	 */
	public async createTargetConnector<U>(
		newEntitySchema: string
	): Promise<IEntityStorageConnector<U>> {
		const migrationContainerId = `${this._config.containerId}Migration${Date.now()}`;
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
		options?: IMigrationOptions<T, U>,
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
		options?: IMigrationOptions<T, U>,
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
		partitions: IContextIds[],
		batchSize: number
	): Promise<void> {
		let partitionList: IContextIds[];
		if (Is.arrayValue(partitions)) {
			partitionList = partitions;
		} else if (Is.arrayValue(sourceConnector._partitionContextIds)) {
			partitionList = [];
		} else {
			partitionList = [{}];
		}

		for (let i = 0; i < partitionList.length; i++) {
			const partitionKey =
				ContextIdHelper.combinedContextKey(
					partitionList[i],
					sourceConnector._partitionContextIds
				) ?? CosmosDbEntityStorageConnector._PARTITION_KEY_VALUE;

			let continuationToken: string | undefined;
			do {
				const feedOptions: FeedOptions = { maxItemCount: batchSize, continuationToken };
				const { resources, continuationToken: nextToken } = await sourceConnector._container.items
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
					await destConnector._container.items.executeBulkOperations(operations);
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
	 * @param attributeValues The attribute values to use in the query.
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
			typeof attributeValues[propName] === "object" &&
			comparator.comparison === ComparisonOperator.Includes
		) {
			return `ARRAY_CONTAINS(c.${attributeName}, @${propName}, true)`;
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
			return Coerce.string(value) ?? "";
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
	 * Check if the database exists.
	 * @returns True if the database exists, false otherwise.
	 * @internal
	 */
	private async databaseExists(): Promise<boolean> {
		try {
			const { resources: databaseList } = await this._client.databases.readAll().fetchAll();

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
	 * Check if the container exists.
	 * @returns True if the container exists, false otherwise.
	 * @internal
	 */
	private async containerExists(): Promise<boolean> {
		try {
			const { resources: containers } = await this._client
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
