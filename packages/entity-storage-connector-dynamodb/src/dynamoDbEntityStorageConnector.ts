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
	type IValidationFailure,
	ObjectHelper,
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
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

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
			} else {
				finalConditions.conditions.push({
					property: this._primaryKey.property as string,
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
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

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
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

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

		if (!Is.empty(limit)) {
			const validationFailures: IValidationFailure[] = [];
			Validation.integer(nameof(limit), limit, validationFailures, undefined, { minValue: 1 });
			Validation.asValidationError(
				DynamoDbEntityStorageConnector.CLASS_NAME,
				"query",
				validationFailures
			);
		}

		EntityStorageHelper.validateSortProperties(this._entitySchema, sortProperties);
		EntityStorageHelper.validateProperties(this._entitySchema, properties);
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);

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
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);

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

			if (expressions.noResults) {
				return 0;
			}

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
	public async getPartitionContextIds(): Promise<IContextIds[] | undefined> {
		if (!Is.arrayValue(this._partitionContextIds)) {
			return undefined;
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
		options?: IMigrationOptions,
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
		sourceConnector: DynamoDbEntityStorageConnector<U>,
		destConnector: DynamoDbEntityStorageConnector<U>,
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

		const dbConnection = sourceConnector.createConnection();
		const chunkSize = 25;

		for (let i = 0; i < partitionList.length; i++) {
			// Values from getPartitionContextIds are already short-form, so we join them
			// directly rather than using combinedContextKey, which expects long-form input
			// and calls guardAll (throwing if a registered handler rejects short-form values).
			const partitionKey = Is.arrayValue(sourceConnector._partitionContextIds)
				? sourceConnector._partitionContextIds.map(k => partitionList[i][k]).join("/")
				: DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE;

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
	 * @param secondaryIndex The optional secondary index to use for the query.
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
		noResults?: boolean;
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
			// Snapshot before the entire group. Used by the AND path to undo
			// surviving siblings' attribute registrations when the AND is dead (#141).
			const preGroupNames = new Set(Object.keys(attributeNames));
			const preGroupValues = new Set(Object.keys(attributeValues));

			// It's a group of comparisons, so check the individual items and combine with the logical operator
			const joinConditions: {
				keyCondition: string;
				filterCondition: string;
				requiresScan: boolean;
				noResults?: boolean;
			}[] = condition.conditions.map(c => {
				// Snapshot before each branch. When a branch is dead (noResults),
				// undo its attribute registrations so the final expressions stay
				// consistent — DynamoDB rejects unused ExpressionAttributeNames (#141).
				const preBranchNames = new Set(Object.keys(attributeNames));
				const preBranchValues = new Set(Object.keys(attributeValues));
				const result = this.buildQueryParameters(
					objectPath,
					c,
					attributeNames,
					attributeValues,
					secondaryIndex
				);
				if (result.noResults) {
					for (const key of Object.keys(attributeNames)) {
						if (!preBranchNames.has(key)) {
							delete attributeNames[key];
						}
					}
					for (const key of Object.keys(attributeValues)) {
						if (!preBranchValues.has(key)) {
							delete attributeValues[key];
						}
					}
				}
				return result;
			});

			const logicalOperator = this.mapConditionalOperator(condition.logicalOperator);

			// DynamoDB does not support OR in KeyConditionExpression, so when the operator
			// is OR we must move all conditions (including key conditions) into FilterExpression.
			if (condition.logicalOperator === LogicalOperator.Or) {
				// OR: only empty if ALL branches are guaranteed empty (e.g. all empty IN lists).
				// If only some are empty they are naturally filtered out of `parts` below,
				// which is correct — false OR x = x (#141).
				if (joinConditions.every(j => j.noResults)) {
					return { keyCondition: "", filterCondition: "", requiresScan: false, noResults: true };
				}

				const parts = joinConditions
					.map(j => {
						// A branch marked noResults (e.g. a dead AND group containing In [])
						// must contribute nothing to the OR — false OR x = x (#141).
						if (j.noResults) {
							return "";
						}
						const subParts = [j.keyCondition.trim(), j.filterCondition.trim()].filter(
							s => s.length > 0
						);
						if (subParts.length === 0) {
							return "";
						}
						return subParts.length === 1 ? ` ${subParts[0]} ` : ` (${subParts.join(" AND ")}) `;
					})
					.filter(s => s.length > 0);
				const hasKeyConditions = joinConditions.some(j => j.keyCondition.length > 0);
				const filterCondition = parts.join(" OR ");
				return {
					keyCondition: "",
					filterCondition: this.wrapConditionExpression(filterCondition, parts.length),
					requiresScan: hasKeyConditions
				};
			}

			const keyParts = joinConditions.filter(j => j.keyCondition.length > 0);
			const filterParts = joinConditions.filter(j => j.filterCondition.length > 0);
			const keyCondition = keyParts.map(j => j.keyCondition.trim()).join(` ${logicalOperator} `);
			const filterCondition = filterParts
				.map(j => j.filterCondition.trim())
				.join(` ${logicalOperator} `);

			// AND: if any sub-condition is a guaranteed empty result (e.g. empty IN list),
			// the whole AND group is also empty (#141). Restore the attribute maps to the
			// pre-group snapshot so surviving siblings' registrations are also undone —
			// per-branch cleanup above only undoes dead branches, not live ones whose AND
			// partner was dead.
			const noResults = joinConditions.some(j => j.noResults);
			if (noResults) {
				for (const key of Object.keys(attributeNames)) {
					if (!preGroupNames.has(key)) {
						delete attributeNames[key];
					}
				}
				for (const key of Object.keys(attributeValues)) {
					if (!preGroupValues.has(key)) {
						delete attributeValues[key];
					}
				}
				return { keyCondition: "", filterCondition: "", requiresScan: false, noResults: true };
			}

			return {
				keyCondition: this.wrapConditionExpression(keyCondition, keyParts.length),
				filterCondition: this.wrapConditionExpression(filterCondition, filterParts.length),
				requiresScan: joinConditions.some(j => j.requiresScan)
			};
		}

		const schemaProp = this._entitySchema.properties?.find(p => p.property === condition.property);

		// Empty IN list: DynamoDB has no `IN ()` syntax — short-circuit to empty result (#141).
		if (
			"comparison" in condition &&
			condition.comparison === ComparisonOperator.In &&
			Is.array(condition.value) &&
			condition.value.length === 0
		) {
			return { keyCondition: "", filterCondition: "", requiresScan: false, noResults: true };
		}

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
	 * Wrap a condition expression in parentheses only when multiple parts were joined.
	 * A single already-parenthesised child must not be double-wrapped.
	 * @param expr The joined condition expression.
	 * @param partCount The number of parts that were joined to produce expr.
	 * @returns The expression with surrounding spaces, wrapped only when partCount is greater than one.
	 * @internal
	 */
	private wrapConditionExpression(expr: string, partCount: number): string {
		if (!Is.stringValue(expr)) {
			return "";
		}
		return partCount > 1 ? ` (${expr}) ` : ` ${expr} `;
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

		if (Is.boolean(value)) {
			return { BOOL: value };
		} else if (Is.number(value)) {
			return { N: value.toString() };
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
		entities: Partial<T>[];
		cursor?: string;
	}> {
		try {
			const returnSize = limit ?? DynamoDbEntityStorageConnector._DEFAULT_LIMIT;
			const indexConfig = this.resolveQueryIndexConfig(sortProperties, secondaryIndex);
			const { attributeNames, attributeValues } = this.buildQueryAttributeMaps(partitionKey);
			const safeCursor = this.sanitizeCursorForPartition(cursor, attributeValues);

			const expressions = this.buildQueryParameters(
				"",
				conditions,
				attributeNames,
				attributeValues,
				indexConfig.gsiAttribute
			);

			if (expressions.noResults) {
				return { entities: [], cursor: undefined };
			}

			if (expressions.requiresScan) {
				const scanResult = await this.executeScanFallback(
					expressions.filterCondition,
					properties,
					attributeNames,
					attributeValues,
					safeCursor,
					returnSize
				);

				return {
					entities: this.mapRawItemsToEntities(scanResult.rawItems),
					cursor: scanResult.cursor
				};
			}

			const keyExpression = this.buildKeyExpression(expressions.keyCondition);
			const queryProjection = this.buildProjectionExpression(properties, attributeNames);

			const queryResult = Is.stringValue(expressions.filterCondition)
				? await this.executeFilteredQuery(
						keyExpression,
						expressions.filterCondition,
						attributeNames,
						attributeValues,
						queryProjection,
						indexConfig.indexName,
						indexConfig.scanAscending,
						safeCursor,
						returnSize
					)
				: await this.executeUnfilteredQuery(
						keyExpression,
						attributeNames,
						attributeValues,
						queryProjection,
						indexConfig.indexName,
						indexConfig.scanAscending,
						safeCursor,
						returnSize
					);

			return {
				entities: this.mapRawItemsToEntities(queryResult.rawItems),
				cursor: queryResult.cursor
			};
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
	 * Resolve index configuration from sort options and optional explicit secondary index.
	 * @param sortProperties The optional sort order.
	 * @param secondaryIndex The optional explicit secondary index.
	 * @returns The resolved index name, GSI attribute and sort direction.
	 * @throws GeneralError if more than one sort property is specified.
	 * @internal
	 */
	private resolveQueryIndexConfig(
		sortProperties?: {
			property: keyof T;
			sortDirection: SortDirection;
		}[],
		secondaryIndex?: string
	): {
		indexName?: string;
		gsiAttribute?: string;
		scanAscending: boolean;
	} {
		let indexName: string | undefined = Is.stringValue(secondaryIndex)
			? `${secondaryIndex}Index`
			: undefined;
		let gsiAttribute: string | undefined = secondaryIndex;
		let scanAscending = true;

		if (Is.arrayValue(sortProperties)) {
			if (sortProperties.length > 1) {
				throw new GeneralError(DynamoDbEntityStorageConnector.CLASS_NAME, "sortSingle");
			}

			for (const sortProperty of sortProperties) {
				const propertySchema = this._entitySchema.properties?.find(
					e => e.property === sortProperty.property
				);
				if (propertySchema?.isPrimary) {
					indexName = undefined;
					gsiAttribute = undefined;
				} else {
					indexName = `${sortProperty.property as string}Index`;
					gsiAttribute = sortProperty.property as string;
				}
				scanAscending = sortProperty.sortDirection === SortDirection.Ascending;
			}
		}

		return {
			indexName,
			gsiAttribute,
			scanAscending
		};
	}

	/**
	 * Build the base attribute maps used for query/scan operations.
	 * @param partitionKey The optional partition key.
	 * @returns The query attribute maps.
	 * @internal
	 */
	private buildQueryAttributeMaps(partitionKey?: string): {
		attributeNames: { [id: string]: string };
		attributeValues: { [id: string]: AttributeValue };
	} {
		return {
			attributeNames: { "#partitionId": "partitionId" },
			attributeValues: {
				[`:${DynamoDbEntityStorageConnector._PARTITION_KEY}`]: {
					S: partitionKey ?? DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE
				}
			}
		};
	}

	/**
	 * Build the key condition expression with the mandatory partition predicate.
	 * @param keyCondition The optional extra key condition segment.
	 * @returns The full key condition expression.
	 * @internal
	 */
	private buildKeyExpression(keyCondition: string): string {
		let keyExpression = "#partitionId = :partitionId";
		if (keyCondition.length > 0) {
			keyExpression += ` AND ${keyCondition}`;
		}
		return keyExpression;
	}

	/**
	 * Decode a paginated cursor into a DynamoDB ExclusiveStartKey.
	 * @param cursor The encoded cursor.
	 * @returns The decoded exclusive start key.
	 * @internal
	 */
	private decodeCursor(cursor?: string): { [id: string]: AttributeValue } | undefined {
		return Is.empty(cursor) ? undefined : ObjectHelper.fromBytes(Converter.base64ToBytes(cursor));
	}

	/**
	 * Encode a DynamoDB key to a cursor string.
	 * @param key The key to encode.
	 * @returns The encoded cursor.
	 * @internal
	 */
	private encodeCursor(key?: { [id: string]: AttributeValue }): string | undefined {
		return Is.empty(key) ? undefined : Converter.bytesToBase64(ObjectHelper.toBytes(key));
	}

	/**
	 * Return undefined if the cursor belongs to a different partition, preventing cross-partition leakage.
	 * @param cursor The encoded cursor.
	 * @param attributeValues The current query attribute values containing the expected partition key.
	 * @returns The cursor if it matches the current partition, otherwise undefined.
	 * @internal
	 */
	private sanitizeCursorForPartition(
		cursor: string | undefined,
		attributeValues: { [id: string]: AttributeValue }
	): string | undefined {
		if (Is.empty(cursor)) {
			return undefined;
		}
		const decoded = this.decodeCursor(cursor);
		if (Is.empty(decoded)) {
			return undefined;
		}
		const expectedPartition =
			attributeValues[`:${DynamoDbEntityStorageConnector._PARTITION_KEY}`]?.S;
		const cursorPartition = decoded[DynamoDbEntityStorageConnector._PARTITION_KEY]?.S;
		return cursorPartition === expectedPartition ? cursor : undefined;
	}

	/**
	 * Execute a scan fallback path for unsupported key-condition shapes.
	 * @param filterCondition The optional filter expression part.
	 * @param properties The projection properties.
	 * @param attributeNames The expression attribute names.
	 * @param attributeValues The expression attribute values.
	 * @param cursor The optional cursor.
	 * @param returnSize The requested page size.
	 * @returns Raw items and an optional cursor.
	 * @internal
	 */
	private async executeScanFallback(
		filterCondition: string,
		properties: (keyof T)[] | undefined,
		attributeNames: { [id: string]: string },
		attributeValues: { [id: string]: AttributeValue },
		cursor: string | undefined,
		returnSize: number
	): Promise<{
		rawItems: { [id: string]: AttributeValue }[];
		cursor?: string;
	}> {
		let scanFilter = "#partitionId = :partitionId";
		if (Is.stringValue(filterCondition)) {
			scanFilter += ` AND ${filterCondition.trim()}`;
		}

		const dbConnection = this.createConnection();
		const matchingItems: { [id: string]: AttributeValue }[] = [];
		let scanStartKey = this.decodeCursor(cursor);
		let lastEvaluatedKey: { [id: string]: AttributeValue } | undefined;

		// Scan in batches with a heuristic limit to avoid scanning excessive unmatched rows.
		// Use at least 2x returnSize per batch to balance accuracy and efficiency.
		const batchScanLimit = Math.max(returnSize * 2, 100);

		do {
			const scanResult = await dbConnection.send(
				new RawScanCommand({
					TableName: this._config.tableName,
					FilterExpression: scanFilter,
					ExpressionAttributeNames: attributeNames,
					ExpressionAttributeValues: attributeValues,
					ExclusiveStartKey: scanStartKey,
					Limit: batchScanLimit
				})
			);

			matchingItems.push(...(scanResult.Items ?? []));
			lastEvaluatedKey = scanResult.LastEvaluatedKey;
			scanStartKey = lastEvaluatedKey;

			// Early exit: stop scanning once we have enough filtered results to fill the page.
			if (matchingItems.length >= returnSize) {
				break;
			}
		} while (!Is.empty(lastEvaluatedKey));

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
			resultCursor = this.encodeCursor(syntheticKey);
		}

		const projectedRawItems = Is.arrayValue(properties)
			? returnedRawItems.map(item => {
					const projected: { [id: string]: AttributeValue } = {};
					for (const prop of properties) {
						const key = prop as string;
						if (!Is.undefined(item[key])) {
							projected[key] = item[key];
						}
					}
					if (!Is.undefined(item[DynamoDbEntityStorageConnector._PARTITION_KEY])) {
						projected[DynamoDbEntityStorageConnector._PARTITION_KEY] =
							item[DynamoDbEntityStorageConnector._PARTITION_KEY];
					}
					return projected;
				})
			: returnedRawItems;

		return {
			rawItems: projectedRawItems,
			cursor: resultCursor
		};
	}

	/**
	 * Execute a query path without filter expression.
	 * @param keyExpression The key condition expression.
	 * @param attributeNames The expression attribute names.
	 * @param attributeValues The expression attribute values.
	 * @param projectionExpression The projection expression.
	 * @param indexName The optional index name.
	 * @param scanAscending The scan direction.
	 * @param cursor The optional cursor.
	 * @param returnSize The requested page size.
	 * @returns Raw items and an optional cursor.
	 * @internal
	 */
	private async executeUnfilteredQuery(
		keyExpression: string,
		attributeNames: { [id: string]: string },
		attributeValues: { [id: string]: AttributeValue },
		projectionExpression: string | undefined,
		indexName: string | undefined,
		scanAscending: boolean,
		cursor: string | undefined,
		returnSize: number
	): Promise<{
		rawItems: { [id: string]: AttributeValue }[];
		cursor?: string;
	}> {
		const connection = this.createDocClient();
		const results = await connection.send(
			new QueryCommand({
				TableName: this._config.tableName,
				IndexName: indexName,
				KeyConditionExpression: keyExpression,
				ExpressionAttributeNames: attributeNames,
				ExpressionAttributeValues: attributeValues,
				ProjectionExpression: projectionExpression,
				Limit: returnSize,
				ScanIndexForward: scanAscending,
				ExclusiveStartKey: this.decodeCursor(cursor)
			})
		);

		const rawItems = (results.Items ?? []) as { [id: string]: AttributeValue }[];
		let hasMore = false;

		if (rawItems.length === returnSize && !Is.empty(results.LastEvaluatedKey)) {
			const probe = await connection.send(
				new QueryCommand({
					TableName: this._config.tableName,
					IndexName: indexName,
					KeyConditionExpression: keyExpression,
					ExpressionAttributeNames: attributeNames,
					ExpressionAttributeValues: attributeValues,
					ProjectionExpression: projectionExpression,
					Limit: 1,
					ScanIndexForward: scanAscending,
					ExclusiveStartKey: results.LastEvaluatedKey
				})
			);
			hasMore = (probe.Items?.length ?? 0) > 0;
		}

		return {
			rawItems,
			cursor: hasMore ? this.encodeCursor(results.LastEvaluatedKey) : undefined
		};
	}

	/**
	 * Execute a query path with filter expression, continuing until page is full or exhausted.
	 * @param keyExpression The key condition expression.
	 * @param filterExpression The filter expression.
	 * @param attributeNames The expression attribute names.
	 * @param attributeValues The expression attribute values.
	 * @param projectionExpression The projection expression.
	 * @param indexName The optional index name.
	 * @param scanAscending The scan direction.
	 * @param cursor The optional cursor.
	 * @param returnSize The requested page size.
	 * @returns Raw items and an optional cursor.
	 * @internal
	 */
	private async executeFilteredQuery(
		keyExpression: string,
		filterExpression: string,
		attributeNames: { [id: string]: string },
		attributeValues: { [id: string]: AttributeValue },
		projectionExpression: string | undefined,
		indexName: string | undefined,
		scanAscending: boolean,
		cursor: string | undefined,
		returnSize: number
	): Promise<{
		rawItems: { [id: string]: AttributeValue }[];
		cursor?: string;
	}> {
		const connection = this.createDocClient();
		const returnedRawItems: { [id: string]: AttributeValue }[] = [];
		let lastEvaluatedKey: { [id: string]: AttributeValue } | undefined = this.decodeCursor(cursor);

		do {
			const results = await connection.send(
				new QueryCommand({
					TableName: this._config.tableName,
					IndexName: indexName,
					KeyConditionExpression: keyExpression,
					FilterExpression: filterExpression,
					ExpressionAttributeNames: attributeNames,
					ExpressionAttributeValues: attributeValues,
					ProjectionExpression: projectionExpression,
					Limit: returnSize - returnedRawItems.length,
					ScanIndexForward: scanAscending,
					ExclusiveStartKey: lastEvaluatedKey
				})
			);

			returnedRawItems.push(...((results.Items ?? []) as { [id: string]: AttributeValue }[]));
			lastEvaluatedKey = results.LastEvaluatedKey;
		} while (returnedRawItems.length < returnSize && !Is.empty(lastEvaluatedKey));

		return {
			rawItems: returnedRawItems,
			cursor: this.encodeCursor(lastEvaluatedKey)
		};
	}

	/**
	 * Convert raw DynamoDB items into connector entities.
	 * @param rawItems Raw DynamoDB items.
	 * @returns The mapped entities.
	 * @internal
	 */
	private mapRawItemsToEntities(rawItems: { [id: string]: AttributeValue }[]): T[] {
		return rawItems.map(item => {
			const unmarshalled = unmarshall(item);
			return EntityStorageHelper.unPrepareEntity(unmarshalled as T, [
				DynamoDbEntityStorageConnector._PARTITION_KEY
			]);
		});
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

	/**
	 * Build a ProjectionExpression string and register a safe alias in attributeNames for every
	 * projected property, preventing ValidationException when a property name is a DynamoDB
	 * reserved word (e.g. "role", "name", "status").
	 * @param properties The properties to project, or undefined to return all attributes.
	 * @param attributeNames The expression attribute names map to mutate with the aliases.
	 * @returns The ProjectionExpression string, or undefined when no projection is needed.
	 * @internal
	 */
	private buildProjectionExpression(
		properties: (keyof T)[] | undefined,
		attributeNames: { [id: string]: string }
	): string | undefined {
		if (!Is.arrayValue(properties)) {
			return undefined;
		}
		return properties
			.map(p => {
				const alias = `#p_${p as string}`;
				attributeNames[alias] = p as string;
				return alias;
			})
			.join(", ");
	}
}
