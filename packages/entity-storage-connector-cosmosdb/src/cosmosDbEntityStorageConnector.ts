// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	type Container,
	CosmosClient,
	CosmosDbDiagnosticLevel,
	type FeedOptions,
	type ItemDefinition,
	PartitionKeyKind,
	type Resource,
	type SqlParameter,
	type SqlQuerySpec
} from "@azure/cosmos";
import {
	BaseError,
	Coerce,
	ComponentFactory,
	GeneralError,
	Guards,
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
import type { ICosmosDbEntityStorageConnectorConfig } from "./models/ICosmosDbEntityStorageConnectorConfig";
import type { ICosmosDbEntityStorageConnectorConstructorOptions } from "./models/ICosmosDbEntityStorageConnectorConstructorOptions";

/**
 * Class for performing entity storage operations using Cosmos DB.
 */
export class CosmosDbEntityStorageConnector<T = unknown> implements IEntityStorageConnector<T> {
	/**
	 * Limit the number of entities when finding.
	 * @internal
	 */
	private static readonly _PAGE_SIZE: number = 40;

	/**
	 * Partition id field name.
	 * @internal
	 */
	private static readonly _PARTITION_ID_NAME: string = "partitionId";

	/**
	 * Partition id field path.
	 * @internal
	 */
	private static readonly _PARTITION_ID_PATH: string = "/partitionId";

	/**
	 * Partition id field value.
	 * @internal
	 */
	private static readonly _PARTITION_ID_VALUE: string = "1";

	/**
	 * Runtime name for the class.
	 */
	public readonly CLASS_NAME: string = nameof<CosmosDbEntityStorageConnector>();

	/**
	 * The schema for the entity.
	 * @internal
	 */
	private readonly _entitySchema: IEntitySchema<T>;

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
		Guards.object(this.CLASS_NAME, nameof(options), options);
		Guards.stringValue(this.CLASS_NAME, nameof(options.entitySchema), options.entitySchema);
		Guards.object<ICosmosDbEntityStorageConnectorConfig>(
			this.CLASS_NAME,
			nameof(options.config),
			options.config
		);
		Guards.stringValue(this.CLASS_NAME, nameof(options.config.endpoint), options.config.endpoint);
		Guards.stringValue(this.CLASS_NAME, nameof(options.config.key), options.config.key);
		Guards.stringValue(
			this.CLASS_NAME,
			nameof(options.config.databaseId),
			options.config.databaseId
		);
		Guards.stringValue(
			this.CLASS_NAME,
			nameof(options.config.containerId),
			options.config.containerId
		);

		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);

		this._primaryKey = EntitySchemaHelper.getPrimaryKey<T>(this._entitySchema);

		this._config = options.config;

		this._client = new CosmosClient({
			endpoint: this._config.endpoint,
			key: this._config.key,
			diagnosticLevel: CosmosDbDiagnosticLevel.debug
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
			await nodeLogging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "databaseCreating",
				data: {
					databaseId: this._config.databaseId
				}
			});

			const { resource: databaseDefinition } = await this._client.databases.createIfNotExists({
				id: this._config.databaseId
			});
			Guards.stringValue(this.CLASS_NAME, nameof(databaseDefinition?.id), databaseDefinition?.id);

			await nodeLogging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "databaseExists",
				data: {
					databaseId: databaseDefinition.id
				}
			});
		} catch (error) {
			if (BaseError.isErrorCode(error, "Conflict")) {
				await nodeLogging?.log({
					level: "info",
					source: this.CLASS_NAME,
					ts: Date.now(),
					message: "databaseAlreadyExists",
					data: {
						databaseId: this._config.databaseId
					}
				});
			} else {
				await nodeLogging?.log({
					level: "error",
					source: this.CLASS_NAME,
					ts: Date.now(),
					message: "databaseCreateFailed",
					error: BaseError.fromError(error),
					data: {
						databaseId: this._config.databaseId
					}
				});
				return false;
			}
		}

		// Create the container if it does not exist
		try {
			const { resource: containerDefinition } = await this._client
				.database(this._config.databaseId)
				.containers.createIfNotExists(
					{
						id: this._config.containerId,
						partitionKey: {
							kind: PartitionKeyKind.Hash,
							paths: [CosmosDbEntityStorageConnector._PARTITION_ID_PATH]
						}
					},
					{ offerThroughput: 400 }
				);

			if (containerDefinition) {
				await nodeLogging?.log({
					level: "info",
					source: this.CLASS_NAME,
					ts: Date.now(),
					message: "containerExists",
					data: {
						containerId: this._config.containerId
					}
				});
			} else {
				await nodeLogging?.log({
					level: "error",
					source: this.CLASS_NAME,
					ts: Date.now(),
					message: "containerNotExisting",
					data: {
						containerId: this._config.containerId
					}
				});
				return false;
			}
		} catch (error) {
			await nodeLogging?.log({
				level: "error",
				source: this.CLASS_NAME,
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
		Guards.stringValue(this.CLASS_NAME, nameof(id), id);

		try {
			// No secondary index or conditions
			if (Is.empty(secondaryIndex) && !Is.arrayValue(conditions)) {
				const { resource: item } = await this._container
					.item(id, CosmosDbEntityStorageConnector._PARTITION_ID_VALUE)
					.read<ItemDefinition>();
				return this.itemToEntity(item);
			}

			const whereQuery: string[] = [
				`c.${CosmosDbEntityStorageConnector._PARTITION_ID_NAME} = @partitionKey`
			];

			// With a secondary index
			if (Is.stringValue(secondaryIndex)) {
				const secIndex = secondaryIndex.toString();
				whereQuery.push(`c.${secIndex} = @id`);
			} else {
				whereQuery.push(`c.${this._primaryKey.property as string} = @id`);
			}

			// With conditions
			if (Is.arrayValue(conditions)) {
				for (const c of conditions) {
					const schemaProp = this._entitySchema.properties?.find(p => p.property === c.property);
					whereQuery.push(
						`c.${String(c.property)} = ${this.propertyToDbValue(c.value, schemaProp?.type)}`
					);
				}
			}

			const query: SqlQuerySpec = {
				query: `SELECT * FROM c WHERE ${whereQuery.join(" AND ")}`,
				parameters: [
					{ name: "@id", value: id },
					{ name: "@partitionKey", value: CosmosDbEntityStorageConnector._PARTITION_ID_VALUE }
				]
			};

			const { resources: items } = await this._container.items.query(query).fetchAll();

			if (items.length === 1) {
				return this.itemToEntity(items[0]);
			}
		} catch (err) {
			if (BaseError.isErrorCode(err, "NotFound")) {
				throw new GeneralError(
					this.CLASS_NAME,
					"containerDoesNotExist",
					{
						container: this._config.containerId
					},
					err
				);
			}
			throw new GeneralError(
				this.CLASS_NAME,
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
		Guards.object<T>(this.CLASS_NAME, nameof(entity), entity);

		EntitySchemaHelper.validateEntity(entity, this.getSchema());

		const id = entity[this._primaryKey.property] as string;

		try {
			if (Is.arrayValue(conditions)) {
				const item = await this._container.item(
					id,
					CosmosDbEntityStorageConnector._PARTITION_ID_VALUE
				);
				const { resource: itemData } = await item.read<ItemDefinition>();
				if (Is.notEmpty(itemData) && !this.verifyConditions(conditions, itemData as T)) {
					return;
				}
			}

			await this._container.items.upsert({
				id,
				[CosmosDbEntityStorageConnector._PARTITION_ID_NAME]:
					CosmosDbEntityStorageConnector._PARTITION_ID_VALUE,
				...entity
			});
		} catch (err) {
			if (BaseError.isErrorCode(err, "ResourceNotFoundException")) {
				throw new GeneralError(
					this.CLASS_NAME,
					"containerDoesNotExist",
					{
						containerId: this._config.containerId
					},
					err
				);
			}
			throw new GeneralError(
				this.CLASS_NAME,
				"setFailed",
				{
					id
				},
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
		Guards.stringValue(this.CLASS_NAME, nameof(id), id);

		try {
			const item = await this._container.item(
				id,
				CosmosDbEntityStorageConnector._PARTITION_ID_VALUE
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
				this.CLASS_NAME,
				"removeFailed",
				{
					id
				},
				err
			);
		}
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
		sortProperties?: { property: keyof T; sortDirection: SortDirection }[],
		properties?: (keyof T)[],
		cursor?: string,
		pageSize?: number
	): Promise<{ entities: Partial<T>[]; cursor?: string }> {
		const sql = "";
		try {
			const returnSize = pageSize ?? CosmosDbEntityStorageConnector._PAGE_SIZE;

			let orderByClause: string = "";
			if (Array.isArray(sortProperties)) {
				if (sortProperties.length > 1) {
					throw new GeneralError(this.CLASS_NAME, "sortSingle");
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
						throw new GeneralError(this.CLASS_NAME, "sortNotIndexed", {
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

			const querySpecs: SqlQuerySpec = {
				query: `SELECT ${properties ? properties.map(p => `c.${p as string}`).join(", ") : "*"} FROM c WHERE c.partitionId = @partitionId ${queryClause} ${orderByClause}`,
				parameters: [
					{ name: "@partitionId", value: CosmosDbEntityStorageConnector._PARTITION_ID_VALUE },
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

			return {
				entities: feedResponse.resources.map(i => this.itemToEntity(i)),
				cursor: feedResponse.continuationToken
			};
		} catch (err) {
			throw new GeneralError(this.CLASS_NAME, "queryFailed", { sql }, err);
		}
	}

	/**
	 * Delete the container.
	 * @returns Nothing.
	 */
	public async containerDelete(): Promise<void> {
		try {
			await this._container.deleteAllItemsForPartitionKey(
				CosmosDbEntityStorageConnector._PARTITION_ID_VALUE
			);
			await this._container.delete();
		} catch {
			// Ignore errors
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
		prop += comparator.property as string;

		let attributeName = this.populateAttributeNames(prop, attributeNames);
		let propName = `${attributeName.replace(/\./g, "").replace(/@/g, "")}`;

		if (Is.array(comparator.value)) {
			const dbValues = comparator.value.map(v => this.propertyToDbValue(v, type));
			const arrAttributeNames = [];
			for (let i = 0; i < dbValues.length; i++) {
				const arrAttributeName = `${propName}${i}`;
				attributeValues[arrAttributeName] = dbValues[i];
				arrAttributeNames.push(arrAttributeName);
			}
			propName = attributeName;
			attributeName = `(${arrAttributeNames.map(name => `@${name}`).join(", ")})`;
		} else {
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
			return `array_contains(c.${attributeName}, @${propName})`;
		} else if (comparator.comparison === ComparisonOperator.Includes) {
			return `contains(c.${attributeName}, @${propName})`;
		} else if (comparator.comparison === ComparisonOperator.NotIncludes) {
			return `notContains(c.${attributeName}, @${propName})`;
		} else if (comparator.comparison === ComparisonOperator.In) {
			return `c.${propName} IN ${attributeName}`;
		}

		throw new GeneralError(this.CLASS_NAME, "comparisonNotSupported", {
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

		throw new GeneralError(this.CLASS_NAME, "conditionalNotSupported", { operator });
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
		ObjectHelper.propertyDelete(item, "partitionId");
		ObjectHelper.propertyDelete(item, "_attachments");
		ObjectHelper.propertyDelete(item, "_etag");
		ObjectHelper.propertyDelete(item, "_rid");
		ObjectHelper.propertyDelete(item, "_self");
		ObjectHelper.propertyDelete(item, "_ts");
		return item as T;
	}
}
