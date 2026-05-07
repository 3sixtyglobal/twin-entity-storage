// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	type AttributeValue,
	type CreateTableCommandInput,
	DynamoDB,
	type DynamoDBClientConfig,
	type GlobalSecondaryIndex,
	QueryCommand,
	waitUntilTableExists
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
import { ContextIdHelper, ContextIdStore } from "@twin.org/context";
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
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import type { IDynamoDbEntityStorageConnectorConfig } from "./models/IDynamoDbEntityStorageConnectorConfig.js";
import type { IDynamoDbEntityStorageConnectorConstructorOptions } from "./models/IDynamoDbEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations using Dynamo DB.
 */
export class DynamoDbEntityStorageConnector<T = unknown> implements IEntityStorageConnector<T> {
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

		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._partitionContextIds = options.partitionContextIds;

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
						maxWaitTime: 60000
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

				delete response.Item?.[DynamoDbEntityStorageConnector._PARTITION_KEY];
				return response.Item as T;
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

		EntitySchemaHelper.validateEntity(entity, this.getSchema());

		const id = entity[this._primaryKey.property];

		try {
			const docClient = this.createDocClient();

			const { conditionExpression, attributeNames, attributeValues } =
				this.buildConditionExpression(conditions);

			const putCommand = new PutCommand({
				TableName: this._config.tableName,
				Item: {
					[DynamoDbEntityStorageConnector._PARTITION_KEY]:
						partitionKey ?? DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE,
					...entity
				} as { [id: string]: unknown },
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

		for (const entity of entities) {
			EntitySchemaHelper.validateEntity(entity, this.getSchema());
		}

		try {
			const docClient = this.createDocClient();
			const chunkSize = 25;

			for (let i = 0; i < entities.length; i += chunkSize) {
				const chunk = entities.slice(i, i + chunkSize);
				await docClient.send(
					new BatchWriteCommand({
						RequestItems: {
							[this._config.tableName]: chunk.map(entity => ({
								PutRequest: {
									Item: {
										[DynamoDbEntityStorageConnector._PARTITION_KEY]:
											partitionKey ?? DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE,
										...entity
									} as { [id: string]: unknown }
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
	 * @returns The total count of entities in the storage.
	 */
	public async count(): Promise<number> {
		try {
			const contextIds = await ContextIdStore.getContextIds();
			const partitionKey = ContextIdHelper.combinedContextKey(
				contextIds,
				this._partitionContextIds
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
						ExpressionAttributeNames: {
							"#partitionId": DynamoDbEntityStorageConnector._PARTITION_KEY
						},
						ExpressionAttributeValues: {
							":partitionId": {
								S: partitionKey ?? DynamoDbEntityStorageConnector._PARTITION_KEY_VALUE
							}
						},
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
	} {
		// If no conditions are defined then return empty string
		if (Is.undefined(condition)) {
			return {
				keyCondition: "",
				filterCondition: ""
			};
		}

		if ("conditions" in condition) {
			if (condition.conditions.length === 0) {
				return {
					keyCondition: "",
					filterCondition: ""
				};
			}
			// It's a group of comparisons, so check the individual items and combine with the logical operator
			const joinConditions: {
				keyCondition: string;
				filterCondition: string;
			}[] = condition.conditions.map(c =>
				this.buildQueryParameters(objectPath, c, attributeNames, attributeValues, secondaryIndex)
			);

			const logicalOperator = this.mapConditionalOperator(condition.logicalOperator);
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
				filterCondition: Is.stringValue(filterCondition) ? ` (${filterCondition}) ` : ""
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
			filterCondition: !isKey ? comparison : ""
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
			if (comparator.comparison === ComparisonOperator.Equals) {
				return `attribute_not_exists(${attributeName})`;
			} else if (comparator.comparison === ComparisonOperator.NotEquals) {
				return `attribute_exists(${attributeName})`;
			}
		}

		let propName = `:${attributeName.replace(/\./g, "").replace(/#/g, "")}`;

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
			return `notContains(${attributeName}, ${propName})`;
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
		const requestHandler = {
			requestTimeout: this._config.connectionTimeoutMs
		};

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
				requestHandler
			};
		}

		return {
			endpoint: this._config.endpoint,
			region: this._config.region,
			requestHandler
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

			await dbConnection.describeTable({ TableName: tableName });

			return true;
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
				Limit: returnSize,
				ScanIndexForward: scanAscending,
				ExclusiveStartKey: Is.empty(cursor)
					? undefined
					: ObjectHelper.fromBytes(Converter.base64ToBytes(cursor))
			});

			const connection = this.createDocClient();

			const results = await connection.send(query);

			let entities: T[] = [];

			if (Is.arrayValue(results.Items)) {
				entities = results.Items.map(item => {
					const unmarshalled = unmarshall(item);
					delete unmarshalled[DynamoDbEntityStorageConnector._PARTITION_KEY];
					return unmarshalled as T;
				});
			}

			return {
				entities,
				cursor: Is.empty(results.LastEvaluatedKey)
					? undefined
					: Converter.bytesToBase64(ObjectHelper.toBytes(results.LastEvaluatedKey))
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
