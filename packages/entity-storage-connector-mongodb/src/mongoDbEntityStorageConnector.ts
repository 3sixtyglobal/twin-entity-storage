// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { BaseError, ComponentFactory, GeneralError, Guards, Is } from "@twin.org/core";
import {
	ComparisonOperator,
	type EntityCondition,
	EntitySchemaFactory,
	EntitySchemaHelper,
	type IEntitySchema,
	LogicalOperator,
	type SortDirection
} from "@twin.org/entity";
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { type Collection, type Document, type Filter, MongoClient, type WithId } from "mongodb";
import type { IMongoDbEntityStorageConnectorConfig } from "./models/IMongoDbEntityStorageConnectorConfig";
import type { IMongoDbEntityStorageConnectorConstructorOptions } from "./models/IMongoDbEntityStorageConnectorConstructorOptions";

/**
 * Class for performing entity storage operations using MongoDb.
 */
export class MongoDbEntityStorageConnector<T = unknown> implements IEntityStorageConnector<T> {
	/**
	 * Limit the number of entities when finding.
	 * @internal
	 */
	private static readonly _PAGE_SIZE: number = 40;

	/**
	 * Runtime name for the class.
	 */
	public readonly CLASS_NAME: string = nameof<MongoDbEntityStorageConnector>();

	/**
	 * The schema for the entity.
	 * @internal
	 */
	private readonly _entitySchema: IEntitySchema<T>;

	/**
	 * The configuration for the connector.
	 * @internal
	 */
	private readonly _config: IMongoDbEntityStorageConnectorConfig;

	/**
	 * The MongoDb client.
	 * @internal
	 */
	private readonly _client: MongoClient;

	/**
	 * Create a new instance of MongoDbEntityStorageConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IMongoDbEntityStorageConnectorConstructorOptions) {
		Guards.object(this.CLASS_NAME, nameof(options), options);
		Guards.stringValue(this.CLASS_NAME, nameof(options.entitySchema), options.entitySchema);
		Guards.object<IMongoDbEntityStorageConnectorConfig>(
			this.CLASS_NAME,
			nameof(options.config),
			options.config
		);
		Guards.stringValue(this.CLASS_NAME, nameof(options.config.host), options.config.host);
		Guards.stringValue(this.CLASS_NAME, nameof(options.config.database), options.config.database);
		Guards.stringValue(
			this.CLASS_NAME,
			nameof(options.config.collection),
			options.config.collection
		);

		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);

		this._config = options.config;

		this._client = new MongoClient(this.createConnectionConfig());
	}

	/**
	 * Initialize the MongoDb environment.
	 * @param nodeLoggingComponentType Optional type of the logging component.
	 * @returns A promise that resolves to a boolean indicating success.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		try {
			await this._client.connect();

			await nodeLogging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "databaseCreating",
				data: {
					database: this._config.database
				}
			});

			// Create the database if it does not exist
			this._client.db(this._config.database);

			await nodeLogging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "databaseExists",
				data: {
					database: this._config.database
				}
			});

			await this.getCollection();

			await nodeLogging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "collectionExists",
				data: {
					collection: this._config.collection
				}
			});
		} catch (error) {
			await nodeLogging?.log({
				level: "error",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "databaseCreateFailed",
				error: BaseError.fromError(error),
				data: {
					database: this._config.database
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
	 * Get an entity from MongoDb.
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
			const primaryKey = EntitySchemaHelper.getPrimaryKey(this.getSchema());
			const query: { [key in keyof T]?: unknown } = Is.empty(secondaryIndex)
				? { [primaryKey.property]: id }
				: { [secondaryIndex]: id };

			if (conditions) {
				for (const condition of conditions) {
					query[condition.property] = condition.value;
				}
			}

			const collection = await this.getCollection();
			const result = await collection.findOne(query);
			return result as T | undefined;
		} catch (err) {
			throw new GeneralError(
				this.CLASS_NAME,
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
		Guards.object<T>(this.CLASS_NAME, nameof(entity), entity);

		EntitySchemaHelper.validateEntity(entity, this.getSchema());

		const primaryKey = EntitySchemaHelper.getPrimaryKey(this.getSchema());
		const id = entity[primaryKey.property];

		try {
			const filter: { [key in keyof T]?: unknown } = { [primaryKey.property]: id };

			if (Is.arrayValue(conditions)) {
				for (const condition of conditions) {
					filter[condition.property] = condition.value;
				}
			}

			const collection = await this.getCollection();
			await collection.findOneAndUpdate(
				filter,
				{ $set: entity as Partial<Document> },
				{ upsert: true }
			);
		} catch (err) {
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
			const primaryKey = EntitySchemaHelper.getPrimaryKey(this.getSchema());
			const query: { [key in keyof T]?: unknown } = { [primaryKey.property]: id };

			if (conditions) {
				for (const condition of conditions) {
					query[condition.property] = condition.value;
				}
			}

			const collection = await this.getCollection();
			await collection.deleteOne(query);
		} catch (err) {
			throw new GeneralError(this.CLASS_NAME, "removeFailed", { id }, err);
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
		const returnSize = pageSize ?? MongoDbEntityStorageConnector._PAGE_SIZE;

		const filter: Filter<T> = {};
		if (conditions) {
			this.buildQueryParameters("", conditions, filter);
		}

		const sort = new Map<string, SortDirection>();
		if (Array.isArray(sortProperties)) {
			for (const sortProperty of sortProperties) {
				sort.set(sortProperty.property as string, sortProperty.sortDirection);
			}
		}

		const projection: { [key: string]: number } = {};
		if (properties) {
			for (const property of properties) {
				projection[property as string] = 1;
			}
		}

		const cursorValue = cursor ? Number(cursor) : 0;

		const collection = await this.getCollection();
		const entities = await collection
			?.find(filter as Filter<Document>, { projection })
			.sort(sort)
			.skip(cursorValue)
			.limit(returnSize)
			.toArray();

		return {
			entities: (entities as unknown as Partial<T>[]) ?? [],
			cursor: entities?.length === returnSize ? String(cursorValue + returnSize) : undefined
		};
	}

	/**
	 * Drop the collection.
	 * @returns Nothing.
	 */
	public async collectionDrop(): Promise<void> {
		try {
			const collection = await this.getCollection();
			await collection.drop();
		} catch {
			// Ignore errors
		}
	}

