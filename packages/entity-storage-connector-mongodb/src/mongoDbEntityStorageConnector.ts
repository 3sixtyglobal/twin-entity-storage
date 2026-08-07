// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	HealthCategory,
	HealthStatus,
	type IHealth,
	type IHealthProviderComponent
} from "@twin.org/api-models";
import { ContextIdHelper, ContextIdStore, type IContextIds } from "@twin.org/context";
import {
	BaseError,
	ComponentFactory,
	GeneralError,
	Guards,
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
	EntitySchemaPropertyType,
	type IEntitySchema,
	LogicalOperator,
	type SortDirection
} from "@twin.org/entity";
import {
	EntityStorageHelper,
	type IEntityStorageConnector,
	type IEntityStorageMigrationConnector,
	type IMigrationOptions
} from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { type Collection, type Document, type Filter, MongoClient, type WithId } from "mongodb";
import type { IMongoDbEntityStorageConnectorConfig } from "./models/IMongoDbEntityStorageConnectorConfig.js";
import type { IMongoDbEntityStorageConnectorConstructorOptions } from "./models/IMongoDbEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations using MongoDb.
 */
export class MongoDbEntityStorageConnector<T = unknown>
	implements IEntityStorageMigrationConnector<T>, IHealthProviderComponent
{
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<MongoDbEntityStorageConnector>();

	/**
	 * Limit the number of entities when finding.
	 * @internal
	 */
	private static readonly _DEFAULT_LIMIT: number = 40;

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
		Guards.object(MongoDbEntityStorageConnector.CLASS_NAME, nameof(options), options);
		Guards.stringValue(
			MongoDbEntityStorageConnector.CLASS_NAME,
			nameof(options.entitySchema),
			options.entitySchema
		);
		Guards.object<IMongoDbEntityStorageConnectorConfig>(
			MongoDbEntityStorageConnector.CLASS_NAME,
			nameof(options.config),
			options.config
		);
		Guards.stringValue(
			MongoDbEntityStorageConnector.CLASS_NAME,
			nameof(options.config.host),
			options.config.host
		);
		Guards.stringValue(
			MongoDbEntityStorageConnector.CLASS_NAME,
			nameof(options.config.database),
			options.config.database
		);
		Guards.stringValue(
			MongoDbEntityStorageConnector.CLASS_NAME,
			nameof(options.config.collection),
			options.config.collection
		);

		this._entitySchemaName = options.entitySchema;
		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._partitionContextIds = options.partitionContextIds;

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
				source: MongoDbEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "databaseCreating",
				data: {
					databaseName: this._config.database
				}
			});

			// Create the database if it does not exist
			this._client.db(this._config.database);

			await nodeLogging?.log({
				level: "info",
				source: MongoDbEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "databaseExists",
				data: {
					databaseName: this._config.database
				}
			});

			await this.getCollection();

			await nodeLogging?.log({
				level: "info",
				source: MongoDbEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "collectionExists",
				data: {
					collectionName: this._config.collection
				}
			});
		} catch (error) {
			await nodeLogging?.log({
				level: "error",
				source: MongoDbEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "databaseCreateFailed",
				error: BaseError.fromError(error),
				data: {
					databaseName: this._config.database
				}
			});
			return false;
		}

		return true;
	}

	/**
	 * The component needs to be stopped when the node is closed.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns Nothing.
	 */
	public async stop?(nodeLoggingComponentType?: string): Promise<void> {
		await this._client.close();
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return MongoDbEntityStorageConnector.CLASS_NAME;
	}

	/**
	 * Returns the health status of the component.
	 * @returns The health status of the component.
	 */
	public async health(): Promise<IHealth[]> {
		try {
			await this._client
				.db(this._config.database)
				.collection(this._config.collection)
				.estimatedDocumentCount();
			return [
				{
					source: MongoDbEntityStorageConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Ok,
					description: "healthDescription",
					data: { database: this._config.database, collection: this._config.collection }
				}
			];
		} catch {
			return [
				{
					source: MongoDbEntityStorageConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Error,
					description: "healthDescription",
					message: "connectionFailed",
					data: { database: this._config.database, collection: this._config.collection }
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
		Guards.stringValue(MongoDbEntityStorageConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		try {
			const primaryKey = EntitySchemaHelper.getPrimaryKey(this.getSchema());
			const query: { [key: string]: unknown } = Is.empty(secondaryIndex)
				? { [primaryKey.property]: id }
				: { [secondaryIndex]: id };

			if (conditions) {
				for (const condition of conditions) {
					query[condition.property as string] = condition.value;
				}
			}

			const collection = await this.getCollection();
			const result = await collection.findOne(query);
			ObjectHelper.propertyDelete(result, "_id");
			return Is.objectValue(result)
				? EntityStorageHelper.unPrepareEntity<T>(result as T, [])
				: undefined;
		} catch (err) {
			throw new GeneralError(
				MongoDbEntityStorageConnector.CLASS_NAME,
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
		Guards.object<T>(MongoDbEntityStorageConnector.CLASS_NAME, nameof(entity), entity);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const prepared = EntityStorageHelper.prepareEntity(entity, this._entitySchema, undefined, {
			nullBehavior: "omit"
		});

		const primaryKey = EntitySchemaHelper.getPrimaryKey(this.getSchema());
		const id = prepared[primaryKey.property];

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
				{ $set: prepared as Partial<Document> },
				{ upsert: true }
			);
		} catch (err) {
			throw new GeneralError(
				MongoDbEntityStorageConnector.CLASS_NAME,
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
		Guards.arrayValue(MongoDbEntityStorageConnector.CLASS_NAME, nameof(entities), entities);

		const primaryKey = EntitySchemaHelper.getPrimaryKey(this.getSchema());

		const preparedEntities = entities.map(entity =>
			EntityStorageHelper.prepareEntity(entity, this._entitySchema, undefined, {
				nullBehavior: "omit"
			})
		);

		try {
			const collection = await this.getCollection();
			await collection.bulkWrite(
				preparedEntities.map(prepared => {
					const filter: { [key: string]: unknown } = {
						[primaryKey.property]: prepared[primaryKey.property]
					};
					return {
						updateOne: {
							filter,
							update: {
								$set: prepared as Partial<Document>
							},
							upsert: true
						}
					};
				})
			);
		} catch (err) {
			throw new GeneralError(
				MongoDbEntityStorageConnector.CLASS_NAME,
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
			const collection = await this.getCollection();
			await collection.deleteMany({});
		} catch (err) {
			throw new GeneralError(
				MongoDbEntityStorageConnector.CLASS_NAME,
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
		Guards.stringValue(MongoDbEntityStorageConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

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
			throw new GeneralError(MongoDbEntityStorageConnector.CLASS_NAME, "removeFailed", { id }, err);
		}
	}

	/**
	 * Remove multiple entities by id.
	 * @param ids The ids of the entities to remove.
	 * @returns Nothing.
	 */
	public async removeBatch(ids: string[]): Promise<void> {
		Guards.arrayValue(MongoDbEntityStorageConnector.CLASS_NAME, nameof(ids), ids);

		try {
			const primaryKey = EntitySchemaHelper.getPrimaryKey(this.getSchema());
			const filter: { [key: string]: unknown } = {
				[primaryKey.property]: { $in: ids }
			};

			const collection = await this.getCollection();
			await collection.deleteMany(filter);
		} catch (err) {
			throw new GeneralError(
				MongoDbEntityStorageConnector.CLASS_NAME,
				"removeBatchFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Teardown the entity storage by dropping the collection.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the teardown process was successful.
	 */
	public async teardown(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		await nodeLogging?.log({
			level: "info",
			source: MongoDbEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "collectionDropping",
			data: { collection: this._config.collection }
		});

		try {
			if (Is.arrayValue(this._partitionContextIds)) {
				const db = this._client.db(this._config.database);
				const collections = await this.listPartitionCollections();
				for (const col of collections) {
					await db
						.collection(col.name)
						.drop()
						.catch(() => {});
				}
			} else {
				const collection = await this.getCollection();
				await collection.drop();
			}

			await nodeLogging?.log({
				level: "info",
				source: MongoDbEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "collectionDropped",
				data: { collection: this._config.collection }
			});

			return true;
		} catch (err) {
			await nodeLogging?.log({
				level: "error",
				source: MongoDbEntityStorageConnector.CLASS_NAME,
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
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);
		EntityStorageHelper.validateSortProperties(this._entitySchema, sortProperties);
		EntityStorageHelper.validateProperties(this._entitySchema, properties);

		if (!Is.empty(limit)) {
			const validationFailures: IValidationFailure[] = [];
			Validation.integer(nameof(limit), limit, validationFailures, undefined, { minValue: 1 });
			Validation.asValidationError(
				MongoDbEntityStorageConnector.CLASS_NAME,
				"query",
				validationFailures
			);
		}

		const returnSize = limit ?? MongoDbEntityStorageConnector._DEFAULT_LIMIT;

		const filter = this.buildFilter(conditions);

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
		const entitiesResult = await collection
			?.find(filter as Filter<Document>, { projection })
			.sort(sort)
			.skip(cursorValue)
			.limit(returnSize + 1)
			.toArray();

		const rawResults = (entitiesResult as unknown as Partial<T>[]) ?? [];
		const hasMore = rawResults.length > returnSize;
		const entities = hasMore ? rawResults.slice(0, returnSize) : rawResults;

		for (let i = 0; i < entities.length; i++) {
			const entity = entities[i];
			ObjectHelper.propertyDelete(entity, "_id");
			entities[i] = EntityStorageHelper.unPrepareEntity(entity, []);
		}

		return {
			entities,
			cursor: hasMore ? String(cursorValue + returnSize) : undefined
		};
	}

	/**
	 * Count all the entities which match the conditions.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The total count of entities in the storage.
	 */
	public async count(conditions?: EntityCondition<T>): Promise<number> {
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);
		try {
			const filter = this.buildFilter(conditions);

			const collection = await this.getCollection();
			return await collection.countDocuments(filter as Filter<Document>);
		} catch (err) {
			throw new GeneralError(
				MongoDbEntityStorageConnector.CLASS_NAME,
				"countFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Get all unique partition context ids present in the collection.
	 * @returns An array of context id objects, one per unique partition.
	 */
	public async getPartitionContextIds(): Promise<IContextIds[] | undefined> {
		if (!Is.arrayValue(this._partitionContextIds)) {
			return undefined;
		}

		try {
			const prefix = `${this._config.collection}_`;
			const collections = await this.listPartitionCollections();

			return collections.map(col =>
				ContextIdHelper.shortSplit(this._partitionContextIds ?? [], col.name.slice(prefix.length))
			);
		} catch (err) {
			throw new GeneralError(
				MongoDbEntityStorageConnector.CLASS_NAME,
				"getPartitionContextIdsFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Create the target connector for performing the migration using a temporary collection.
	 * @param newEntitySchema The name of the new entity schema to create the connector for.
	 * @returns Connector for performing the migration.
	 */
	public async createTargetConnector<U>(
		newEntitySchema: string
	): Promise<IEntityStorageConnector<U>> {
		const migrationCollectionName = `${this._config.collection}Migration${Date.now()}`;
		return new MongoDbEntityStorageConnector<U>({
			entitySchema: newEntitySchema,
			config: {
				...this._config,
				collection: migrationCollectionName
			},
			partitionContextIds: this._partitionContextIds
		});
	}

	/**
	 * Finalize the migration by dropping the source collection and renaming the migration collection to the original name.
	 * @param targetConnector The connector holding the migrated data in a temporary collection.
	 * @param options The options to control how the migration is finalized.
	 * @param loggingComponentType The logging component type to use during finalization.
	 * @returns The final connector using the original collection name with the new schema.
	 */
	public async finalizeMigration<U>(
		targetConnector: MongoDbEntityStorageConnector<U>,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<MongoDbEntityStorageConnector<U>> {
		// With collection-per-partition each partition is a separate collection, so we must
		// rename every target partition collection to the corresponding source name. We do this
		// without relying on context so that all partitions are handled in a single call.
		const targetBase = targetConnector._config.collection;
		const sourceBase = this._config.collection;
		const targetDb = targetConnector._client.db(targetConnector._config.database);
		const sourceDb = this._client.db(this._config.database);

		// Find all collections the target connector wrote to (exact base name or with a _suffix).
		const allCollections = await targetDb.listCollections().toArray();
		const migrationCollections = allCollections.filter(
			c => c.name === targetBase || c.name.startsWith(`${targetBase}_`)
		);

		for (const col of migrationCollections) {
			// Preserve whatever suffix (empty, or "_partitionKey") was appended to the base name.
			const suffix = col.name.slice(targetBase.length);
			const finalName = `${sourceBase}${suffix}`;

			// Drop the existing source collection to free up the name.
			try {
				await sourceDb.collection(finalName).drop();
			} catch {} // collection may not exist yet

			await targetDb.collection(col.name).rename(finalName);
		}

		const finalConnector = new MongoDbEntityStorageConnector<U>({
			entitySchema: targetConnector._entitySchemaName,
			config: this._config,
			partitionContextIds: this._partitionContextIds
		});

		if (await finalConnector.bootstrap(loggingComponentType)) {
			await targetConnector.stop?.();
			return finalConnector;
		}

		throw new GeneralError(
			MongoDbEntityStorageConnector.CLASS_NAME,
			"finalizeMigrationFailedBootstrap",
			undefined
		);
	}

	/**
	 * Cleanup a failed or aborted migration by dropping the temporary migration collection.
	 * @param targetConnector The target connector to cleanup.
	 * @param options The options to control how the migration is cleaned up.
	 * @param loggingComponentType The optional component type to use for logging.
	 * @returns A promise that resolves when the cleanup is complete.
	 */
	public async cleanupMigration<U>(
		targetConnector: IEntityStorageConnector<U> | undefined,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<void> {
		await targetConnector?.teardown?.(loggingComponentType);
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
	 * Return a Mongo DB collection for the current partition context.
	 * @returns The MongoDb collection.
	 * @internal
	 */
	private async getCollection(): Promise<Collection> {
		const collectionName = await this.resolveCollectionName(this._config.collection);
		return this._client.db(this._config.database).collection(collectionName);
	}

	/**
	 * Resolve the collection name for a base name, appending the partition key when applicable.
	 * @param base The base collection name.
	 * @returns The resolved collection name.
	 * @internal
	 */
	private async resolveCollectionName(base: string): Promise<string> {
		if (!Is.arrayValue(this._partitionContextIds)) {
			return base;
		}
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);
		return Is.stringValue(partitionKey) ? `${base}_${partitionKey.replace(/[\0$]/g, "_")}` : base;
	}

	/**
	 * Escape special regex characters in a string for use in a MongoDB $regex query.
	 * @param value The string to escape.
	 * @returns The escaped string.
	 * @internal
	 */
	private escapeRegex(value: string): string {
		return value.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
	}

	/**
	 * List all collections that belong to this connector's partition set.
	 * @returns The collection info objects whose names share the connector's base prefix.
	 * @internal
	 */
	private async listPartitionCollections(): Promise<{ name: string }[]> {
		const prefix = `${this._config.collection}_`;
		const db = this._client.db(this._config.database);
		return db.listCollections({ name: { $regex: `^${this.escapeRegex(prefix)}` } }).toArray();
	}

	/**
	 * Build a MongoDB filter from optional conditions.
	 * @param conditions The optional entity conditions to include.
	 * @returns The MongoDB filter object.
	 * @internal
	 */
	private buildFilter(conditions: EntityCondition<T> | undefined): Filter<T> {
		const filter: Filter<T> = {};
		if (!Is.empty(conditions)) {
			const finalConditions: EntityCondition<T> = {
				conditions: [conditions],
				logicalOperator: LogicalOperator.And
			};
			this.buildQueryParameters("", finalConditions, filter);
		}
		return filter;
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
			if (condition.conditions.length === 0) {
				// Empty AND group → match all (leave filter as {}; no constraint).
				// Empty OR group → match none; { $nor: [{}] } negates the match-all document.
				if (condition.logicalOperator === LogicalOperator.Or) {
					(filter as { [key: string]: unknown }).$nor = [{}];
				}
				return;
			}
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
			const propertyPath = String(condition.property);
			const prop = objectPath ? `${objectPath}.${propertyPath}` : propertyPath;
			const propertyParts = propertyPath.split(".");
			const schemaLookupName = propertyParts.length > 1 ? propertyParts[0] : propertyPath;
			const propertySchema = this._entitySchema.properties?.find(
				p => p.property === schemaLookupName
			);
			// For dot-notation paths the leaf field is always a string value; using the root
			// type directly would send Includes into $elemMatch which does not work for nested
			// string fields. Keeping String here causes mapComparisonOperator to emit $regex,
			// which MongoDB handles correctly for both nested object and array traversal.
			const propertyType =
				propertyParts.length > 1 ? EntitySchemaPropertyType.String : propertySchema?.type;
			const comparison = this.mapComparisonOperator(
				condition.comparison,
				condition.value,
				propertyType
			);

			(filter as { [key: string]: unknown })[prop] = comparison;
		}
	}

	/**
	 * Map the framework comparison operators to those in MongoDB.
	 * @param comparison The comparison operator.
	 * @param value The value to compare.
	 * @param type The type of the property from the schema.
	 * @returns The MongoDB comparison expression.
	 * @throws GeneralError if the comparison operator is not supported.
	 * @internal
	 */
	private mapComparisonOperator(
		comparison: ComparisonOperator,
		value: unknown,
		type?: EntitySchemaPropertyType
	): unknown {
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
				// For string fields, use regex for substring matching
				if (type === EntitySchemaPropertyType.String) {
					// Escape special regex characters in the value
					const escapedValue = this.escapeRegex(String(value));
					return { $regex: escapedValue };
				}
				// For array and object fields, use $elemMatch
				if (type === EntitySchemaPropertyType.Array || type === EntitySchemaPropertyType.Object) {
					return { $elemMatch: { $eq: value } };
				}
				// Fallback to $elemMatch for backwards compatibility
				return { $elemMatch: { $eq: value } };
			case ComparisonOperator.NotIncludes:
				// For string fields, use negated regex
				if (type === EntitySchemaPropertyType.String) {
					const escapedValue = this.escapeRegex(String(value));
					return { $not: { $regex: escapedValue } };
				}
				// For array/object fields: $ne on an array field matches documents where
				// none of the array elements equal the value (MongoDB element-wise semantics).
				// $elemMatch: { $ne: value } is wrong - it matches if *any* element ≠ value.
				return { $ne: value };
			default:
				throw new GeneralError(
					MongoDbEntityStorageConnector.CLASS_NAME,
					"unsupportedComparisonOperator",
					{ comparison }
				);
		}
	}
}
