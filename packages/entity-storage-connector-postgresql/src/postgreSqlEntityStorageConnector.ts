// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
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
	type IComparator,
	type IEntitySchema,
	type IEntitySchemaProperty,
	LogicalOperator,
	SortDirection
} from "@twin.org/entity";
import {
	EntityStorageHelper,
	type IEntityStorageMigrationConnector,
	type IMigrationOptions
} from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import postgres, { type ParameterOrJSON } from "postgres";
import type { IPostgreSqlEntityStorageConnectorConfig } from "./models/IPostgreSqlEntityStorageConnectorConfig.js";
import type { IPostgreSqlEntityStorageConnectorConstructorOptions } from "./models/IPostgreSqlEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations using ql.
 */
export class PostgreSqlEntityStorageConnector<
	T = unknown
> implements IEntityStorageMigrationConnector<T> {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<PostgreSqlEntityStorageConnector>();

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
	 * The primary key property.
	 * @internal
	 */
	private readonly _primaryKeyProperty: IEntitySchemaProperty<T>;

	/**
	 * The configuration for the connector.
	 * @internal
	 */
	private readonly _config: IPostgreSqlEntityStorageConnectorConfig;

	/**
	 * The configuration for the connector.
	 * @internal
	 */
	private _connection?: postgres.Sql;

	/**
	 * Create a new instance of PostgreSqlEntityStorageConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IPostgreSqlEntityStorageConnectorConstructorOptions) {
		Guards.object(PostgreSqlEntityStorageConnector.CLASS_NAME, nameof(options), options);
		Guards.stringValue(
			PostgreSqlEntityStorageConnector.CLASS_NAME,
			nameof(options.entitySchema),
			options.entitySchema
		);
		Guards.object<IPostgreSqlEntityStorageConnectorConfig>(
			PostgreSqlEntityStorageConnector.CLASS_NAME,
			nameof(options.config),
			options.config
		);
		Guards.stringValue(
			PostgreSqlEntityStorageConnector.CLASS_NAME,
			nameof(options.config.host),
			options.config.host
		);
		Guards.stringValue(
			PostgreSqlEntityStorageConnector.CLASS_NAME,
			nameof(options.config.user),
			options.config.user
		);
		Guards.stringValue(
			PostgreSqlEntityStorageConnector.CLASS_NAME,
			nameof(options.config.password),
			options.config.password
		);
		Guards.stringValue(
			PostgreSqlEntityStorageConnector.CLASS_NAME,
			nameof(options.config.database),
			options.config.database
		);
		Guards.stringValue(
			PostgreSqlEntityStorageConnector.CLASS_NAME,
			nameof(options.config.tableName),
			options.config.tableName
		);

		this._entitySchemaName = options.entitySchema;
		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._partitionContextIds = options.partitionContextIds;
		this._primaryKeyProperty = EntitySchemaHelper.getPrimaryKey(this._entitySchema);

		this._config = options.config;
	}

	/**
	 * Initialize the PostgreSql environment.
	 * @param nodeLoggingComponentType Optional type of the logging component.
	 * @returns A promise that resolves to a boolean indicating success.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		try {
			const dbConnection = await this.createConnection();

			const databaseExists = await this.databaseExists();
			if (!databaseExists) {
				await nodeLogging?.log({
					level: "info",
					source: PostgreSqlEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "databaseCreating",
					data: {
						databaseName: this._config.database
					}
				});
				await dbConnection.unsafe(`CREATE DATABASE "${this._config.database}";`);
				await this.waitForDatabaseExists();
			} else {
				await nodeLogging?.log({
					level: "info",
					source: PostgreSqlEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "databaseExists",
					data: {
						databaseName: this._config.database
					}
				});
			}

			const tableExists = await this.tableExists();

			if (!tableExists) {
				await nodeLogging?.log({
					level: "info",
					source: PostgreSqlEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "tableCreating",
					data: {
						tableName: this._config.tableName
					}
				});

				const createTableQuery = `CREATE TABLE "${this._config.tableName}" (${this.mapPostgreSqlProperties(this._entitySchema)})`;
				await dbConnection.unsafe(createTableQuery);
				await this.waitForTableExists();
			} else {
				await nodeLogging?.log({
					level: "info",
					source: PostgreSqlEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "tableExists",
					data: {
						tableName: this._config.tableName
					}
				});
			}
		} catch (error) {
			await nodeLogging?.log({
				level: "error",
				source: PostgreSqlEntityStorageConnector.CLASS_NAME,
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
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return PostgreSqlEntityStorageConnector.CLASS_NAME;
	}

	/**
	 * Get the health of the component.
	 * @returns The health of the component.
	 */
	public async health(): Promise<IHealth[]> {
		try {
			const sql = await this.createConnection();
			await sql`SELECT 1 FROM ${sql(this._config.tableName)} LIMIT 0`;
			return [
				{
					source: PostgreSqlEntityStorageConnector.CLASS_NAME,
					status: HealthStatus.Ok,
					description: "healthDescription",
					data: { tableName: this._config.tableName }
				}
			];
		} catch {
			return [
				{
					source: PostgreSqlEntityStorageConnector.CLASS_NAME,
					status: HealthStatus.Error,
					description: "healthDescription",
					message: "connectionFailed",
					data: { tableName: this._config.tableName }
				}
			];
		}
	}

	/**
	 * The component needs to be stopped when the node is closed.
	 * @returns Nothing.
	 */
	public async stop(): Promise<void> {
		if (this._connection) {
			await this._connection.end();
			this._connection = undefined;
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
	 * Get an entity from PostgreSql.
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
		Guards.stringValue(PostgreSqlEntityStorageConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const dbConnection = await this.createConnection();

			const whereClauses: string[] = [];
			const values: unknown[] = [];

			whereClauses.push(`"${PostgreSqlEntityStorageConnector._PARTITION_KEY}" = $1`);
			values.push(partitionKey ?? PostgreSqlEntityStorageConnector._PARTITION_KEY_VALUE);

			if (secondaryIndex) {
				whereClauses.push(`"${String(secondaryIndex)}" = $2`);
				values.push(id);
			} else {
				whereClauses.push(`"${this._primaryKeyProperty.property as string}" = $2`);
				values.push(id);
			}

			if (Is.arrayValue(conditions)) {
				for (const condition of conditions) {
					whereClauses.push(`"${String(condition.property)}" = $${values.length + 1}`);
					values.push(condition.value);
				}
			}

			const query = `SELECT * FROM "${this._config.tableName}" WHERE ${whereClauses.join(" AND ")} LIMIT 1`;

			const rows = await dbConnection.unsafe(query, values as postgres.ParameterOrJSON<never>[]);

			if (Is.array(rows) && rows.length === 1) {
				if (this._entitySchema.properties) {
					for (const prop of this._entitySchema.properties) {
						const row = rows[0] as unknown as { [key: string]: unknown };
						let propColumn = prop.property as string;
						propColumn = propColumn.toLowerCase();

						if (
							(prop.type === EntitySchemaPropertyType.Object ||
								prop.type === EntitySchemaPropertyType.Array) &&
							typeof row[propColumn] === "string"
						) {
							let value: unknown;
							try {
								value = JSON.parse((rows[0] as { [key: string]: unknown })[propColumn] as string);
							} catch {
								// If JSON.parse fails, keep the value as string
								// This handles cases where plain text was stored in Object/Array fields
								value = (rows[0] as { [key: string]: unknown })[propColumn];
							}
							delete (rows[0] as { [key: string]: unknown })[propColumn];
							(rows[0] as { [key: string]: unknown })[prop.property as string] = value;
						}
						if (row[propColumn] === null) {
							(rows[0] as { [key: string]: unknown })[prop.property as string] = undefined;
						}
					}
				}
				return EntityStorageHelper.unPrepareEntity<T>(rows[0] as T, [
					PostgreSqlEntityStorageConnector._PARTITION_KEY
				]);
			}
		} catch (err) {
			throw new GeneralError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
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
		Guards.object<T>(PostgreSqlEntityStorageConnector.CLASS_NAME, nameof(entity), entity);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const prepared = EntityStorageHelper.prepareEntity(
			entity,
			this._entitySchema,
			[
				{
					property: PostgreSqlEntityStorageConnector._PARTITION_KEY,
					value: partitionKey ?? PostgreSqlEntityStorageConnector._PARTITION_KEY_VALUE
				}
			],
			{ nullBehavior: "nullify" }
		);

		const id = prepared[this._primaryKeyProperty.property] as unknown as string;

		try {
			if (Is.arrayValue(conditions)) {
				const itemData = await this.get(id);
				if (Is.notEmpty(itemData) && !this.verifyConditions(conditions, itemData)) {
					return;
				}
			}

			const props = [...(this._entitySchema.properties ?? [])];
			props.unshift({
				property: PostgreSqlEntityStorageConnector._PARTITION_KEY as keyof T,
				type: EntitySchemaPropertyType.String
			});

			const keys: string[] = [];
			const values: unknown[] = [];

			for (const prop of props) {
				keys.push(prop.property as string);
				const val = prepared[prop.property];
				values.push(val ?? null);
			}

			let sql = `INSERT INTO "${this._config.tableName}"`;
			sql += ` (${keys.map(key => `"${key}"`).join(", ")})`;
			sql += ` VALUES (${values.map((value, i) => `$${i + 1}`).join(", ")})`;
			sql += ` ON CONFLICT ("${PostgreSqlEntityStorageConnector._PARTITION_KEY}", "${this._primaryKeyProperty.property as string}")`;
			sql += ` DO UPDATE SET ${keys.map(key => `"${key}" = EXCLUDED."${key}"`).join(", ")};`;

			const dbConnection = await this.createConnection();
			await dbConnection.unsafe(sql, values as ParameterOrJSON<never>[]);
		} catch (err) {
			throw new GeneralError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
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
		Guards.arrayValue(PostgreSqlEntityStorageConnector.CLASS_NAME, nameof(entities), entities);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const preparedEntities = entities.map(entity =>
			EntityStorageHelper.prepareEntity(
				entity,
				this._entitySchema,
				[
					{
						property: PostgreSqlEntityStorageConnector._PARTITION_KEY,
						value: partitionKey ?? PostgreSqlEntityStorageConnector._PARTITION_KEY_VALUE
					}
				],
				{ nullBehavior: "nullify" }
			)
		);

		try {
			const props = [...(this._entitySchema.properties ?? [])];
			props.unshift({
				property: PostgreSqlEntityStorageConnector._PARTITION_KEY as keyof T,
				type: EntitySchemaPropertyType.String
			});
			const keys = props.map(p => p.property as string);

			const allValues: unknown[] = [];
			const rowPlaceholders: string[] = [];

			for (const prepared of preparedEntities) {
				const rowValues: string[] = [];
				for (const prop of props) {
					const val = prepared[prop.property];
					allValues.push(Is.empty(val) ? null : val);
					rowValues.push(`$${allValues.length}`);
				}
				rowPlaceholders.push(`(${rowValues.join(", ")})`);
			}

			let sql = `INSERT INTO "${this._config.tableName}"`;
			sql += ` (${keys.map(key => `"${key}"`).join(", ")})`;
			sql += ` VALUES ${rowPlaceholders.join(", ")}`;
			sql += ` ON CONFLICT ("${PostgreSqlEntityStorageConnector._PARTITION_KEY}", "${this._primaryKeyProperty.property as string}")`;
			sql += ` DO UPDATE SET ${keys.map(key => `"${key}" = EXCLUDED."${key}"`).join(", ")};`;

			const dbConnection = await this.createConnection();
			await dbConnection.unsafe(sql, allValues as ParameterOrJSON<never>[]);
		} catch (err) {
			throw new GeneralError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
				"setBatchFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Empty all the entities.
	 * @returns Nothing.
	 */
	public async empty(): Promise<void> {
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const sql = `DELETE FROM "${this._config.tableName}" WHERE "${PostgreSqlEntityStorageConnector._PARTITION_KEY}" = $1`;
			const dbConnection = await this.createConnection();
			await dbConnection.unsafe(sql, [
				partitionKey ?? PostgreSqlEntityStorageConnector._PARTITION_KEY_VALUE
			]);
		} catch (err) {
			throw new GeneralError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
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
		Guards.stringValue(PostgreSqlEntityStorageConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const dbConnection = await this.createConnection();

			const itemData = await this.get(id);
			if (Is.notEmpty(itemData)) {
				const values: unknown[] = [];
				const whereClauses: string[] = [];

				whereClauses.push(
					`"${this._primaryKeyProperty.property as string}" = $${values.length + 1}`
				);
				values.push(id);

				whereClauses.push(
					`"${PostgreSqlEntityStorageConnector._PARTITION_KEY}" = $${values.length + 1}`
				);
				values.push(partitionKey ?? PostgreSqlEntityStorageConnector._PARTITION_KEY_VALUE);

				if (Is.arrayValue(conditions)) {
					whereClauses.push(
						...conditions.map(condition => {
							values.push(condition.value);
							return `"${String(condition.property)}" = $${values.length}`;
						})
					);
				}

				const query = `DELETE FROM "${this._config.tableName}" WHERE ${whereClauses.join(" AND ")}`;
				await dbConnection.unsafe(query, values as postgres.ParameterOrJSON<never>[]);
			}
		} catch (err) {
			throw new GeneralError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
				"removeFailed",
				{
					id
				},
				err
			);
		}
	}

	/**
	 * Remove multiple entities by their primary key IDs.
	 * @param ids The ids of the entities to remove.
	 * @returns Nothing.
	 */
	public async removeBatch(ids: string[]): Promise<void> {
		Guards.arrayValue(PostgreSqlEntityStorageConnector.CLASS_NAME, nameof(ids), ids);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const sql = `DELETE FROM "${this._config.tableName}" WHERE "${PostgreSqlEntityStorageConnector._PARTITION_KEY}" = $1 AND "${this._primaryKeyProperty.property as string}" = ANY($2)`;
			const dbConnection = await this.createConnection();
			await dbConnection.unsafe(sql, [
				partitionKey ?? PostgreSqlEntityStorageConnector._PARTITION_KEY_VALUE,
				ids
			] as ParameterOrJSON<never>[]);
		} catch (err) {
			throw new GeneralError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
				"removeBatchFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Teardown the entity storage by dropping the table.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the teardown process was successful.
	 */
	public async teardown(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		await nodeLogging?.log({
			level: "info",
			source: PostgreSqlEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "tableDropping",
			data: { tableName: this._config.tableName }
		});

		try {
			const tableExists = await this.tableExists();
			if (tableExists) {
				const dbConnection = await this.createConnection();
				await dbConnection.unsafe(`DROP TABLE "${this._config.tableName}";`);
				await this.waitForTableNotExists();
			}

			await nodeLogging?.log({
				level: "info",
				source: PostgreSqlEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "tableDropped",
				data: { tableName: this._config.tableName }
			});

			return true;
		} catch (err) {
			await nodeLogging?.log({
				level: "error",
				source: PostgreSqlEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "teardownFailed",
				error: BaseError.fromError(err)
			});
			return false;
		}
	}

	/**
	 * Get all the distinct partition context ids from the storage.
	 * @returns An array of context id objects, one per unique partition.
	 */
	public async getPartitionContextIds(): Promise<IContextIds[] | undefined> {
		if (!Is.arrayValue(this._partitionContextIds)) {
			return undefined;
		}
		try {
			const dbConnection = await this.createConnection();
			const rows = await dbConnection.unsafe(
				`SELECT DISTINCT "${PostgreSqlEntityStorageConnector._PARTITION_KEY}" FROM "${this._config.tableName}"`
			);
			return (rows as { [key: string]: string }[])
				.map(row => row[PostgreSqlEntityStorageConnector._PARTITION_KEY])
				.filter((id): id is string => Is.stringValue(id))
				.map(id => ContextIdHelper.shortSplit(this._partitionContextIds ?? [], id));
		} catch (err) {
			throw new GeneralError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
				"getPartitionContextIdsFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Create a new target connector for the migration.
	 * @param entitySchemaName The entity schema name to use for the target connector.
	 * @returns A new connector configured with a migration table name.
	 */
	public async createTargetConnector<U>(
		entitySchemaName: string
	): Promise<PostgreSqlEntityStorageConnector<U>> {
		return new PostgreSqlEntityStorageConnector<U>({
			entitySchema: entitySchemaName,
			config: {
				...this._config,
				tableName: `${this._config.tableName}Migration${Date.now()}`
			},
			partitionContextIds: this._partitionContextIds
		});
	}

	/**
	 * Finalize the migration by renaming the migration table to the original table name.
	 * @param targetConnector The connector pointing to the migration table.
	 * @param options The optional migration options.
	 * @param loggingComponentType The node logging component type.
	 * @returns A connector pointing to the final (renamed) table.
	 */
	public async finalizeMigration<U>(
		targetConnector: PostgreSqlEntityStorageConnector<U>,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<PostgreSqlEntityStorageConnector<U>> {
		// Teardown the existing table with the original name to free up the name for the new table
		await this.teardown(loggingComponentType);

		const dbConnection = await targetConnector.createConnection();
		await dbConnection.unsafe(
			`ALTER TABLE "${targetConnector._config.tableName}" RENAME TO "${this._config.tableName}"`
		);
		const finalConnector = new PostgreSqlEntityStorageConnector<U>({
			entitySchema: targetConnector._entitySchemaName,
			config: this._config,
			partitionContextIds: this._partitionContextIds
		});
		if (await finalConnector.bootstrap(loggingComponentType)) {
			await targetConnector.stop();
			return finalConnector;
		}
		throw new GeneralError(
			PostgreSqlEntityStorageConnector.CLASS_NAME,
			"finalizeMigrationFailedBootstrap",
			undefined
		);
	}

	/**
	 * Clean up the migration by tearing down the migration table.
	 * @param targetConnector The connector pointing to the migration table.
	 * @param options The optional migration options.
	 * @param loggingComponentType The node logging component type.
	 */
	public async cleanupMigration<U>(
		targetConnector?: PostgreSqlEntityStorageConnector<U>,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<void> {
		// If something failed the only thing to cleanup is the migration table
		await targetConnector?.teardown?.(loggingComponentType);
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
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		EntityStorageHelper.validateSortProperties(this._entitySchema, sortProperties);
		EntityStorageHelper.validateProperties(this._entitySchema, properties);
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);

		if (!Is.empty(limit)) {
			const validationFailures: IValidationFailure[] = [];
			Validation.integer(nameof(limit), limit, validationFailures, undefined, { minValue: 1 });
			Validation.asValidationError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
				"query",
				validationFailures
			);
		}

		let sql = "";
		try {
			const returnSize = limit ?? PostgreSqlEntityStorageConnector._DEFAULT_LIMIT;

			let orderByClause: string = "";
			if (Is.arrayValue(sortProperties)) {
				const orderClauses: string[] = [];
				for (const sortProperty of sortProperties) {
					const direction = sortProperty.sortDirection === SortDirection.Ascending ? "ASC" : "DESC";
					orderClauses.push(`"${String(sortProperty.property)}" ${direction}`);
				}
				orderByClause = `ORDER BY ${orderClauses.join(", ")}`;
			}

			const { whereClauses, values } = this.buildWhereClause(conditions, partitionKey);

			const startIndex = Coerce.number(cursor) ?? 0;

			sql = `SELECT ${properties ? properties.map(p => `"${String(p)}"`).join(", ") : "*"} FROM "${this._config.tableName}"`;
			if (whereClauses.length > 0) {
				sql += ` WHERE ${whereClauses.join(" AND ")}`;
			}
			sql += ` ${orderByClause} LIMIT ${returnSize + 1} OFFSET ${startIndex}`;

			const dbConnection = await this.createConnection();
			const rows = await dbConnection.unsafe(sql, values);

			if (this._entitySchema.properties) {
				for (const row of rows) {
					for (const prop of this._entitySchema.properties) {
						let propColumn = prop.property as string;
						propColumn = propColumn.toLowerCase();
						if (
							(prop.type === EntitySchemaPropertyType.Object ||
								prop.type === EntitySchemaPropertyType.Array) &&
							Is.string(row[propColumn])
						) {
							let value: unknown;
							try {
								value = JSON.parse(row[propColumn] as string);
							} catch {
								// If JSON.parse fails, keep the value as string
								// This handles cases where plain text was stored in Object/Array fields
								value = row[propColumn];
							}
							delete row[propColumn];
							row[prop.property as string] = value;
						}
						if (row[propColumn] === null) {
							row[prop.property as string] = undefined;
						}
					}
				}
			}

			const hasMore = Is.array(rows) && rows.length > returnSize;
			const resultRows = hasMore ? rows.slice(0, returnSize) : rows;
			const entities = resultRows as unknown as Partial<T>[];
			for (let i = 0; i < entities.length; i++) {
				entities[i] = EntityStorageHelper.unPrepareEntity(entities[i], [
					PostgreSqlEntityStorageConnector._PARTITION_KEY
				]);
			}

			return {
				entities,
				cursor: hasMore ? Coerce.string(startIndex + returnSize) : undefined
			};
		} catch (err) {
			throw new GeneralError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
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

		let queryStr: string | undefined;
		try {
			const dbConnection = await this.createConnection();

			const contextIds = await ContextIdStore.getContextIds();
			const partitionKey = ContextIdHelper.combinedContextKey(
				contextIds,
				this._partitionContextIds
			);

			const { whereClauses, values } = this.buildWhereClause(conditions, partitionKey);

			queryStr = `SELECT COUNT(*) AS count FROM "${this._config.tableName}"`;
			if (whereClauses.length > 0) {
				queryStr += ` WHERE ${whereClauses.join(" AND ")}`;
			}

			const result = await dbConnection.unsafe(queryStr, values);
			return Number(result[0].count);
		} catch (err) {
			throw new GeneralError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
				"countFailed",
				{ sql: queryStr },
				err
			);
		}
	}

	/**
	 * Check if the database exists.
	 * @returns True if the database exists, false otherwise.
	 * @internal
	 */
	private async databaseExists(): Promise<boolean> {
		try {
			const dbConnection = await this.createConnection();
			const res = await dbConnection.unsafe(
				"SELECT datname FROM pg_catalog.pg_database WHERE datname = $1",
				[this._config.database] as postgres.ParameterOrJSON<never>[]
			);
			return res.length > 0;
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
	 * Check if the table exists.
	 * @returns True if the table exists, false otherwise.
	 * @internal
	 */
	private async tableExists(): Promise<boolean> {
		try {
			const dbConnection = await this.createConnection();
			const res = await dbConnection.unsafe(
				"SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1",
				[this._config.tableName] as postgres.ParameterOrJSON<never>[]
			);
			return res.length > 0;
		} catch {
			return false;
		}
	}

	/**
	 * Wait for a table to exist.
	 * @returns Nothing.
	 * @internal
	 */
	private async waitForTableExists(): Promise<void> {
		for (let attempt = 0; attempt < 20; attempt++) {
			const tableExists = await this.tableExists();
			if (tableExists) {
				break;
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}
	}

	/**
	 * Wait for a table to not exist.
	 * @returns Nothing.
	 * @internal
	 */
	private async waitForTableNotExists(): Promise<void> {
		for (let attempt = 0; attempt < 20; attempt++) {
			const tableExists = await this.tableExists();
			if (!tableExists) {
				break;
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}
	}

	/**
	 * Create a new DB connection.
	 * @returns The PostgreSql connection.
	 * @internal
	 */
	private async createConnection(): Promise<postgres.Sql> {
		if (Is.empty(this._connection)) {
			this._connection = postgres(this.createConnectionConfig());
		}
		return this._connection;
	}

	/**
	 * Create a new DB connection configuration.
	 * @returns The PostgreSql connection configuration.
	 * @internal
	 */
	private createConnectionConfig(): postgres.Options<{ [key: string]: postgres.PostgresType }> {
		return {
			host: this._config.host,
			port: this._config.port ?? 5432,
			user: this._config.user,
			password: this._config.password
		};
	}

	/**
	 * Build where clause arrays for a query, combining partition key and optional conditions.
	 * @param conditions The optional entity conditions to include.
	 * @param partitionKey The partition key value.
	 * @returns The where clauses and bound values.
	 * @internal
	 */
	private buildWhereClause(
		conditions: EntityCondition<T> | undefined,
		partitionKey: string | undefined
	): { whereClauses: string[]; values: ParameterOrJSON<never>[] } {
		const whereClauses: string[] = [];
		const values: ParameterOrJSON<never>[] = [];

		const finalConditions: EntityCondition<T> = {
			conditions: [],
			logicalOperator: LogicalOperator.And
		};

		finalConditions.conditions.push({
			property: PostgreSqlEntityStorageConnector._PARTITION_KEY,
			comparison: ComparisonOperator.Equals,
			value: partitionKey ?? PostgreSqlEntityStorageConnector._PARTITION_KEY_VALUE
		});

		if (!Is.empty(conditions)) {
			finalConditions.conditions.push(conditions);
		}

		this.buildQueryParameters("", finalConditions, whereClauses, values, 1);

		return { whereClauses, values };
	}

	/**
	 * Create an SQL condition clause.
	 * @param objectPath The path for the nested object.
	 * @param condition The conditions to create the query from.
	 * @param whereClauses The where clauses to use in the query.
	 * @param values The values to use in the query.
	 * @param valueIndex The current value index.
	 * @internal
	 */
	private buildQueryParameters(
		objectPath: string,
		condition: EntityCondition<T> | undefined,
		whereClauses: string[],
		values: unknown[],
		valueIndex: number
	): void {
		if (Is.undefined(condition)) {
			return;
		}

		if ("conditions" in condition) {
			if (condition.conditions.length === 0) {
				return;
			}
			const joinConditions: string[] = condition.conditions.map(c => {
				const subWhereClauses: string[] = [];
				const subValues: unknown[] = [];
				this.buildQueryParameters(objectPath, c, subWhereClauses, subValues, valueIndex);
				values.push(...subValues);
				valueIndex += subValues.length;
				return subWhereClauses.join(" AND ");
			});

			const logicalOperator = this.mapConditionalOperator(condition.logicalOperator);
			const queryClause = joinConditions.filter(j => j.length > 0).join(` ${logicalOperator} `);

			if (queryClause.length > 0) {
				whereClauses.push(`(${queryClause})`);
			}
			return;
		}

		const schemaProp = this._entitySchema.properties?.find(p => p.property === condition.property);
		const comparison = this.mapComparisonOperator(
			objectPath,
			condition,
			schemaProp?.type,
			values,
			valueIndex
		);
		whereClauses.push(comparison);
	}

	/**
	 * Map the framework comparison operators to those in MySQL.
	 * @param objectPath The prefix to use for the condition.
	 * @param comparator The operator to map.
	 * @param type The type of the property.
	 * @param values The values to use in the query.
	 * @param valueIndex The current value index.
	 * @returns The comparison expression.
	 * @throws GeneralError if the comparison operator is not supported.
	 * @internal
	 */
	private mapComparisonOperator(
		objectPath: string,
		comparator: IComparator,
		type: EntitySchemaPropertyType | undefined,
		values: unknown[],
		valueIndex: number
	): string {
		let prop = objectPath;
		if (prop.length > 0) {
			prop += ".";
		}

		prop += comparator.property;

		if (comparator.comparison === ComparisonOperator.In) {
			const inValues = Is.array(comparator.value) ? comparator.value : [comparator.value];
			if (inValues.length === 0) {
				// PostgreSQL rejects `IN ()` as a syntax error — short-circuit to a condition
				// that is always false so the query returns zero rows cleanly (#141).
				return "1 = 0";
			}
			values.push(...inValues.map(val => this.propertyToDbValue(val, type)));
			const placeholders = inValues.map((value, index) => `$${valueIndex + index}`).join(", ");
			return `"${prop}" IN (${placeholders})`;
		}

		// null/undefined must use IS NULL / IS NOT NULL — never a parameterised placeholder.
		// Passing undefined through propertyToDbValue() coerces it to NaN for number fields
		// (Number(undefined) === NaN), and null coerces to 0 (Number(null) === 0), both of
		// which produce semantically wrong or invalid SQL.
		if (comparator.value === null || comparator.value === undefined) {
			if (
				comparator.comparison === ComparisonOperator.Equals ||
				comparator.comparison === ComparisonOperator.NotEquals
			) {
				const nullCheck =
					comparator.comparison === ComparisonOperator.Equals ? "IS NULL" : "IS NOT NULL";

				if (comparator.property.split(".").length > 1) {
					const rootProp = comparator.property.split(".")[0];
					const nestedParts = comparator.property.split(".").slice(1);
					const jsonPath = nestedParts
						.map((p, i, arr) => (i === arr.length - 1 ? `->> '${p}'` : `-> '${p}'`))
						.join("");
					const jsonTextExpr = `("${rootProp}"::jsonb ${jsonPath})`;
					return `${jsonTextExpr} ${nullCheck}`;
				}
				return `"${prop}" ${nullCheck}`;
			}
		}

		const dbValue = this.propertyToDbValue(comparator.value, type);
		values.push(dbValue);

		if (comparator.property.split(".").length > 1) {
			const rootProp = comparator.property.split(".")[0];
			const nestedParts = comparator.property.split(".").slice(1);
			const rootSchema = this._entitySchema.properties?.find(p => p.property === rootProp);
			const isArray = rootSchema?.type === EntitySchemaPropertyType.Array;
			const jsonPath = nestedParts
				.map((p, i, arr) => (i === arr.length - 1 ? `->> '${p}'` : `-> '${p}'`))
				.join("");
			const jsonTextExpr = `("${rootProp}"::jsonb ${jsonPath})`;

			switch (comparator.comparison) {
				case ComparisonOperator.Includes: {
					values.pop();
					values.push(`%${String(comparator.value).toLowerCase()}%`);
					if (isArray) {
						const elemPath = nestedParts
							.map((p, i, arr) => (i === arr.length - 1 ? `->>'${p}'` : `->'${p}'`))
							.join("");
						return `EXISTS (SELECT 1 FROM jsonb_array_elements("${rootProp}") elem WHERE LOWER(elem${elemPath}) ILIKE $${valueIndex})`;
					}
					return `LOWER(${jsonTextExpr}) ILIKE $${valueIndex}`;
				}
				case ComparisonOperator.NotIncludes: {
					values.pop();
					values.push(`%${String(comparator.value).toLowerCase()}%`);
					if (isArray) {
						const elemPath = nestedParts
							.map((p, i, arr) => (i === arr.length - 1 ? `->>'${p}'` : `->'${p}'`))
							.join("");
						return `NOT EXISTS (SELECT 1 FROM jsonb_array_elements("${rootProp}") elem WHERE LOWER(elem${elemPath}) ILIKE $${valueIndex})`;
					}
					return `LOWER(${jsonTextExpr}) NOT ILIKE $${valueIndex}`;
				}
				case ComparisonOperator.NotEquals:
					return `${jsonTextExpr} <> $${valueIndex}`;
				case ComparisonOperator.GreaterThan:
					return `${jsonTextExpr} > $${valueIndex}`;
				case ComparisonOperator.LessThan:
					return `${jsonTextExpr} < $${valueIndex}`;
				case ComparisonOperator.GreaterThanOrEqual:
					return `${jsonTextExpr} >= $${valueIndex}`;
				case ComparisonOperator.LessThanOrEqual:
					return `${jsonTextExpr} <= $${valueIndex}`;
				default:
					return `${jsonTextExpr} = $${valueIndex}`;
			}
		}

		switch (comparator.comparison) {
			case ComparisonOperator.Equals:
				if (Is.object(comparator.value) || Is.array(comparator.value)) {
					return `"${prop}" = $${valueIndex}::jsonb`;
				}
				return `"${prop}" = $${valueIndex}`;
			case ComparisonOperator.NotEquals:
				if (Is.object(comparator.value) || Is.array(comparator.value)) {
					return `"${prop}" != $${valueIndex}::jsonb`;
				}
				return `"${prop}" <> $${valueIndex}`;
			case ComparisonOperator.GreaterThan:
				return `"${prop}" > $${valueIndex}`;
			case ComparisonOperator.LessThan:
				return `"${prop}" < $${valueIndex}`;
			case ComparisonOperator.GreaterThanOrEqual:
				return `"${prop}" >= $${valueIndex}`;
			case ComparisonOperator.LessThanOrEqual:
				return `"${prop}" <= $${valueIndex}`;
			case ComparisonOperator.Includes: {
				if (type === EntitySchemaPropertyType.String) {
					return `"${prop}" ILIKE '%' || $${valueIndex} || '%'`;
				}
				if (type === EntitySchemaPropertyType.Array || type === EntitySchemaPropertyType.Object) {
					return `EXISTS (SELECT 1 FROM jsonb_array_elements("${prop}") elem WHERE elem @> $${valueIndex}::jsonb)`;
				}
				throw new GeneralError(
					PostgreSqlEntityStorageConnector.CLASS_NAME,
					"comparisonNotSupported",
					{
						comparison: comparator.comparison,
						type
					}
				);
			}
			case ComparisonOperator.NotIncludes: {
				if (type === EntitySchemaPropertyType.String) {
					return `"${prop}" NOT ILIKE '%' || $${valueIndex} || '%'`;
				}
				if (type === EntitySchemaPropertyType.Array || type === EntitySchemaPropertyType.Object) {
					return `NOT EXISTS (SELECT 1 FROM jsonb_array_elements("${prop}") elem WHERE elem @> $${valueIndex}::jsonb)`;
				}
				throw new GeneralError(
					PostgreSqlEntityStorageConnector.CLASS_NAME,
					"comparisonNotSupported",
					{
						comparison: comparator.comparison,
						type
					}
				);
			}
			default:
				throw new GeneralError(
					PostgreSqlEntityStorageConnector.CLASS_NAME,
					"comparisonNotSupported",
					{
						comparison: comparator.comparison
					}
				);
		}
	}

	/**
	 * Format a value to insert into DB.
	 * @param value The value to format.
	 * @param type The type for the property.
	 * @returns The value after conversion.
	 * @internal
	 */
	private propertyToDbValue(value: unknown, type?: EntitySchemaPropertyType): unknown {
		if (type === EntitySchemaPropertyType.String) {
			return String(value);
		} else if (type === EntitySchemaPropertyType.Number) {
			return Number(value);
		} else if (type === EntitySchemaPropertyType.Boolean) {
			return Boolean(value);
		} else if (
			type === EntitySchemaPropertyType.Object ||
			type === EntitySchemaPropertyType.Array
		) {
			return value;
		}
		return value;
	}

	/**
	 * Map the framework conditional operators to those in MySQL.
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

		throw new GeneralError(PostgreSqlEntityStorageConnector.CLASS_NAME, "conditionalNotSupported", {
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
	 * Map entity schema properties to SQL properties.
	 * @param entitySchema The schema of the entity.
	 * @returns The SQL properties as a string.
	 * @throws GeneralError if the entity properties do not exist.
	 * @internal
	 */
	private mapPostgreSqlProperties(entitySchema: IEntitySchema<T>): string {
		const sqlTypeMap: { [key in EntitySchemaPropertyType]: string } = {
			[EntitySchemaPropertyType.String]: "TEXT",
			[EntitySchemaPropertyType.Number]: "REAL",
			[EntitySchemaPropertyType.Integer]: "INTEGER",
			[EntitySchemaPropertyType.Object]: "JSONB",
			[EntitySchemaPropertyType.Array]: "JSONB",
			[EntitySchemaPropertyType.Boolean]: "BOOLEAN"
		};

		if (!entitySchema.properties) {
			throw new GeneralError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
				"entitySchemaPropertiesUndefined"
			);
		}

		const primaryKeys: string[] = [];

		const props: IEntitySchemaProperty<T>[] = [...entitySchema.properties];

		props.unshift({
			property: PostgreSqlEntityStorageConnector._PARTITION_KEY as keyof T,
			type: EntitySchemaPropertyType.String,
			optional: false,
			isPrimary: true
		});

		const columnDefinitions = props
			.map(prop => {
				let sqlType = sqlTypeMap[prop.type] || "TEXT";
				if (prop.format) {
					switch (prop.type) {
						case EntitySchemaPropertyType.String:
							switch (prop.format) {
								case "uuid":
									sqlType = "UUID";
									break;
							}
							break;
						case EntitySchemaPropertyType.Number:
							switch (prop.format) {
								case "float":
									sqlType = "REAL";
									break;
								case "double":
									sqlType = "DOUBLE PRECISION";
									break;
							}
							break;
						case EntitySchemaPropertyType.Integer:
							switch (prop.format) {
								case "int8":
								case "uint8":
									sqlType = "SMALLINT";
									break;
								case "int16":
									sqlType = "SMALLINT";
									break;
								case "uint16":
								case "int32":
									sqlType = "INTEGER";
									break;
								case "uint32":
								case "int64":
								case "uint64":
									sqlType = "BIGINT";
									break;
							}
							break;
					}
				}
				const columnName = String(prop.property);
				const nullable = prop.optional ? " NULL" : " NOT NULL";

				if (prop.isPrimary) {
					primaryKeys.push(columnName);
				}

				return `"${columnName}" ${sqlType}${nullable}`;
			})
			.join(", ");

		const primaryKeyDefinition =
			primaryKeys.length > 0 ? `, PRIMARY KEY ("${primaryKeys.join('", "')}")` : "";
		return columnDefinitions + primaryKeyDefinition;
	}
}
