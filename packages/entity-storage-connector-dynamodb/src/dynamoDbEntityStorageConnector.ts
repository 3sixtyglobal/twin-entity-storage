// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	type AttributeValue,
	BatchWriteItemCommand,
	type CreateTableCommandInput,
	DynamoDB,
	type DynamoDBClientConfig,
	type GlobalSecondaryIndex,
	QueryCommand,
	ScanCommand as RawScanCommand,
	waitUntilTableExists,
	waitUntilTableNotExists
} from "@aws-sdk/client-dynamodb";
import {
	BatchWriteCommand,
	DeleteCommand,
	DynamoDBDocumentClient,
	GetCommand,
	PutCommand,
	ScanCommand
} from "@aws-sdk/lib-dynamodb";
import { type NativeAttributeValue, unmarshall } from "@aws-sdk/util-dynamodb";
import { ContextIdHelper, ContextIdStore, type IContextIds } from "@twin.org/context";
import {
	BaseError,
	Coerce,
	ComponentFactory,
	Converter,
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
import type { IDynamoDbEntityStorageConnectorConfig } from "./models/IDynamoDbEntityStorageConnectorConfig.js";
import type { IDynamoDbEntityStorageConnectorConstructorOptions } from "./models/IDynamoDbEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations using Dynamo DB.
 */
export class DynamoDbEntityStorageConnector<
	T = unknown
> implements IEntityStorageMigrationConnector<T> {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<DynamoDbEntityStorageConnector>();

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
	private readonly _config: IDynamoDbEntityStorageConnectorConfig;

	/**
	 * Create a new instance of DynamoDbEntityStorageConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IDynamoDbEntityStorageConnectorConstructorOptions) {
		Guards.object(DynamoDbEntityStorageConnector.CLASS_NAME, nameof(options), options);
		Guards.stringValue(
			DynamoDbEntityStorageConnector.CLASS_NAME,
			nameof(options.entitySchema),
			options.entitySchema
		);
		Guards.object<IDynamoDbEntityStorageConnectorConfig>(
			DynamoDbEntityStorageConnector.CLASS_NAME,
			nameof(options.config),
			options.config
		);

		options.config.authMode ??= "credentials";

		if (options.config.authMode === "credentials") {
			Guards.stringValue(
				DynamoDbEntityStorageConnector.CLASS_NAME,
				nameof(options.config.accessKeyId),
				options.config.accessKeyId
			);
			Guards.stringValue(
				DynamoDbEntityStorageConnector.CLASS_NAME,
				nameof(options.config.secretAccessKey),
				options.config.secretAccessKey
			);
		}
		Guards.stringValue(
			DynamoDbEntityStorageConnector.CLASS_NAME,
			nameof(options.config.region),
			options.config.region
		);
		Guards.stringValue(
			DynamoDbEntityStorageConnector.CLASS_NAME,
			nameof(options.config.tableName),
			options.config.tableName
		);

		this._partitionContextIds = options.partitionContextIds;

		this._entitySchemaName = options.entitySchema;
		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._primaryKey = EntitySchemaHelper.getPrimaryKey<T>(this._entitySchema);

		this._config = options.config;
		this._config.endpoint = Is.stringValue(this._config.endpoint)
			? this._config.endpoint
			: undefined;
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return DynamoDbEntityStorageConnector.CLASS_NAME;
	}

	/**
	 * Returns the health status of the component.
	 * @returns The health status of the component.
	 */
	public async health(): Promise<IHealth[]> {
		try {
			const dbConnection = this.createConnection();
			await dbConnection.describeTable({ TableName: this._config.tableName });
			return [
				{
					source: DynamoDbEntityStorageConnector.CLASS_NAME,
					status: HealthStatus.Ok,
					description: "healthDescription",
					data: { tableName: this._config.tableName }
				}
			];
		} catch {
			return [
				{
					source: DynamoDbEntityStorageConnector.CLASS_NAME,
					status: HealthStatus.Error,
					description: "healthDescription",
					message: "connectionFailed",
					data: { tableName: this._config.tableName }
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
	 * Bootstrap the component by creating and initializing any resources it needs.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the bootstrapping process was successful.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		if (!(await this.tableExists(this._config.tableName))) {
			await nodeLogging?.log({
				level: "info",
				source: DynamoDbEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "tableCreating",
				data: {
					tableName: this._config.tableName
				}
			});

			try {
				const dbConnection = this.createConnection();

				const tableParams: CreateTableCommandInput = {
					AttributeDefinitions: [],
					KeySchema: [],
					ProvisionedThroughput: {
						ReadCapacityUnits: 1,
						WriteCapacityUnits: 1
					},
					TableName: this._config.tableName
				};

				// We always add a partition key to the table as a non optional hash key
				// is always required when querying using sort parameters
				tableParams.AttributeDefinitions?.push({
					AttributeName: DynamoDbEntityStorageConnector._PARTITION_KEY,
					AttributeType: "S"
				});
				tableParams.KeySchema?.push({
					AttributeName: DynamoDbEntityStorageConnector._PARTITION_KEY,
					KeyType: "HASH"
				});

				const gsi: GlobalSecondaryIndex[] = [];

				if (Is.arrayValue(this._entitySchema.properties)) {
					for (const prop of this._entitySchema.properties) {
						if (prop.isPrimary) {
							tableParams.AttributeDefinitions?.push({
								AttributeName: prop.property as string,
								AttributeType: prop.type === "integer" || prop.type === "number" ? "N" : "S"
							});
							tableParams.KeySchema?.push({
								AttributeName: prop.property as string,
								KeyType: "RANGE"
							});
						} else if (Is.stringValue(prop.sortDirection) || prop.isSecondary) {
							// You can only query and sort items if you have a secondary index
							// defined for the property
							tableParams.AttributeDefinitions?.push({
								AttributeName: prop.property as string,
								AttributeType: prop.type === "integer" || prop.type === "number" ? "N" : "S"
							});

							gsi.push({
								IndexName: `${prop.property as string}Index`,
								KeySchema: [
									{
										AttributeName: DynamoDbEntityStorageConnector._PARTITION_KEY,
										KeyType: "HASH"
									},
									{
										AttributeName: prop.property as string,
										KeyType: "RANGE"
									}
								],
								Projection: {
									ProjectionType: "ALL"
								},
								ProvisionedThroughput: {
									ReadCapacityUnits: 1,
									WriteCapacityUnits: 1
								}
							});
						}
					}
				}

				if (gsi.length > 0) {
					tableParams.GlobalSecondaryIndexes = gsi;
				}

				await dbConnection.createTable(tableParams);

				// Wait for table to exist
				await waitUntilTableExists(
					{
						client: dbConnection,
						maxWaitTime: 60
					},
					{
						TableName: this._config.tableName
					}
				);

				await nodeLogging?.log({
					level: "info",
					source: DynamoDbEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "tableCreated",
					data: {
						tableName: this._config.tableName
					}
				});
			} catch (err) {
				if (BaseError.isErrorCode(err, "ResourceInUseException")) {
					await nodeLogging?.log({
						level: "info",
						source: DynamoDbEntityStorageConnector.CLASS_NAME,
						ts: Date.now(),
						message: "tableExists",
						data: {
							tableName: this._config.tableName
						}
					});
				} else {
					await nodeLogging?.log({
						level: "error",
						source: DynamoDbEntityStorageConnector.CLASS_NAME,
						ts: Date.now(),
						message: "tableCreateFailed",
						error: BaseError.fromError(err),
						data: {
							tableName: this._config.tableName
						}
					});
				}
				return false;
			}
		} else {
			await nodeLogging?.log({
				level: "info",
				source: DynamoDbEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "tableExists",
				data: {
					tableName: this._config.tableName
				}
			});
		}

		return true;
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
		Guards.stringValue(DynamoDbEntityStorageConnector.CLASS_NAME, nameof(id), id);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const docClient = this.createDocClient();

			if (Is.empty(secondaryIndex) && Is.empty(conditions)) {
				const getCommand = new GetCommand({
					TableName: this._config.tableName,
					Key: {
						[DynamoDbEntityStorageConnector._PARTITION_KEY]:
							partitionKey ?? DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE,
						[this._primaryKey.property]: id
					}
				});

				const response = await docClient.send(getCommand);

				if (response.Item) {
					return EntityStorageHelper.unPrepareEntity<T>(response.Item as T, [
						DynamoDbEntityStorageConnector._PARTITION_KEY
					]);
				}
				return undefined;
			}

			const finalConditions: EntityCondition<T> = {
				conditions: []
			};

			if (Is.stringValue(secondaryIndex)) {
				finalConditions.conditions.push({
					property: secondaryIndex,
					comparison: ComparisonOperator.Equals,
					value: id
				});
			}
			if (Is.arrayValue(conditions)) {
				for (const c of conditions) {
					finalConditions.conditions.push({
						property: c.property as string,
						comparison: ComparisonOperator.Equals,
						value: c.value
					});
				}
			}

			const queryResult = await this.internalQuery(
				finalConditions,
				undefined,
				undefined,
				undefined,
				1,
				secondaryIndex as string,
				partitionKey
			);

			return queryResult.entities[0] as T;
		} catch (err) {
			if (BaseError.isErrorCode(err, "ResourceNotFoundException")) {
				throw new GeneralError(
					DynamoDbEntityStorageConnector.CLASS_NAME,
					"tableDoesNotExist",
					{
						tableName: this._config.tableName
					},
					err
				);
			}
			throw new GeneralError(
				DynamoDbEntityStorageConnector.CLASS_NAME,
				"getFailed",
				{
					id
				},
				err
			);
		}
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The id of the entity.
	 */
	public async set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void> {
		Guards.object<T>(DynamoDbEntityStorageConnector.CLASS_NAME, nameof(entity), entity);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const prepared = EntityStorageHelper.prepareEntity(
			entity,
			this._entitySchema,
			partitionKey
				? [{ property: DynamoDbEntityStorageConnector._PARTITION_KEY, value: partitionKey }]
				: [
						{
							property: DynamoDbEntityStorageConnector._PARTITION_KEY,
							value: DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE
						}
					],
			{ nullBehavior: "omit" }
		);

		const id = (prepared as { [id: string]: unknown })[this._primaryKey.property as string];

		try {
			const docClient = this.createDocClient();

			const { conditionExpression, attributeNames, attributeValues } =
				this.buildConditionExpression(conditions);

			const putCommand = new PutCommand({
				TableName: this._config.tableName,
				Item: prepared as { [id: string]: unknown },
				// Only set the condition expression if we have conditions to match
				// and the primary key exists, otherwise we are creating a new object
				ConditionExpression: Is.stringValue(conditionExpression)
					? `(attribute_exists(${this._primaryKey.property as string}) AND ${conditionExpression}) OR attribute_not_exists(${this._primaryKey.property as string})`
					: undefined,
				ExpressionAttributeNames: attributeNames,
				ExpressionAttributeValues: attributeValues
			});

			await docClient.send(putCommand);
		} catch (err) {
			if (BaseError.isErrorName(err, "ConditionalCheckFailedException")) {
				return;
			}

			if (BaseError.isErrorCode(err, "ResourceNotFoundException")) {
				throw new GeneralError(
					DynamoDbEntityStorageConnector.CLASS_NAME,
					"tableDoesNotExist",
					{
						tableName: this._config.tableName
					},
					err
				);
			}

			throw new GeneralError(
				DynamoDbEntityStorageConnector.CLASS_NAME,
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
		Guards.arrayValue(DynamoDbEntityStorageConnector.CLASS_NAME, nameof(entities), entities);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const preparedEntities = entities.map(entity =>
			EntityStorageHelper.prepareEntity(
				entity,
				this._entitySchema,
				partitionKey
					? [{ property: DynamoDbEntityStorageConnector._PARTITION_KEY, value: partitionKey }]
					: [
							{
								property: DynamoDbEntityStorageConnector._PARTITION_KEY,
								value: DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE
							}
						],
				{ nullBehavior: "omit" }
			)
		);

		try {
			const docClient = this.createDocClient();
			const chunkSize = 25;

			for (let i = 0; i < preparedEntities.length; i += chunkSize) {
				const chunk = preparedEntities.slice(i, i + chunkSize);
				await docClient.send(
					new BatchWriteCommand({
						RequestItems: {
							[this._config.tableName]: chunk.map(entity => ({
								PutRequest: {
									Item: entity as { [id: string]: unknown }
								}
							}))
						}
					})
				);
			}
		} catch (err) {
			if (BaseError.isErrorCode(err, "ResourceNotFoundException")) {
				throw new GeneralError(
					DynamoDbEntityStorageConnector.CLASS_NAME,
					"tableDoesNotExist",
					{ tableName: this._config.tableName },
					err
				);
			}
			throw new GeneralError(
				DynamoDbEntityStorageConnector.CLASS_NAME,
				"setBatchFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Empty the entity storage.
	 * @returns Nothing.
	 */
	public async empty(): Promise<void> {
		try {
			const contextIds = await ContextIdStore.getContextIds();
			const partitionKey = ContextIdHelper.combinedContextKey(
				contextIds,
				this._partitionContextIds
			);

			const pKey = partitionKey ?? DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE;

			const docClient = this.createDocClient();
			const chunkSize = 25;

			let exclusiveStartKey: { [key: string]: NativeAttributeValue } | undefined;

			do {
				const scanResult = await docClient.send(
					new ScanCommand({
						TableName: this._config.tableName,
						FilterExpression: "#partitionId = :partitionId",
						ExpressionAttributeNames: {
							"#partitionId": DynamoDbEntityStorageConnector._PARTITION_KEY
						},
						ExpressionAttributeValues: {
							":partitionId": pKey
						},
						ExclusiveStartKey: exclusiveStartKey
					})
				);

				const items = scanResult.Items ?? [];

				for (let i = 0; i < items.length; i += chunkSize) {
					const chunk = items.slice(i, i + chunkSize);
					await docClient.send(
						new BatchWriteCommand({
							RequestItems: {
								[this._config.tableName]: chunk.map(
									(item: { [key: string]: NativeAttributeValue }) => ({
										DeleteRequest: {
											Key: {
												[DynamoDbEntityStorageConnector._PARTITION_KEY]:
													item[DynamoDbEntityStorageConnector._PARTITION_KEY],
												[this._primaryKey.property as string]:
													item[this._primaryKey.property as string]
											}
										}
									})
								)
							}
						})
					);
				}

				exclusiveStartKey = scanResult.LastEvaluatedKey;
			} while (exclusiveStartKey);
		} catch (err) {
			throw new GeneralError(
				DynamoDbEntityStorageConnector.CLASS_NAME,
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
		Guards.stringValue(DynamoDbEntityStorageConnector.CLASS_NAME, nameof(id), id);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const docClient = this.createDocClient();

			const { conditionExpression, attributeNames, attributeValues } =
				this.buildConditionExpression(conditions);

			const deleteCommand = new DeleteCommand({
				TableName: this._config.tableName,
				Key: {
					[DynamoDbEntityStorageConnector._PARTITION_KEY]:
						partitionKey ?? DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE,
					[this._primaryKey.property as string]: id
				},
				ConditionExpression: conditionExpression,
				ExpressionAttributeNames: attributeNames,
				ExpressionAttributeValues: attributeValues
			});

			await docClient.send(deleteCommand);
		} catch (err) {
			if (BaseError.isErrorName(err, "ConditionalCheckFailedException")) {
				return;
			}
			if (BaseError.isErrorCode(err, "ResourceNotFoundException")) {
				throw new GeneralError(
					DynamoDbEntityStorageConnector.CLASS_NAME,
					"tableDoesNotExist",
					{
						tableName: this._config.tableName
					},
					err
				);
			}

			throw new GeneralError(
				DynamoDbEntityStorageConnector.CLASS_NAME,
				"removeFailed",
				{
					id
				},
				err
			);
		}
	}

	/**
	 * Remove multiple entities by their IDs in a batch.
	 * @param ids The ids of the entities to remove.
	 * @returns Nothing.
	 */
	public async removeBatch(ids: string[]): Promise<void> {
		Guards.arrayValue(DynamoDbEntityStorageConnector.CLASS_NAME, nameof(ids), ids);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const docClient = this.createDocClient();
			const chunkSize = 25;
			const primaryKeyProperty = this._primaryKey.property as string;

			for (let i = 0; i < ids.length; i += chunkSize) {
				const chunk = ids.slice(i, i + chunkSize);
				await docClient.send(
					new BatchWriteCommand({
						RequestItems: {
							[this._config.tableName]: chunk.map(id => ({
								DeleteRequest: {
									Key: {
										[primaryKeyProperty]: id,
										[DynamoDbEntityStorageConnector._PARTITION_KEY]:
											partitionKey ?? DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE
									}
								}
							}))
						}
					})
				);
			}
		} catch (err) {
			throw new GeneralError(
				DynamoDbEntityStorageConnector.CLASS_NAME,
				"removeBatchFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Teardown the entity storage by deleting the underlying table.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the teardown process was successful.
	 */
	public async teardown(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		await nodeLogging?.log({
			level: "info",
			source: DynamoDbEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "tableDeleting",
			data: { tableName: this._config.tableName }
		});

		try {
			const dbConnection = this.createConnection();

			await dbConnection.deleteTable({ TableName: this._config.tableName });

			await waitUntilTableNotExists(
				{ client: dbConnection, maxWaitTime: 60 },
				{ TableName: this._config.tableName }
			);

			await nodeLogging?.log({
				level: "info",
				source: DynamoDbEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "tableDeleted",
				data: { tableName: this._config.tableName }
			});

			return true;
		} catch (err) {
			await nodeLogging?.log({
				level: "error",
				source: DynamoDbEntityStorageConnector.CLASS_NAME,
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
		sortProperties?: {
			property: keyof T;
			sortDirection: SortDirection;
		}[],
		properties?: (keyof T)[],
		cursor?: string,
		limit?: number
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
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		return this.internalQuery(
			conditions,
			sortProperties,
			properties,
			cursor,
			limit,
			undefined,
			partitionKey
		);
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

			const attributeNames: { [id: string]: string } = {
				"#partitionId": DynamoDbEntityStorageConnector._PARTITION_KEY
			};
			const attributeValues: { [id: string]: AttributeValue } = {
				":partitionId": {
					S: partitionKey ?? DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE
				}
			};

			const expressions = this.buildQueryParameters(
				"",
				conditions,
				attributeNames,
				attributeValues
			);

			const dbConnection = this.createConnection();
			let total = 0;
			let exclusiveStartKey: { [key: string]: AttributeValue } | undefined;

			do {
				const result = await dbConnection.send(
					new QueryCommand({
						TableName: this._config.tableName,
						Select: "COUNT",
						KeyConditionExpression: "#partitionId = :partitionId",
						FilterExpression: Is.stringValue(expressions.filterCondition)
							? expressions.filterCondition
							: undefined,
						ExpressionAttributeNames: attributeNames,
						ExpressionAttributeValues: attributeValues,
						ExclusiveStartKey: exclusiveStartKey
					})
				);
				total += result.Count ?? 0;
				exclusiveStartKey = result.LastEvaluatedKey;
			} while (exclusiveStartKey);

			return total;
		} catch (err) {
			throw new GeneralError(
				DynamoDbEntityStorageConnector.CLASS_NAME,
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
		if (!Is.arrayValue(this._partitionContextIds)) {
			return [];
		}

		const contextIdsMap: { [id: string]: IContextIds } = {};

		try {
			const docClient = this.createDocClient();
			let exclusiveStartKey: { [key: string]: NativeAttributeValue } | undefined;

			do {
				const scanResult = await docClient.send(
					new ScanCommand({
						TableName: this._config.tableName,
						ProjectionExpression: "#partitionId",
						ExpressionAttributeNames: {
							"#partitionId": DynamoDbEntityStorageConnector._PARTITION_KEY
						},
						ExclusiveStartKey: exclusiveStartKey
					})
				);

				for (const item of scanResult.Items ?? []) {
					const partitionId = item[DynamoDbEntityStorageConnector._PARTITION_KEY] as string;
					if (Is.stringValue(partitionId) && !(partitionId in contextIdsMap)) {
						contextIdsMap[partitionId] = ContextIdHelper.shortSplit(
							this._partitionContextIds ?? [],
							partitionId
						);
					}
				}

				exclusiveStartKey = scanResult.LastEvaluatedKey;
			} while (exclusiveStartKey);
		} catch (err) {
			throw new GeneralError(
				DynamoDbEntityStorageConnector.CLASS_NAME,
				"getPartitionContextIdsFailed",
				undefined,
				err
			);
		}

		return Object.values(contextIdsMap);
	}

	/**
	 * Create the target connector for performing the migration it will use a temporary storage location.
	 * @param newEntitySchema The name of the new entity schema to create the connector for.
	 * @returns Connector for performing the migration.
	 */
	public async createTargetConnector<U>(
		newEntitySchema: string
	): Promise<IEntityStorageConnector<U>> {
		// We create a new table for the migration with a unique name to avoid conflicts with the existing table
		// This table will be swapped with the existing table once the migration is finalized.
		const migrationTableName = `${this._config.tableName}Migration${Date.now()}`;
		return new DynamoDbEntityStorageConnector<U>({
			entitySchema: newEntitySchema,
			config: {
				...this._config,
				tableName: migrationTableName
			},
			partitionContextIds: this._partitionContextIds
		});
	}

	/**
	 * Finalize the migration by tearing down the old connector and replacing it with the new one.
	 * @param targetConnector The target connector to finalize the migration with.
	 * @param options The options to control how the migration is finalized.
	 * @param loggingComponentType The logging component type to use for logging during the migration finalization.
	 * @returns A promise that resolves when the migration is finalized.
	 */
	public async finalizeMigration<U>(
		targetConnector: DynamoDbEntityStorageConnector<U>,
		options?: IMigrationOptions<T, U>,
		loggingComponentType?: string
	): Promise<DynamoDbEntityStorageConnector<U>> {
		// There is no rename operation in DynamoDB so we have to create a new table with the original name and copy the data over

		// Teardown the existing table with the original name to free up the name for the new table
		await this.teardown(loggingComponentType);

		// Create a new connector with the original table name but with the new schema
		// and copy the data from the migration table to the new table using batch operations
		const finalConnector = new DynamoDbEntityStorageConnector<U>({
			entitySchema: targetConnector._entitySchemaName,
			config: this._config,
			partitionContextIds: this._partitionContextIds
		});

		if (await finalConnector.bootstrap(loggingComponentType)) {
			// Since there is no rename, we need to copy the data from the migration table to the new table
			const partitions = await targetConnector.getPartitionContextIds();
			const batchSize = options?.batchSize ?? DynamoDbEntityStorageConnector._DEFAULT_LIMIT;
			await this.bulkCopy(targetConnector, finalConnector, partitions, batchSize);

			await targetConnector.teardown(loggingComponentType);

			return finalConnector;
		}

		throw new GeneralError(
			DynamoDbEntityStorageConnector.CLASS_NAME,
			"finalizeMigrationFailedBootstrap",
			undefined
		);
	}

	/**
	 * Cleanup the migration if a migration fails or needs to be aborted.
	 * @param targetConnector The target connector to cleanup the migration with.
	 * @param options The options to control how the migration is cleaned up.
	 * @param loggingComponentType The optional component type to use for logging the migration progress.
	 * @returns A promise that resolves when the migration is cleaned up.
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
		sourceConnector: DynamoDbEntityStorageConnector<U>,
		destConnector: DynamoDbEntityStorageConnector<U>,
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

		const dbConnection = sourceConnector.createConnection();
		const chunkSize = 25;

		for (let i = 0; i < partitionList.length; i++) {
			const partitionKey =
				ContextIdHelper.combinedContextKey(
					partitionList[i],
					sourceConnector._partitionContextIds
				) ?? DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE;

			let exclusiveStartKey: { [key: string]: AttributeValue } | undefined;
			do {
				const { Items: items, LastEvaluatedKey: lastKey } = await dbConnection.send(
					new QueryCommand({
						TableName: sourceConnector._config.tableName,
						KeyConditionExpression: `#${DynamoDbEntityStorageConnector._PARTITION_KEY} = :${DynamoDbEntityStorageConnector._PARTITION_KEY}`,
						ExpressionAttributeNames: {
							[`#${DynamoDbEntityStorageConnector._PARTITION_KEY}`]:
								DynamoDbEntityStorageConnector._PARTITION_KEY
						},
						ExpressionAttributeValues: {
							[`:${DynamoDbEntityStorageConnector._PARTITION_KEY}`]: { S: partitionKey }
						},
						Limit: batchSize,
						ExclusiveStartKey: exclusiveStartKey
					})
				);

				exclusiveStartKey = lastKey;

				if (Is.arrayValue(items)) {
					for (let j = 0; j < items.length; j += chunkSize) {
						const chunk = items.slice(j, j + chunkSize) as { [key: string]: AttributeValue }[];
						await dbConnection.send(
							new BatchWriteItemCommand({
								RequestItems: {
									[destConnector._config.tableName]: chunk.map(item => ({
										PutRequest: { Item: item }
									}))
								}
							})
						);
					}
				}
			} while (exclusiveStartKey);
		}
	}

	/**
	 * Create the parameters for a query.
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
		attributeValues: { [id: string]: AttributeValue },
		secondaryIndex?: string
	): {
		keyCondition: string;
		filterCondition: string;
		requiresScan: boolean;
	} {
		// If no conditions are defined then return empty string
		if (Is.undefined(condition)) {
			return {
				keyCondition: "",
				filterCondition: "",
				requiresScan: false
			};
		}

		if ("conditions" in condition) {
			if (condition.conditions.length === 0) {
				return {
					keyCondition: "",
					filterCondition: "",
					requiresScan: false
				};
			}
			// It's a group of comparisons, so check the individual items and combine with the logical operator
			const joinConditions: {
				keyCondition: string;
				filterCondition: string;
				requiresScan: boolean;
			}[] = condition.conditions.map(c =>
				this.buildQueryParameters(objectPath, c, attributeNames, attributeValues, secondaryIndex)
			);

			const logicalOperator = this.mapConditionalOperator(condition.logicalOperator);

			// DynamoDB does not support OR in KeyConditionExpression, so when the operator
			// is OR we must move all conditions (including key conditions) into FilterExpression.
			if (condition.logicalOperator === LogicalOperator.Or) {
				const parts = joinConditions
					.map(j => {
						const subParts = [j.keyCondition.trim(), j.filterCondition.trim()].filter(
							s => s.length > 0
						);
						if (subParts.length === 0) {
							return "";
						}
						if (subParts.length === 1) {
							return subParts[0];
						}
						return `(${subParts.join(" AND ")})`;
					})
					.filter(s => s.length > 0);
				const hasKeyConditions = joinConditions.some(j => j.keyCondition.length > 0);
				const filterCondition = parts.join(" OR ");
				return {
					keyCondition: "",
					filterCondition: Is.stringValue(filterCondition) ? ` (${filterCondition}) ` : "",
					requiresScan: hasKeyConditions
				};
			}

			const keyCondition = joinConditions
				.filter(j => j.keyCondition.length > 0)
				.map(j => j.keyCondition)
				.join(` ${logicalOperator} `);
			const filterCondition = joinConditions
				.filter(j => j.filterCondition.length > 0)
				.map(j => j.filterCondition)
				.join(` ${logicalOperator} `);

			return {
				keyCondition: Is.stringValue(keyCondition) ? ` (${keyCondition}) ` : "",
				filterCondition: Is.stringValue(filterCondition) ? ` (${filterCondition}) ` : "",
				requiresScan: joinConditions.some(j => j.requiresScan)
			};
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

		const isKey =
			schemaProp?.isPrimary ?? (schemaProp?.isSecondary && schemaProp?.property === secondaryIndex);
		return {
			keyCondition: isKey ? comparison : "",
			filterCondition: !isKey ? comparison : "",
			requiresScan: false
		};
	}

	/**
	 * Map the framework comparison operators to those in DynamoDB.
	 * @param objectPath The prefix to use for the condition.
	 * @param comparator The operator to map.
	 * @param type The type of the property.
	 * @param attributeNames The attribute names to use in the query.
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
		attributeValues: { [id: string]: AttributeValue }
	): string {
		let prop = objectPath;
		if (prop.length > 0) {
			prop += ".";
		}
		prop += comparator.property;

		let attributeName = this.populateAttributeNames(prop, attributeNames);

		if (Is.empty(comparator.value)) {
			// With "omit" storage, optional null/undefined fields are absent from the item entirely.
			// attribute_not_exists matches absent attributes; attribute_exists matches present ones.
			if (comparator.comparison === ComparisonOperator.Equals) {
				return `attribute_not_exists(${attributeName})`;
			} else if (comparator.comparison === ComparisonOperator.NotEquals) {
				return `attribute_exists(${attributeName})`;
			}
		}

		const basePropName = `:${attributeName.replace(/\./g, "").replace(/#/g, "")}`;
		let propName = basePropName;
		let propSuffix = 0;
		while (!Is.undefined(attributeValues[propName])) {
			propSuffix++;
			propName = `${basePropName}${propSuffix}`;
		}

		if (Is.array(comparator.value)) {
			const dbValues = comparator.value.map(v => this.propertyToDbValue(v, type));
			const arrAttributeNames = [];
			for (let i = 0; i < dbValues.length; i++) {
				const arrAttributeName = `${propName}${i}`;
				attributeValues[arrAttributeName] = dbValues[i];
				arrAttributeNames.push(arrAttributeName);
			}
			propName = attributeName;
			attributeName = `(${arrAttributeNames.join(", ")})`;
		} else {
			attributeValues[propName] = this.propertyToDbValue(comparator.value, type);
		}

		if (comparator.comparison === ComparisonOperator.Equals) {
			return `${attributeName} = ${propName}`;
		} else if (comparator.comparison === ComparisonOperator.NotEquals) {
			return `${attributeName} <> ${propName}`;
		} else if (comparator.comparison === ComparisonOperator.GreaterThan) {
			return `${attributeName} > ${propName}`;
		} else if (comparator.comparison === ComparisonOperator.LessThan) {
			return `${attributeName} < ${propName}`;
		} else if (comparator.comparison === ComparisonOperator.GreaterThanOrEqual) {
			return `${attributeName} >= ${propName}`;
		} else if (comparator.comparison === ComparisonOperator.LessThanOrEqual) {
			return `${attributeName} <= ${propName}`;
		} else if (comparator.comparison === ComparisonOperator.Includes) {
			return `contains(${attributeName}, ${propName})`;
		} else if (comparator.comparison === ComparisonOperator.NotIncludes) {
			return `NOT contains(${attributeName}, ${propName})`;
		} else if (comparator.comparison === ComparisonOperator.In) {
			return `${propName} IN ${attributeName}`;
		}

		throw new GeneralError(DynamoDbEntityStorageConnector.CLASS_NAME, "comparisonNotSupported", {
			comparison: comparator.comparison
		});
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
			const hashPart = `#${part}`;
			if (Is.empty(attributeNames[hashPart])) {
				attributeNames[hashPart] = part;
			}
			attributeNameParts.push(hashPart);
		}

		return attributeNameParts.join(".");
	}

	/**
	 * Map the framework conditional operators to those in DynamoDB.
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

		throw new GeneralError(DynamoDbEntityStorageConnector.CLASS_NAME, "conditionalNotSupported", {
			operator
		});
	}

	/**
	 * Format a value to insert into DB.
	 * @param value The value to format.
	 * @param type The type for the property.
	 * @returns The value after conversion.
	 * @internal
	 */
	private propertyToDbValue(value: unknown, type?: EntitySchemaPropertyType): AttributeValue {
		if (Is.object(value)) {
			const map: { [id: string]: AttributeValue } = {};
			for (const key in value) {
				map[key] = this.propertyToDbValue(value[key]);
			}
			return {
				M: map
			};
		}

		if (type === "integer" || type === "number") {
			return { N: Coerce.string(value) ?? "" };
		} else if (type === "boolean") {
			return { BOOL: Coerce.boolean(value) ?? false };
		}

		return { S: Coerce.string(value) ?? "" };
	}

	/**
	 * Create a doc client connection.
	 * @returns The dynamo db document client.
	 * @internal
	 */
	private createDocClient(): DynamoDBDocumentClient {
		return DynamoDBDocumentClient.from(
			new DynamoDB({
				apiVersion: "2012-10-08",
				...this.createConnectionConfig()
			}),
			{
				marshallOptions: {
					removeUndefinedValues: true
				}
			}
		);
	}

	/**
	 * Create a new DB connection.
	 * @returns The Dynamo DB connection.
	 * @internal
	 */
	private createConnection(): DynamoDB {
		return new DynamoDB(this.createConnectionConfig());
	}

	/**
	 * Create a new DB connection configuration.
	 * @returns The Dynamo DB connection configuration.
	 * @internal
	 */
	private createConnectionConfig(): DynamoDBClientConfig {
		const requestHandler = Is.number(this._config.connectionTimeoutMs)
			? { requestTimeout: this._config.connectionTimeoutMs }
			: undefined;

		if (
			Is.stringValue(this._config.secretAccessKey) &&
			Is.stringValue(this._config.accessKeyId) &&
			this._config.authMode === "credentials"
		) {
			return {
				credentials: {
					accessKeyId: this._config.accessKeyId,
					secretAccessKey: this._config.secretAccessKey
				},
				endpoint: this._config.endpoint,
				region: this._config.region,
				requestHandler,
				maxAttempts: this._config.maxAttempts
			};
		}

		return {
			endpoint: this._config.endpoint,
			region: this._config.region,
			requestHandler,
			maxAttempts: this._config.maxAttempts
		};
	}

	/**
	 * Check if the table exists.
	 * @param tableName The table to check.
	 * @returns True if the table exists.
	 * @internal
	 */
	private async tableExists(tableName: string): Promise<boolean> {
		try {
			const dbConnection = this.createConnection();

			const result = await dbConnection.describeTable({ TableName: tableName });

			// A table in DELETING state should not be treated as existing
			return result.Table?.TableStatus !== "DELETING";
		} catch {
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
	 * @param secondaryIndex The secondary index to use for the query.
	 * @param partitionKey The partition key to use for the query.
	 * @returns All the entities for the storage matching the conditions,
	 * and a cursor which can be used to request more entities.
	 * @internal
	 */
	private async internalQuery(
		conditions?: EntityCondition<T>,
		sortProperties?: {
			property: keyof T;
			sortDirection: SortDirection;
		}[],
		properties?: (keyof T)[],
		cursor?: string,
		limit?: number,
		secondaryIndex?: string,
		partitionKey?: string
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
		try {
			const returnSize = limit ?? DynamoDbEntityStorageConnector._DEFAULT_LIMIT;

			let indexName: string | undefined = Is.stringValue(secondaryIndex)
				? `${secondaryIndex}Index`
				: undefined;

			// If we have a sortable property defined in the descriptor then we must use
			// the secondary index for the query
			let scanAscending = true;
			if (Is.arrayValue(sortProperties)) {
				if (sortProperties.length > 1) {
					throw new GeneralError(DynamoDbEntityStorageConnector.CLASS_NAME, "sortSingle");
				}

				for (const sortProperty of sortProperties) {
					const propertySchema = this._entitySchema.properties?.find(
						e => e.property === sortProperty.property
					);
					if (
						Is.undefined(propertySchema) ||
						(!propertySchema.isPrimary &&
							!propertySchema.isSecondary &&
							Is.empty(propertySchema.sortDirection))
					) {
						throw new GeneralError(DynamoDbEntityStorageConnector.CLASS_NAME, "sortNotIndexed", {
							property: sortProperty.property
						});
					}

					indexName = propertySchema.isPrimary
						? undefined
						: `${sortProperty.property as string}Index`;
					scanAscending = sortProperty.sortDirection === SortDirection.Ascending;
				}
			}

			const attributeNames: { [id: string]: string } = { "#partitionId": "partitionId" };
			const attributeValues: { [id: string]: AttributeValue } = {
				[`:${DynamoDbEntityStorageConnector._PARTITION_KEY}`]: {
					S: partitionKey ?? DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE
				}
			};

			const expressions = this.buildQueryParameters(
				"",
				conditions,
				attributeNames,
				attributeValues,
				secondaryIndex
			);

			// OR conditions on primary key attributes can't use KeyConditionExpression or
			// FilterExpression in a QueryCommand — fall back to a full table ScanCommand.
			if (expressions.requiresScan) {
				let scanFilter = "#partitionId = :partitionId";
				if (Is.stringValue(expressions.filterCondition)) {
					scanFilter += ` AND ${expressions.filterCondition.trim()}`;
				}

				const dbConnection = this.createConnection();
				const matchingItems: { [id: string]: AttributeValue }[] = [];
				let scanStartKey: { [id: string]: AttributeValue } | undefined = Is.empty(cursor)
					? undefined
					: ObjectHelper.fromBytes(Converter.base64ToBytes(cursor));

				do {
					const scanResult = await dbConnection.send(
						new RawScanCommand({
							TableName: this._config.tableName,
							FilterExpression: scanFilter,
							ExpressionAttributeNames: attributeNames,
							ExpressionAttributeValues: attributeValues,
							ProjectionExpression: properties?.map(p => p as string).join(", "),
							ExclusiveStartKey: scanStartKey
						})
					);
					matchingItems.push(...(scanResult.Items ?? []));
					scanStartKey = scanResult.LastEvaluatedKey;
				} while (!Is.empty(scanStartKey));

				const hasMore = matchingItems.length > returnSize;
				const returnedRawItems = hasMore ? matchingItems.slice(0, returnSize) : matchingItems;

				let resultCursor: string | undefined;
				if (hasMore) {
					const lastRawItem = returnedRawItems[returnedRawItems.length - 1];
					const syntheticKey: { [id: string]: AttributeValue } = {
						[DynamoDbEntityStorageConnector._PARTITION_KEY]:
							lastRawItem[DynamoDbEntityStorageConnector._PARTITION_KEY],
						[this._primaryKey.property as string]: lastRawItem[this._primaryKey.property as string]
					};
					resultCursor = Converter.bytesToBase64(ObjectHelper.toBytes(syntheticKey));
				}

				const scanEntities: T[] = returnedRawItems.map(item => {
					const unmarshalled = unmarshall(item);
					return EntityStorageHelper.unPrepareEntity(unmarshalled as T, [
						DynamoDbEntityStorageConnector._PARTITION_KEY
					]);
				});

				return { entities: scanEntities, cursor: resultCursor };
			}

			let keyExpression = "#partitionId = :partitionId";
			if (expressions.keyCondition.length > 0) {
				keyExpression += ` AND ${expressions.keyCondition}`;
			}

			const query = new QueryCommand({
				TableName: this._config.tableName,
				IndexName: indexName,
				KeyConditionExpression: keyExpression,
				FilterExpression: Is.stringValue(expressions.filterCondition)
					? expressions.filterCondition
					: undefined,
				ExpressionAttributeNames: attributeNames,
				ExpressionAttributeValues: attributeValues,
				ProjectionExpression: properties?.map(p => p as string).join(", "),
				Limit: returnSize + 1,
				ScanIndexForward: scanAscending,
				ExclusiveStartKey: Is.empty(cursor)
					? undefined
					: ObjectHelper.fromBytes(Converter.base64ToBytes(cursor))
			});

			const connection = this.createDocClient();

			const results = await connection.send(query);

			const rawItems = results.Items ?? [];
			const hasMore = rawItems.length > returnSize;
			const returnedRawItems = hasMore ? rawItems.slice(0, returnSize) : rawItems;

			let resultCursor: string | undefined;
			if (hasMore) {
				const lastRawItem = returnedRawItems[returnedRawItems.length - 1] as {
					[id: string]: AttributeValue;
				};
				const syntheticKey: { [id: string]: AttributeValue } = {
					[DynamoDbEntityStorageConnector._PARTITION_KEY]:
						lastRawItem[DynamoDbEntityStorageConnector._PARTITION_KEY],
					[this._primaryKey.property as string]: lastRawItem[this._primaryKey.property as string]
				};
				if (Is.stringValue(secondaryIndex)) {
					syntheticKey[secondaryIndex] = lastRawItem[secondaryIndex];
				}
				resultCursor = Converter.bytesToBase64(ObjectHelper.toBytes(syntheticKey));
			}

			const entities: T[] = returnedRawItems.map(item => {
				const unmarshalled = unmarshall(item);
				return EntityStorageHelper.unPrepareEntity(unmarshalled as T, [
					DynamoDbEntityStorageConnector._PARTITION_KEY
				]);
			});

			return { entities, cursor: resultCursor };
		} catch (err) {
			if (BaseError.isErrorCode(err, "ResourceNotFoundException")) {
				throw new GeneralError(
					DynamoDbEntityStorageConnector.CLASS_NAME,
					"tableDoesNotExist",
					{
						tableName: this._config.tableName
					},
					err
				);
			}
			throw new GeneralError(
				DynamoDbEntityStorageConnector.CLASS_NAME,
				"queryFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Build the condition expression for the query.
	 * @param conditions The conditions to build the expression from.
	 * @returns The condition expression.
	 * @throws GeneralError if the property is not found in the schema.
	 * @internal
	 */
	private buildConditionExpression(conditions?: { property: keyof T; value: unknown }[]): {
		conditionExpression: string | undefined;
		attributeNames: { [id: string]: string } | undefined;
		attributeValues: { [key: string]: NativeAttributeValue } | undefined;
	} {
		let conditionExpression: string | undefined;
		let attributeNames: { [id: string]: string } | undefined;
		let attributeValues: { [key: string]: NativeAttributeValue } | undefined;

		if (Is.arrayValue(conditions)) {
			const expressions: string[] = [];

			for (const c of conditions) {
				const schemaProp = this._entitySchema.properties?.find(p => p.property === c.property);

				if (Is.undefined(schemaProp)) {
					throw new GeneralError(DynamoDbEntityStorageConnector.CLASS_NAME, "propertyNotFound", {
						property: c.property
					});
				}

				const attributeName = `#${c.property as string}`;
				const attributeValueName = `:${c.property as string}`;
				attributeNames ??= {};
				attributeValues ??= {};
				attributeNames[attributeName] = c.property as string;
				attributeValues[attributeValueName] = c.value;
				expressions.push(`${attributeName} = ${attributeValueName}`);
			}

			conditionExpression = expressions.join(" AND ");
		}
		return { conditionExpression, attributeNames, attributeValues };
	}
}
