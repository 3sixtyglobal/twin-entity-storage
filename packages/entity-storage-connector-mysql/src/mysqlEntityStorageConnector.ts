// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdHelper, ContextIdStore } from "@twin.org/context";
import {
	BaseError,
	Coerce,
	ComponentFactory,
	GeneralError,
	Guards,
	HealthStatus,
	Is,
	ObjectHelper,
	SharedStore,
	type IHealth
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
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { type Pool, type PoolOptions, createPool } from "mysql2/promise";
import type { IMySqlEntityStorageConnectorConfig } from "./models/IMySqlEntityStorageConnectorConfig.js";
import type { IMySqlEntityStorageConnectorConstructorOptions } from "./models/IMySqlEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations using MySql.
 */
export class MySqlEntityStorageConnector<T = unknown> implements IEntityStorageConnector<T> {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<MySqlEntityStorageConnector>();

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
	 * The configuration for the connector.
	 * @internal
	 */
	private readonly _config: IMySqlEntityStorageConnectorConfig;

	/**
	 * The connection pool for MySql.
	 * @internal
	 */
	private _pool?: Pool;

	/**
	 * The primary key property.
	 * @internal
	 */
	private readonly _primaryKeyProperty: IEntitySchemaProperty<T>;

	/**
	 * Create a new instance of MySqlEntityStorageConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IMySqlEntityStorageConnectorConstructorOptions) {
		Guards.object(MySqlEntityStorageConnector.CLASS_NAME, nameof(options), options);
		Guards.stringValue(
			MySqlEntityStorageConnector.CLASS_NAME,
			nameof(options.entitySchema),
			options.entitySchema
		);
		Guards.object<IMySqlEntityStorageConnectorConfig>(
			MySqlEntityStorageConnector.CLASS_NAME,
			nameof(options.config),
			options.config
		);
		Guards.stringValue(
			MySqlEntityStorageConnector.CLASS_NAME,
			nameof(options.config.host),
			options.config.host
		);
		Guards.stringValue(
			MySqlEntityStorageConnector.CLASS_NAME,
			nameof(options.config.user),
			options.config.user
		);
		Guards.stringValue(
			MySqlEntityStorageConnector.CLASS_NAME,
			nameof(options.config.password),
			options.config.password
		);
		Guards.stringValue(
			MySqlEntityStorageConnector.CLASS_NAME,
			nameof(options.config.database),
			options.config.database
		);
		Guards.stringValue(
			MySqlEntityStorageConnector.CLASS_NAME,
			nameof(options.config.tableName),
			options.config.tableName
		);

		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._partitionContextIds = options.partitionContextIds;
		this._primaryKeyProperty = EntitySchemaHelper.getPrimaryKey(this._entitySchema);

		this._config = options.config;
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return MySqlEntityStorageConnector.CLASS_NAME;
	}

	/**
	 * Get the health of the component.
	 * @returns The health of the component.
	 */
	public async health(): Promise<IHealth[]> {
		try {
			await this.getPool().query(
				`SELECT 1 FROM \`${this._config.database}\`.\`${this._config.tableName}\` LIMIT 0`
			);
			return [
				{
					source: MySqlEntityStorageConnector.CLASS_NAME,
					status: HealthStatus.Ok,
					description: "healthDescription"
				}
			];
		} catch {
			return [
				{
					source: MySqlEntityStorageConnector.CLASS_NAME,
					status: HealthStatus.Error,
					description: "healthDescription",
					message: "connectionFailed"
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
	 * Initialize the MySql environment.
	 * @param nodeLoggingComponentType Optional type of the logging component.
	 * @returns A promise that resolves to a boolean indicating success.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		try {
			const pool = this.getPool();

			const databaseExists = await this.databaseExists();
			if (!databaseExists) {
				await nodeLogging?.log({
					level: "info",
					source: MySqlEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "databaseCreating",
					data: {
						databaseName: this._config.database
					}
				});
				await pool.query(`CREATE DATABASE IF NOT EXISTS \`${this._config.database}\``);

				await this.waitForDatabaseExists();
			} else {
				await nodeLogging?.log({
					level: "info",
					source: MySqlEntityStorageConnector.CLASS_NAME,
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
					source: MySqlEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "tableCreating",
					data: {
						tableName: this._config.tableName
					}
				});

				await pool.query(
					`CREATE TABLE IF NOT EXISTS \`${this._config.database}\`.\`${this._config.tableName}\` (${this.mapMySqlProperties()})`
				);

				await this.waitForTableExists();
			} else {
				await nodeLogging?.log({
					level: "info",
					source: MySqlEntityStorageConnector.CLASS_NAME,
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
				source: MySqlEntityStorageConnector.CLASS_NAME,
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
	public async stop(nodeLoggingComponentType?: string): Promise<void> {
		if (this._pool) {
			const poolConfig = this.createPoolConfig();
			const poolId = `${poolConfig.host}|${poolConfig.port}|${poolConfig.user}`;

			let sharedPools = SharedStore.get<{ [id: string]: { pool: Pool; useCounter: number } }>(
				"mySqlPools"
			);
			sharedPools ??= {};
			if (sharedPools[poolId]) {
				// Decrease the use counter and close the pool if no longer used
				sharedPools[poolId].useCounter--;
				if (sharedPools[poolId].useCounter <= 0) {
					await this._pool.end();
					delete sharedPools[poolId];
				}
				SharedStore.set("mySqlPools", sharedPools);
			}

			this._pool = undefined;
		}
	}

	/**
	 * Get an entity from MySql.
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
		Guards.stringValue(MySqlEntityStorageConnector.CLASS_NAME, nameof(id), id);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const pool = this.getPool();

			const whereClauses: string[] = [];
			const values: unknown[] = [];

			whereClauses.push(`\`${MySqlEntityStorageConnector._PARTITION_KEY}\` = ?`);
			values.push(partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE);

			if (secondaryIndex) {
				whereClauses.push(`\`${String(secondaryIndex)}\` = ?`);
			} else {
				whereClauses.push(`\`${String(this._primaryKeyProperty.property)}\` = ?`);
			}
			values.push(id);

			if (Is.arrayValue(conditions)) {
				for (const condition of conditions) {
					whereClauses.push(`\`${String(condition.property)}\` = ?`);
					values.push(condition.value);
				}
			}

			const query = `SELECT * FROM \`${this._config.database}\`.\`${this._config.tableName}\` WHERE ${whereClauses.join(" AND ")} LIMIT 1`;
			const [rows] = await pool.query(query, values);

			if (Is.array(rows) && rows.length === 1) {
				const item = ObjectHelper.removeEmptyProperties(rows[0] as T, { removeNull: true });
				ObjectHelper.propertyDelete(item, MySqlEntityStorageConnector._PARTITION_KEY);
				return item;
			}
		} catch (err) {
			throw new GeneralError(
				MySqlEntityStorageConnector.CLASS_NAME,
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
		Guards.object<T>(MySqlEntityStorageConnector.CLASS_NAME, nameof(entity), entity);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		EntitySchemaHelper.validateEntity(entity, this._entitySchema);

		const id = entity[this._primaryKeyProperty.property] as unknown as string;

		try {
			if (Is.arrayValue(conditions)) {
				const itemData = await this.get(id);
				if (Is.notEmpty(itemData) && !this.verifyConditions(conditions, itemData as T)) {
					return;
				}
			}

			const finalEntity = ObjectHelper.clone(entity);

			const props = [...(this._entitySchema.properties ?? [])];
			props.unshift({
				property: MySqlEntityStorageConnector._PARTITION_KEY as keyof T,
				type: EntitySchemaPropertyType.String
			});

			ObjectHelper.propertySet(
				finalEntity,
				MySqlEntityStorageConnector._PARTITION_KEY,
				partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE
			);

			const keys: string[] = [];
			const values = [];

			for (const prop of props) {
				if (!(Is.empty(finalEntity[prop.property]) && (prop.optional ?? false))) {
					keys.push(prop.property as string);
					if (
						prop.type === EntitySchemaPropertyType.Object ||
						prop.type === EntitySchemaPropertyType.Array
					) {
						values.push(JSON.stringify(finalEntity[prop.property]));
					} else {
						values.push(finalEntity[prop.property]);
					}
				}
			}

			let sql = `INSERT INTO \`${this._config.database}\`.\`${this._config.tableName}\``;
			sql += ` (${keys.map(key => `\`${key}\``).join(", ")})`;
			sql += ` VALUES (${values.map(() => "?").join(", ")})`;
			sql += ` ON DUPLICATE KEY UPDATE ${keys.map(key => `\`${key}\` = VALUES(\`${key}\`)`).join(", ")};`;

			const pool = this.getPool();
			await pool.query(sql, values);
		} catch (err) {
			throw new GeneralError(
				MySqlEntityStorageConnector.CLASS_NAME,
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
		Guards.arrayValue(MySqlEntityStorageConnector.CLASS_NAME, nameof(entities), entities);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		for (const entity of entities) {
			EntitySchemaHelper.validateEntity(entity, this._entitySchema);
		}

		try {
			const props = [...(this._entitySchema.properties ?? [])];
			props.unshift({
				property: MySqlEntityStorageConnector._PARTITION_KEY as keyof T,
				type: EntitySchemaPropertyType.String
			});

			const keys = props.map(p => p.property as string);
			const allValues: unknown[] = [];

			for (const entity of entities) {
				const finalEntity = ObjectHelper.clone(entity);
				ObjectHelper.propertySet(
					finalEntity,
					MySqlEntityStorageConnector._PARTITION_KEY,
					partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE
				);
				for (const prop of props) {
					const val = finalEntity[prop.property];
					if (
						prop.type === EntitySchemaPropertyType.Object ||
						prop.type === EntitySchemaPropertyType.Array
					) {
						allValues.push(Is.empty(val) ? null : JSON.stringify(val));
					} else {
						allValues.push(Is.empty(val) ? null : val);
					}
				}
			}

			const rowPlaceholder = `(${keys.map(() => "?").join(", ")})`;
			let sql = `INSERT INTO \`${this._config.database}\`.\`${this._config.tableName}\``;
			sql += ` (${keys.map(key => `\`${key}\``).join(", ")})`;
			sql += ` VALUES ${entities.map(() => rowPlaceholder).join(", ")}`;
			sql += ` ON DUPLICATE KEY UPDATE ${keys.map(key => `\`${key}\` = VALUES(\`${key}\`)`).join(", ")};`;

			const pool = this.getPool();
			await pool.query(sql, allValues);
		} catch (err) {
			throw new GeneralError(
				MySqlEntityStorageConnector.CLASS_NAME,
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
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const pool = this.getPool();
			await pool.query(
				`DELETE FROM \`${this._config.database}\`.\`${this._config.tableName}\` WHERE \`${MySqlEntityStorageConnector._PARTITION_KEY}\` = ?`,
				[partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE]
			);
		} catch (err) {
			throw new GeneralError(MySqlEntityStorageConnector.CLASS_NAME, "emptyFailed", undefined, err);
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
		Guards.stringValue(MySqlEntityStorageConnector.CLASS_NAME, nameof(id), id);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const pool = this.getPool();

			const itemData = await this.get(id, undefined, conditions);
			if (Is.notEmpty(itemData)) {
				const values: unknown[] = [];
				const whereClauses: string[] = [];

				whereClauses.push(`\`${this._primaryKeyProperty.property as string}\` = ?`);
				values.push(id);

				whereClauses.push(`\`${MySqlEntityStorageConnector._PARTITION_KEY}\` = ?`);
				values.push(partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE);

				if (Is.arrayValue(conditions)) {
					whereClauses.push(
						...conditions.map(condition => {
							values.push(condition.value);
							return `\`${String(condition.property)}\` = ?`;
						})
					);
				}

				const query = `DELETE FROM \`${this._config.database}\`.\`${this._config.tableName}\` WHERE ${whereClauses.join(" AND ")}`;
				await pool.query(query, values);
			}
		} catch (err) {
			throw new GeneralError(
				MySqlEntityStorageConnector.CLASS_NAME,
				"removeFailed",
				{
					id
				},
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
			source: MySqlEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "tableDropping",
			data: { tableName: this._config.tableName }
		});

		try {
			if (await this.tableExists()) {
				const pool = this.getPool();
				await pool.query(`DROP TABLE \`${this._config.database}\`.\`${this._config.tableName}\`;`);
				await this.waitForTableNotExists();
			}

			await nodeLogging?.log({
				level: "info",
				source: MySqlEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "tableDropped",
				data: { tableName: this._config.tableName }
			});

			return true;
		} catch (err) {
			await nodeLogging?.log({
				level: "error",
				source: MySqlEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "teardownFailed",
				error: BaseError.fromError(err)
			});
			return false;
		}
	}

	/**
	 * Remove multiple entities by their primary key IDs.
	 * @param ids The ids of the entities to remove.
	 * @returns Nothing.
	 */
	public async removeBatch(ids: string[]): Promise<void> {
		Guards.arrayValue(MySqlEntityStorageConnector.CLASS_NAME, nameof(ids), ids);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const pool = this.getPool();
			const sql = `DELETE FROM \`${this._config.database}\`.\`${this._config.tableName}\` WHERE \`${MySqlEntityStorageConnector._PARTITION_KEY}\` = ? AND \`${String(this._primaryKeyProperty.property)}\` IN (?)`;
			await pool.query(sql, [
				partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE,
				ids
			]);
		} catch (err) {
			throw new GeneralError(
				MySqlEntityStorageConnector.CLASS_NAME,
				"removeBatchFailed",
				undefined,
				err
			);
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
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		let sql = "";
		try {
			const returnSize = limit ?? MySqlEntityStorageConnector._DEFAULT_LIMIT;

			let orderByClause: string = "";
			if (Is.array(sortProperties)) {
				const orderClauses: string[] = [];
				for (const sortProperty of sortProperties) {
					const direction = sortProperty.sortDirection === SortDirection.Ascending ? "ASC" : "DESC";
					orderClauses.push(`\`${String(sortProperty.property)}\` ${direction}`);
				}
				orderByClause = `ORDER BY ${orderClauses.join(", ")}`;
			}

			const whereClauses: string[] = [];
			const values: unknown[] = [];

			const finalConditions: EntityCondition<T> = {
				conditions: [],
				logicalOperator: LogicalOperator.And
			};

			finalConditions.conditions.push({
				property: MySqlEntityStorageConnector._PARTITION_KEY,
				comparison: ComparisonOperator.Equals,
				value: partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE
			});

			if (!Is.empty(conditions)) {
				finalConditions.conditions.push(conditions);
			}

			this.buildQueryParameters("", finalConditions, whereClauses, values);

			const startIndex = Coerce.number(cursor) ?? 0;

			sql = `SELECT ${properties ? properties.map(p => `\`${String(p)}\``).join(", ") : "*"} FROM \`${this._config.database}\`.\`${this._config.tableName}\``;
			sql += ` WHERE ${whereClauses.join(" AND ")} ${orderByClause}`;
			sql += ` LIMIT ${returnSize} OFFSET ${startIndex}`;

			const pool = this.getPool();
			const [rows] = (await pool.query(sql, values)) ?? [];

			const entities = rows as Partial<T>[];
			for (let i = 0; i < entities.length; i++) {
				entities[i] = ObjectHelper.removeEmptyProperties(entities[i], { removeNull: true });
				ObjectHelper.propertyDelete(entities[i], MySqlEntityStorageConnector._PARTITION_KEY);
			}

			return {
				entities,
				cursor:
					Is.array(rows) && rows.length === returnSize
						? Coerce.string(startIndex + returnSize)
						: undefined
			};
		} catch (err) {
			throw new GeneralError(MySqlEntityStorageConnector.CLASS_NAME, "queryFailed", { sql }, err);
		}
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

			const pool = this.getPool();
			const [rows] = await pool.query(
				`SELECT COUNT(*) AS count FROM \`${this._config.database}\`.\`${this._config.tableName}\` WHERE \`${MySqlEntityStorageConnector._PARTITION_KEY}\` = ?`,
				[partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE]
			);
			return Number((rows as { count: number }[])[0].count);
		} catch (err) {
			throw new GeneralError(MySqlEntityStorageConnector.CLASS_NAME, "countFailed", undefined, err);
		}
	}

	/**
	 * Check if the database exists.
	 * @returns True if the database exists, false otherwise.
	 */
	public async databaseExists(): Promise<boolean> {
		try {
			const pool = this.getPool();
			const [rows] = await pool.query("SHOW DATABASES LIKE ?;", [this._config.database]);
			return Is.arrayValue(rows);
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
			const pool = this.getPool();
			const [rows] = await pool.query("SHOW TABLES FROM ?? LIKE ?", [
				this._config.database,
				this._config.tableName
			]);
			return Is.arrayValue(rows);
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
	 * Get or create the connection pool.
	 * @returns The MySql connection pool.
	 * @internal
	 */
	private getPool(): Pool {
		if (!this._pool) {
			const poolConfig = this.createPoolConfig();
			const poolId = `${poolConfig.host}|${poolConfig.port}|${poolConfig.user}`;

			let sharedPools = SharedStore.get<{ [id: string]: { pool: Pool; useCounter: number } }>(
				"mySqlPools"
			);
			sharedPools ??= {};

			// If there is no pool for the id, create it
			if (!sharedPools[poolId]) {
				sharedPools[poolId] = {
					pool: createPool(poolConfig),
					useCounter: 0
				};
				SharedStore.set("mySqlPools", sharedPools);
			}
			// Increase the use counter and return the pool
			sharedPools[poolId].useCounter++;
			this._pool = sharedPools[poolId].pool;
		}
		return this._pool;
	}

	/**
	 * Create the connection pool configuration.
	 * @returns The MySql pool configuration.
	 * @internal
	 */
	private createPoolConfig(): PoolOptions {
		const poolConfig = this._config.pool ?? {};

		return {
			host: this._config.host,
			port: this._config.port ?? 3306,
			user: this._config.user,
			password: this._config.password,

			connectionLimit: poolConfig.connectionLimit ?? 10,
			maxIdle: poolConfig.maxIdle ?? 10,
			idleTimeout: poolConfig.idleTimeout ?? 60000,
			enableKeepAlive: poolConfig.enableKeepAlive ?? true,
			keepAliveInitialDelay: 0,
			waitForConnections: poolConfig.waitForConnections ?? true,
			queueLimit: poolConfig.queueLimit ?? 0
		};
	}

	/**
	 * Create an SQL condition clause.
	 * @param objectPath The path for the nested object.
	 * @param condition The conditions to create the query from.
	 * @param whereClauses The where clauses to use in the query.
	 * @param values The values to use in the query.
	 * @internal
	 */
	private buildQueryParameters(
		objectPath: string,
		condition: EntityCondition<T> | undefined,
		whereClauses: string[],
		values: unknown[]
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
				this.buildQueryParameters(objectPath, c, subWhereClauses, subValues);
				values.push(...subValues);
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
		const comparison = this.mapComparisonOperator(objectPath, condition, schemaProp?.type, values);
		whereClauses.push(comparison);
	}

	/**
	 * Map the framework comparison operators to those in MySQL.
	 * @param objectPath The prefix to use for the condition.
	 * @param comparator The operator to map.
	 * @param type The type of the property.
	 * @param values The values to use in the query.
	 * @returns The comparison expression.
	 * @throws GeneralError if the comparison operator is not supported.
	 * @internal
	 */
	private mapComparisonOperator(
		objectPath: string,
		comparator: IComparator,
		type: EntitySchemaPropertyType | undefined,
		values: unknown[]
	): string {
		let prop = objectPath;
		if (prop.length > 0) {
			prop += ".";
		}

		prop += comparator.property;

		if (comparator.comparison === ComparisonOperator.In) {
			const inValues = Is.array(comparator.value) ? comparator.value : [comparator.value];
			values.push(...inValues.map(val => this.propertyToDbValue(val, type)));
			const placeholders = inValues.map(() => "?").join(", ");
			return `\`${prop}\` IN (${placeholders})`;
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
					const nestedPath = comparator.property.split(".").slice(1).join(".");
					const rootSchema = this._entitySchema.properties?.find(p => p.property === rootProp);
					const isArray = rootSchema?.type === EntitySchemaPropertyType.Array;
					const jsonPath = isArray ? `$[*].${nestedPath}` : `$.${nestedPath}`;
					const jsonExpr = `JSON_UNQUOTE(JSON_EXTRACT(\`${rootProp}\`, '${jsonPath}'))`;
					return `${jsonExpr} ${nullCheck}`;
				}
				return `\`${prop}\` ${nullCheck}`;
			}
		}

		const dbValue = this.propertyToDbValue(comparator.value, type);
		values.push(dbValue);

		if (comparator.property.split(".").length > 1) {
			const rootProp = comparator.property.split(".")[0];
			const nestedPath = comparator.property.split(".").slice(1).join(".");
			const rootSchema = this._entitySchema.properties?.find(p => p.property === rootProp);
			const isArray = rootSchema?.type === EntitySchemaPropertyType.Array;
			const jsonPath = isArray ? `$[*].${nestedPath}` : `$.${nestedPath}`;
			const jsonExpr = `JSON_UNQUOTE(JSON_EXTRACT(\`${rootProp}\`, '${jsonPath}'))`;

			switch (comparator.comparison) {
				case ComparisonOperator.Includes: {
					values.pop();
					values.push(`%${String(comparator.value).toLowerCase()}%`);
					return `LOWER(${jsonExpr}) LIKE ?`;
				}
				case ComparisonOperator.NotEquals:
					return `${jsonExpr} <> ?`;
				case ComparisonOperator.GreaterThan:
					return `${jsonExpr} > ?`;
				case ComparisonOperator.LessThan:
					return `${jsonExpr} < ?`;
				case ComparisonOperator.GreaterThanOrEqual:
					return `${jsonExpr} >= ?`;
				case ComparisonOperator.LessThanOrEqual:
					return `${jsonExpr} <= ?`;
				default:
					return `${jsonExpr} = ?`;
			}
		}

		switch (comparator.comparison) {
			case ComparisonOperator.Equals:
				if (Is.object(comparator.value) || Is.array(comparator.value)) {
					return `JSON_CONTAINS(\`${prop}\`, ?)`;
				}
				return `\`${prop}\` = ?`;
			case ComparisonOperator.NotEquals:
				if (Is.object(comparator.value) || Is.array(comparator.value)) {
					return `NOT JSON_CONTAINS(\`${prop}\`, ?)`;
				}
				return `\`${prop}\` <> ?`;
			case ComparisonOperator.GreaterThan:
				return `\`${prop}\` > ?`;
			case ComparisonOperator.LessThan:
				return `\`${prop}\` < ?`;
			case ComparisonOperator.GreaterThanOrEqual:
				return `\`${prop}\` >= ?`;
			case ComparisonOperator.LessThanOrEqual:
				return `\`${prop}\` <= ?`;
			case ComparisonOperator.Includes: {
				if (type === EntitySchemaPropertyType.String) {
					values.pop();
					values.push(`%${String(comparator.value).toLowerCase()}%`);
					return `LOWER(\`${prop}\`) LIKE ?`;
				}
				return `JSON_CONTAINS(\`${prop}\`, ?)`;
			}
			default:
				throw new GeneralError(MySqlEntityStorageConnector.CLASS_NAME, "comparisonNotSupported", {
					comparison: comparator.comparison
				});
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
		if (Is.object(value)) {
			return JSON.stringify(value);
		}

		if (type === "string") {
			return String(value);
		} else if (type === "number") {
			return Number(value);
		} else if (type === "boolean") {
			return Boolean(value);
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

		throw new GeneralError(MySqlEntityStorageConnector.CLASS_NAME, "conditionalNotSupported", {
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
	 * Map entity schema properties to SQL properties.
	 * @returns The SQL properties as a string.
	 * @throws GeneralError if the entity properties do not exist.
	 */
	private mapMySqlProperties(): string {
		const sqlTypeMap: { [key in EntitySchemaPropertyType]: string } = {
			[EntitySchemaPropertyType.String]: "LONGTEXT",
			[EntitySchemaPropertyType.Number]: "FLOAT",
			[EntitySchemaPropertyType.Integer]: "INT",
			[EntitySchemaPropertyType.Object]: "JSON",
			[EntitySchemaPropertyType.Array]: "JSON",
			[EntitySchemaPropertyType.Boolean]: "TINYINT(1)"
		};

		if (!this._entitySchema.properties) {
			throw new GeneralError(
				MySqlEntityStorageConnector.CLASS_NAME,
				"entitySchemaPropertiesUndefined"
			);
		}

		const primaryKeys: string[] = [];

		const props: IEntitySchemaProperty<T>[] = [...this._entitySchema.properties];

		props.unshift({
			property: MySqlEntityStorageConnector._PARTITION_KEY as keyof T,
			type: EntitySchemaPropertyType.String,
			isPrimary: true
		});

		const columnDefinitions = props
			.map(prop => {
				let sqlType = sqlTypeMap[prop.type] || "TEXT";
				if (prop.format) {
					switch (prop.type) {
						case "string":
							sqlType = "LONGTEXT";
							switch (prop.format) {
								case "uuid":
									sqlType = "CHAR(36)";
									break;
								case "date":
								case "date-time":
									sqlType = "LONGTEXT";
									break;
							}
							break;
						case "number":
							sqlType = "FLOAT";
							switch (prop.format) {
								case "float":
									sqlType = "FLOAT";
									break;
								case "double":
									sqlType = "DOUBLE";
									break;
							}
							break;
						case "integer":
							sqlType = "INT";
							switch (prop.format) {
								case "int8":
								case "uint8":
									sqlType = "TINYINT";
									break;
								case "int16":
								case "uint16":
									sqlType = "SMALLINT";
									break;
								case "int32":
								case "uint32":
									sqlType = "INT";
									break;
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
					if (sqlType === "LONGTEXT" || sqlType === "TEXT") {
						primaryKeys.push(`\`${columnName}\`(255)`);
					} else {
						primaryKeys.push(`\`${columnName}\``);
					}
				}
				return `\`${columnName}\` ${sqlType}${nullable}`;
			})
			.join(", ");

		const primaryKeyDefinition =
			primaryKeys.length > 0 ? `, PRIMARY KEY (${primaryKeys.join(", ")})` : "";
		return columnDefinitions + primaryKeyDefinition;
	}
}