	/**
	 * Create a new DB connection configuration.
	 * @returns The MongoDb connection configuration.
	 * @internal
	 */
	private createConnectionConfig(): string {
		const { host, port, user, password, database } = this._config;
		const portPart = port ? `:${port}` : "";
		if (user && password) {
			return `mongodb://${user}:${password}@${host}${portPart}/${database}`;
		}
		return `mongodb://${host}${portPart}/${database}`;
	}

	/**
	 * Return a Mongo DB collection.
	 * @returns The MongoDb collection.
	 * @internal
	 */
	private async getCollection(): Promise<Collection<Document>> {
		const { database, collection } = this._config;
		return this._client.db(database).collection(collection);
	}

	/**
	 * Create an MongoDB filter query.
	 * @param objectPath The path for the nested object.
	 * @param condition The conditions to create the query from.
	 * @param filter The filter query to use.
	 * @internal
	 */
	private buildQueryParameters(
		objectPath: string,
		condition: EntityCondition<T>,
		filter: Filter<T>
	): void {
		if (!condition) {
			return;
		}

		if ("conditions" in condition) {
			const subConditions: Filter<T>[] = condition.conditions.map(c => {
				const subFilter: Filter<T> = {};
				this.buildQueryParameters(objectPath, c, subFilter);
				return subFilter;
			});

			if (condition.logicalOperator === LogicalOperator.And) {
				filter.$and = subConditions as Filter<WithId<T>>[];
			} else if (condition.logicalOperator === LogicalOperator.Or) {
				filter.$or = subConditions as Filter<WithId<T>>[];
			} else {
				Object.assign(filter, subConditions[0]);
			}
		} else {
			const prop = objectPath ? `${objectPath}.${condition.property}` : String(condition.property);
			const comparison = this.mapComparisonOperator(condition.comparison, condition.value);

			(filter as { [key: string]: unknown })[prop] = comparison;
		}
	}

	/**
	 * Map the framework comparison operators to those in MongoDB.
	 * @param comparison The comparison operator.
	 * @param value The value to compare.
	 * @returns The MongoDB comparison expression.
	 * @internal
	 */
	private mapComparisonOperator(comparison: ComparisonOperator, value: unknown): unknown {
		switch (comparison) {
			case ComparisonOperator.Equals:
				return value;
			case ComparisonOperator.NotEquals:
				return { $ne: value };
			case ComparisonOperator.GreaterThan:
				return { $gt: value };
			case ComparisonOperator.LessThan:
				return { $lt: value };
			case ComparisonOperator.GreaterThanOrEqual:
				return { $gte: value };
			case ComparisonOperator.LessThanOrEqual:
				return { $lte: value };
			case ComparisonOperator.In:
				return { $in: Array.isArray(value) ? value : [value] };
			case ComparisonOperator.Includes:
				return { $elemMatch: { $eq: value } };
			default:
				throw new GeneralError(this.CLASS_NAME, "unsupportedComparisonOperator", { comparison });
		}
	}
}
