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
	Coerce,
	ComponentFactory,
	ConflictError,
	Converter,
	GeneralError,
	Guards,
	Is,
	type IValidationFailure,
	Mutex,
	ObjectHelper,
	RandomHelper,
	Validation
} from "@twin.org/core";
import {
	ComparisonOperator,
	type EntityCondition,
	EntitySchemaFactory,
	EntitySchemaHelper,
	EntitySchemaPropertyFormat,
	EntitySchemaPropertyType,
	type IComparator,
	type IEntitySchema,
	type IEntitySchemaProperty,
	LogicalOperator,
	SortDirection
} from "@twin.org/entity";
import {
	ConnectionHelper,
	EntityStorageHelper,
	IndexHelper,
	MigrationHelper,
	type IEntityStorageConnector,
	type IEntityStorageMigrationConnector,
	type IMigrationOptions
} from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { type Pool, type PoolOptions, createPool } from "mysql2/promise";
import type { IMySqlEntityStorageConnectorConfig } from "./models/IMySqlEntityStorageConnectorConfig.js";
import type { IMySqlEntityStorageConnectorConstructorOptions } from "./models/IMySqlEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations using MySql.
 */
export class MySqlEntityStorageConnector<T = unknown>
	implements IEntityStorageMigrationConnector<T>, IHealthProviderComponent
{
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
	 * Maximum number of rows per INSERT statement in setBatch.
	 * @internal
	 */
	private static readonly _BATCH_CHUNK_SIZE: number = 1000;

	/**
	 * MySQL's maximum identifier length in characters.
	 * @internal
	 */
	private static readonly _MAX_IDENTIFIER_LENGTH: number = 64;

	/**
	 * The largest length which can be expressed as VARCHAR(N), anything above this is stored as LONGTEXT.
	 * A row is limited to 65535 bytes and utf8mb4 uses up to 4 bytes per character.
	 * @internal
	 */
	private static readonly _MAX_VARCHAR_LENGTH: number = 16383;

	/**
	 * The prefix length used when indexing a column which is too long to index in full.
	 * @internal
	 */
	private static readonly _INDEX_PREFIX_LENGTH: number = 255;

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
	private readonly _config: IMySqlEntityStorageConnectorConfig;

	/**
	 * Unique identifier for this connector instance, used to track references in SharedStore.
	 * @internal
	 */
	private readonly _instanceId: string;

	/**
	 * The primary key property.
	 * @internal
	 */
	private readonly _primaryKeyProperty: IEntitySchemaProperty<T>;

	/**
	 * The name of the version property, if any.
	 * @internal
	 */
	private readonly _versionKey?: string;

	/**
	 * Milliseconds to wait for optimistic-lock mutexes before throwing.
	 * @internal
	 */
	private readonly _mutexTimeoutMs?: number;

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
		if (!Is.empty(options.config.pool?.connectionLimit)) {
			Guards.integer(
				MySqlEntityStorageConnector.CLASS_NAME,
				nameof(options.config.pool?.connectionLimit),
				options.config.pool?.connectionLimit
			);
		}
		if (!Is.empty(options.config.pool?.maxIdle)) {
			Guards.integer(
				MySqlEntityStorageConnector.CLASS_NAME,
				nameof(options.config.pool?.maxIdle),
				options.config.pool?.maxIdle
			);
		}
		if (!Is.empty(options.config.pool?.idleTimeout)) {
			Guards.integer(
				MySqlEntityStorageConnector.CLASS_NAME,
				nameof(options.config.pool?.idleTimeout),
				options.config.pool?.idleTimeout
			);
		}
		if (!Is.empty(options.config.pool?.queueLimit)) {
			Guards.integer(
				MySqlEntityStorageConnector.CLASS_NAME,
				nameof(options.config.pool?.queueLimit),
				options.config.pool?.queueLimit
			);
		}
		if (!Is.empty(options.config.pool?.enableKeepAlive)) {
			Guards.boolean(
				MySqlEntityStorageConnector.CLASS_NAME,
				nameof(options.config.pool?.enableKeepAlive),
				options.config.pool?.enableKeepAlive
			);
		}
		if (!Is.empty(options.config.pool?.waitForConnections)) {
			Guards.boolean(
				MySqlEntityStorageConnector.CLASS_NAME,
				nameof(options.config.pool?.waitForConnections),
				options.config.pool?.waitForConnections
			);
		}

		this._entitySchemaName = options.entitySchema;
		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._partitionContextIds = options.partitionContextIds;
		this._primaryKeyProperty = EntitySchemaHelper.getPrimaryKey(this._entitySchema);
		this._versionKey = EntitySchemaHelper.findVersionProperty(this._entitySchema);

		this._config = options.config;
		this._mutexTimeoutMs = Coerce.integer(options.config.mutexTimeoutMs);
		this._instanceId = RandomHelper.generateUuidV7("compact");
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return MySqlEntityStorageConnector.CLASS_NAME;
	}

	/**
	 * Returns the health status of the component.
	 * @returns The health status of the component.
	 */
	public async health(): Promise<IHealth[]> {
		try {
			const pool = await this.getPool();
			await pool.query(
				`SELECT 1 FROM \`${this._config.database}\`.\`${this._config.tableName}\` LIMIT 0`
			);
			return [
				{
					source: MySqlEntityStorageConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Ok,
					description: "healthDescription",
					data: { database: this._config.database, tableName: this._config.tableName }
				}
			];
		} catch {
			return [
				{
					source: MySqlEntityStorageConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Error,
					description: "healthDescription",
					message: "connectionFailed",
					data: { database: this._config.database, tableName: this._config.tableName }
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

		let pool: Pool;
		try {
			pool = await this.getPool();

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

		try {
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

			for (const prop of this._entitySchema.properties ?? []) {
				if (
					(prop.isSecondary === true || !Is.empty(prop.sortDirection)) &&
					prop.type !== EntitySchemaPropertyType.Object &&
					prop.type !== EntitySchemaPropertyType.Array
				) {
					await this.ensureIndex(pool, prop, nodeLogging);
				}
			}
		} catch (error) {
			await nodeLogging?.log({
				level: "error",
				source: MySqlEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "tableCreateFailed",
				error: BaseError.fromError(error),
				data: {
					tableName: this._config.tableName
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
		await ConnectionHelper.closeClient<Pool>(
			"mySqlPools",
			this.createClientId(),
			this._instanceId,
			this._mutexTimeoutMs,
			async pool => pool.end()
		);
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

		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const pool = await this.getPool();

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
				const item = EntityStorageHelper.unPrepareEntity<T>(rows[0] as T, [
					MySqlEntityStorageConnector._PARTITION_KEY
				]);
				return this.coerceEntityTypes(item) as T;
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
	 * @throws ConflictError when the entity exists but the supplied conditions or version do not match the stored state.
	 */
	public async set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void> {
		Guards.object<T>(MySqlEntityStorageConnector.CLASS_NAME, nameof(entity), entity);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const submittedVersion = Is.stringValue(this._versionKey)
			? ObjectHelper.propertyGet<number>(entity, this._versionKey)
			: undefined;
		const hasVersionCheck =
			!Is.empty(this._versionKey) && !Is.empty(submittedVersion) && submittedVersion > 0;

		const prepared = EntityStorageHelper.prepareEntity(
			entity,
			this._entitySchema,
			[
				{
					property: MySqlEntityStorageConnector._PARTITION_KEY,
					value: partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE
				}
			],
			{ nullBehavior: "nullify" }
		);

		const id = prepared[this._primaryKeyProperty.property] as unknown as string;
		const optimisticMutexKey =
			Is.stringValue(this._versionKey) || Is.arrayValue(conditions)
				? this.buildOptimisticMutexKey(partitionKey, id)
				: undefined;

		if (Is.stringValue(optimisticMutexKey)) {
			await Mutex.lock(optimisticMutexKey, {
				throwOnTimeout: true,
				timeoutMs: this._mutexTimeoutMs
			});
		}

		try {
			if (hasVersionCheck) {
				if (Is.arrayValue(conditions)) {
					const currentEntity = await this.get(id);
					if (!Is.empty(currentEntity) && !this.verifyConditions(conditions, currentEntity)) {
						throw new ConflictError(MySqlEntityStorageConnector.CLASS_NAME, "conditionFailed", id);
					}
				}
				ObjectHelper.propertySet(prepared, this._versionKey, submittedVersion + 1);
			} else if (this._versionKey || Is.arrayValue(conditions)) {
				const currentEntity = await this.get(id);
				if (!Is.empty(currentEntity)) {
					if (Is.arrayValue(conditions) && !this.verifyConditions(conditions, currentEntity)) {
						if (Is.stringValue(this._versionKey)) {
							throw new ConflictError(
								MySqlEntityStorageConnector.CLASS_NAME,
								"conditionFailed",
								id
							);
						}
						return;
					}
				}
				if (Is.stringValue(this._versionKey)) {
					const storedVersion = !Is.empty(currentEntity)
						? (ObjectHelper.propertyGet<number>(currentEntity, this._versionKey) ?? 0)
						: 0;
					ObjectHelper.propertySet(prepared, this._versionKey, storedVersion + 1);
				}
			}

			const props = [...(this._entitySchema.properties ?? [])];
			props.unshift({
				property: MySqlEntityStorageConnector._PARTITION_KEY as keyof T,
				type: EntitySchemaPropertyType.String
			});

			const keys: string[] = [];
			const values = [];

			for (const prop of props) {
				keys.push(prop.property as string);
				const val = prepared[prop.property];
				if (val === null || val === undefined) {
					values.push(null);
				} else if (
					prop.type === EntitySchemaPropertyType.Object ||
					prop.type === EntitySchemaPropertyType.Array
				) {
					values.push(JSON.stringify(val));
				} else {
					values.push(val);
				}
			}

			const pool = await this.getPool();

			if (hasVersionCheck) {
				const updateSql = `UPDATE \`${this._config.database}\`.\`${this._config.tableName}\` SET ${keys.map(key => `\`${key}\` = ?`).join(", ")} WHERE \`${this._primaryKeyProperty.property as string}\` = ? AND \`${MySqlEntityStorageConnector._PARTITION_KEY}\` = ? AND \`${this._versionKey}\` = ?`;
				const updateValues = [
					...values,
					id,
					partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE,
					submittedVersion
				];
				const [result] = (await pool.query(updateSql, updateValues)) as unknown as [
					{ affectedRows: number }
				];
				if (result.affectedRows === 0) {
					throw new ConflictError(
						MySqlEntityStorageConnector.CLASS_NAME,
						"optimisticLockFailed",
						id
					);
				}
			} else {
				let sql = `INSERT INTO \`${this._config.database}\`.\`${this._config.tableName}\``;
				sql += ` (${keys.map(key => `\`${key}\``).join(", ")})`;
				sql += ` VALUES (${values.map(() => "?").join(", ")})`;
				sql += ` ON DUPLICATE KEY UPDATE ${keys.map(key => `\`${key}\` = VALUES(\`${key}\`)`).join(", ")};`;

				await pool.query(sql, values);
			}
		} catch (err) {
			if (BaseError.isErrorName(err, ConflictError.CLASS_NAME)) {
				throw err;
			}
			throw new GeneralError(
				MySqlEntityStorageConnector.CLASS_NAME,
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
		Guards.arrayValue(MySqlEntityStorageConnector.CLASS_NAME, nameof(entities), entities);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const preparedEntities = entities.map(entity =>
			EntityStorageHelper.prepareEntity(
				entity,
				this._entitySchema,
				[
					{
						property: MySqlEntityStorageConnector._PARTITION_KEY,
						value: partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE
					}
				],
				{ nullBehavior: "nullify" }
			)
		);

		try {
			const props = [...(this._entitySchema.properties ?? [])];
			props.unshift({
				property: MySqlEntityStorageConnector._PARTITION_KEY as keyof T,
				type: EntitySchemaPropertyType.String
			});

			const keys = props.map(p => p.property as string);
			const rowPlaceholder = `(${keys.map(() => "?").join(", ")})`;
			const columnList = `(${keys.map(key => `\`${key}\``).join(", ")})`;
			const updateClause = keys.map(key => `\`${key}\` = VALUES(\`${key}\`)`).join(", ");
			const baseInsert = `INSERT INTO \`${this._config.database}\`.\`${this._config.tableName}\` ${columnList} VALUES `;
			const onDuplicate = ` ON DUPLICATE KEY UPDATE ${updateClause};`;

			const pool = await this.getPool();
			const chunkSize = MySqlEntityStorageConnector._BATCH_CHUNK_SIZE;

			for (let offset = 0; offset < preparedEntities.length; offset += chunkSize) {
				const chunk = preparedEntities.slice(offset, offset + chunkSize);
				const chunkValues: unknown[] = [];

				for (const prepared of chunk) {
					for (const prop of props) {
						const val = prepared[prop.property];
						if (
							prop.type === EntitySchemaPropertyType.Object ||
							prop.type === EntitySchemaPropertyType.Array
						) {
							chunkValues.push(Is.empty(val) ? null : JSON.stringify(val));
						} else {
							chunkValues.push(Is.empty(val) ? null : val);
						}
					}
				}

				await pool.query(
					`${baseInsert}${chunk.map(() => rowPlaceholder).join(", ")}${onDuplicate}`,
					chunkValues
				);
			}
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
			const pool = await this.getPool();
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

		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);
		const optimisticMutexKey =
			Is.stringValue(this._versionKey) || Is.arrayValue(conditions)
				? this.buildOptimisticMutexKey(partitionKey, id)
				: undefined;

		if (Is.stringValue(optimisticMutexKey)) {
			await Mutex.lock(optimisticMutexKey, {
				throwOnTimeout: true,
				timeoutMs: this._mutexTimeoutMs
			});
		}

		try {
			const pool = await this.getPool();

			const itemData = await this.get(id);
			if (!Is.empty(itemData)) {
				if (Is.arrayValue(conditions) && !this.verifyConditions(conditions, itemData)) {
					if (Is.stringValue(this._versionKey)) {
						throw new ConflictError(MySqlEntityStorageConnector.CLASS_NAME, "conditionFailed", id);
					}
					return;
				}

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
			if (BaseError.isErrorName(err, ConflictError.CLASS_NAME)) {
				throw err;
			}
			throw new GeneralError(
				MySqlEntityStorageConnector.CLASS_NAME,
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
				const pool = await this.getPool();
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
			const pool = await this.getPool();
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

		EntityStorageHelper.validateSortProperties(this._entitySchema, sortProperties);
		EntityStorageHelper.validateProperties(this._entitySchema, properties);
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);

		if (!Is.empty(limit)) {
			const validationFailures: IValidationFailure[] = [];
			Validation.integer(nameof(limit), limit, validationFailures, undefined, { minValue: 1 });
			Validation.asValidationError(
				MySqlEntityStorageConnector.CLASS_NAME,
				"query",
				validationFailures
			);
		}

		let sql = "";
		try {
			const returnSize = limit ?? MySqlEntityStorageConnector._DEFAULT_LIMIT;

			const pkPropName = String(this._primaryKeyProperty.property);

			// Decide whether the caller's sort already includes the PK.  When it does we
			// skip appending a second PK clause so we never emit "ORDER BY id ..., id ...".
			const sortsByPK =
				Is.array(sortProperties) && sortProperties.some(s => String(s.property) === pkPropName);

			// Full ordered column list used for both ORDER BY and the keySet condition.
			// Format: [user sort cols…] + [pk tie-breaker if not already present].
			const keySetCols: { prop: string; asc: boolean }[] = [];
			if (Is.array(sortProperties)) {
				for (const s of sortProperties) {
					keySetCols.push({
						prop: String(s.property),
						asc: s.sortDirection === SortDirection.Ascending
					});
				}
			}
			if (!sortsByPK) {
				keySetCols.push({ prop: pkPropName, asc: true });
			}

			// When the caller projects specific columns we must still SELECT the PK and any
			// sort columns so we can build the next-page cursor.  Track which columns we add
			// internally so we can strip them from the returned entities afterward.
			const requestedProps = properties ? new Set(properties.map(p => String(p))) : undefined;
			const internallyAdded = new Set<string>();

			let selectClause: string;
			if (requestedProps) {
				const selectSet = new Set(requestedProps);
				for (const col of keySetCols) {
					if (!selectSet.has(col.prop)) {
						selectSet.add(col.prop);
						internallyAdded.add(col.prop);
					}
				}
				selectClause = [...selectSet].map(p => `\`${p}\``).join(", ");
			} else {
				selectClause = "*";
			}

			const orderByClause = `ORDER BY ${keySetCols.map(c => `\`${c.prop}\` ${c.asc ? "ASC" : "DESC"}`).join(", ")}`;

			const { whereClauses, values } = this.buildWhereClause(conditions, partitionKey);

			// Apply keySet condition when continuing from a previous page.
			if (Is.stringBase64(cursor)) {
				const parsedCursor = ObjectHelper.fromBytes<{ i: string; sv?: unknown[] }>(
					Converter.base64ToBytes(cursor)
				);

				// Reconstruct the ordered last-value list: [sort-col values…, pk].
				const lastValues: unknown[] = [...(parsedCursor.sv ?? []), parsedCursor.i];

				// Build: (col0 op last0) OR (col0=last0 AND col1 op last1) OR …
				const orParts: string[] = [];
				for (let i = 0; i < keySetCols.length; i++) {
					const parts: string[] = [];
					for (let j = 0; j < i; j++) {
						values.push(lastValues[j]);
						parts.push(`\`${keySetCols[j].prop}\` = ?`);
					}
					const op = keySetCols[i].asc ? ">" : "<";
					values.push(lastValues[i]);
					parts.push(`\`${keySetCols[i].prop}\` ${op} ?`);
					orParts.push(parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`);
				}
				whereClauses.push(`(${orParts.join(" OR ")})`);
			}

			sql = `SELECT ${selectClause} FROM \`${this._config.database}\`.\`${this._config.tableName}\``;
			if (whereClauses.length > 0) {
				sql += ` WHERE ${whereClauses.join(" AND ")}`;
			}
			sql += ` ${orderByClause} LIMIT ${returnSize + 1}`;

			const pool = await this.getPool();
			const [rows] = (await pool.query(sql, values)) ?? [];

			const hasMore = Is.array(rows) && rows.length > returnSize;
			const resultRows = hasMore ? (rows as unknown[]).slice(0, returnSize) : rows;
			const entities = resultRows as Partial<T>[];

			// Build the next-page cursor from the last returned row before stripping columns.
			let nextCursor: string | undefined;
			if (hasMore && entities.length > 0) {
				const lastRow = entities[entities.length - 1];
				// Sort values are all keySet columns except the final PK entry.
				const sortValues = keySetCols
					.slice(0, -1)
					.map(c => ObjectHelper.propertyGet(lastRow, c.prop));
				const lastId = ObjectHelper.propertyGet<string>(lastRow, pkPropName);

				if (Is.stringValue(lastId)) {
					const cursorData: { i: string; sv?: unknown[] } =
						sortValues.length > 0 ? { i: lastId, sv: sortValues } : { i: lastId };
					nextCursor = Converter.bytesToBase64(ObjectHelper.toBytes(cursorData));
				}
			}

			for (let i = 0; i < entities.length; i++) {
				entities[i] = EntityStorageHelper.unPrepareEntity(entities[i], [
					MySqlEntityStorageConnector._PARTITION_KEY
				]);
				// Remove any columns we added internally for cursor purposes.
				for (const col of internallyAdded) {
					ObjectHelper.propertyDelete(entities[i], col);
				}
				entities[i] = this.coerceEntityTypes(entities[i]);
			}

			return { entities, cursor: nextCursor };
		} catch (err) {
			throw new GeneralError(MySqlEntityStorageConnector.CLASS_NAME, "queryFailed", { sql }, err);
		}
	}

	/**
	 * Count all the entities which match the conditions.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The total count of entities in the storage.
	 */
	public async count(conditions?: EntityCondition<T>): Promise<number> {
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);

		let sql: string | undefined;
		try {
			const pool = await this.getPool();

			const contextIds = await ContextIdStore.getContextIds();
			const partitionKey = ContextIdHelper.combinedContextKey(
				contextIds,
				this._partitionContextIds
			);

			const { whereClauses, values } = this.buildWhereClause(conditions, partitionKey);

			sql = `SELECT COUNT(*) AS count FROM \`${this._config.database}\`.\`${this._config.tableName}\``;
			if (whereClauses.length > 0) {
				sql += ` WHERE ${whereClauses.join(" AND ")}`;
			}

			const [rows] = await pool.query(sql, values);
			return Number((rows as { count: number }[])[0].count);
		} catch (err) {
			throw new GeneralError(MySqlEntityStorageConnector.CLASS_NAME, "countFailed", { sql }, err);
		}
	}

	/**
	 * Get all unique partition context ids present in the table.
	 * @param loggingComponentType The optional component type to use for logging skipped partition ids.
	 * @returns An array of context id objects, one per unique partition.
	 */
	public async getPartitionContextIds(
		loggingComponentType?: string
	): Promise<IContextIds[] | undefined> {
		if (!Is.arrayValue(this._partitionContextIds)) {
			return undefined;
		}

		try {
			const pool = await this.getPool();
			const [rows] = await pool.query(
				`SELECT DISTINCT \`${MySqlEntityStorageConnector._PARTITION_KEY}\` FROM \`${this._config.database}\`.\`${this._config.tableName}\``
			);
			const partitionIds = (rows as { [key: string]: string }[])
				.map(row => row[MySqlEntityStorageConnector._PARTITION_KEY])
				.filter((id): id is string => Is.stringValue(id));
			const contextIds: IContextIds[] = [];
			const skipped: string[] = [];
			for (const partitionId of partitionIds) {
				const split = EntityStorageHelper.tryShortSplit(
					this._partitionContextIds ?? [],
					partitionId
				);
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
					source: MySqlEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "partitionIdsSkipped",
					data: {
						expected: this._partitionContextIds?.length,
						partitionIds: skipped.join(", ")
					}
				});
			}
			return contextIds;
		} catch (err) {
			throw new GeneralError(
				MySqlEntityStorageConnector.CLASS_NAME,
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
		return 1;
	}

	/**
	 * Create the target connector for performing the migration using a temporary table.
	 * @param newEntitySchema The name of the new entity schema to create the connector for.
	 * @returns Connector for performing the migration.
	 */
	public async createTargetConnector<U>(
		newEntitySchema: string
	): Promise<IEntityStorageConnector<U>> {
		const migrationTableName = MigrationHelper.generateTargetName(
			this._config.tableName,
			MySqlEntityStorageConnector._MAX_IDENTIFIER_LENGTH
		);
		return new MySqlEntityStorageConnector<U>({
			entitySchema: newEntitySchema,
			config: {
				...this._config,
				tableName: migrationTableName
			},
			partitionContextIds: this._partitionContextIds
		});
	}

	/**
	 * Finalize the migration by dropping the source table and renaming the migration table to the original name.
	 * @param targetConnector The connector holding the migrated data in a temporary table.
	 * @param options The options to control how the migration is finalized.
	 * @param loggingComponentType The logging component type to use during finalization.
	 * @returns The final connector using the original table name with the new schema.
	 */
	public async finalizeMigration<U>(
		targetConnector: MySqlEntityStorageConnector<U>,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<MySqlEntityStorageConnector<U>> {
		// Teardown the existing table with the original name to free up the name for the new table
		await this.teardown(loggingComponentType);

		// RENAME TABLE is an atomic metadata-only operation in MySQL - no data copying needed.
		const pool = await this.getPool();
		await pool.query(
			`RENAME TABLE \`${targetConnector._config.database}\`.\`${targetConnector._config.tableName}\` TO \`${this._config.database}\`.\`${this._config.tableName}\``
		);

		const finalConnector = new MySqlEntityStorageConnector<U>({
			entitySchema: targetConnector._entitySchemaName,
			config: this._config,
			partitionContextIds: this._partitionContextIds
		});

		if (await finalConnector.bootstrap(loggingComponentType)) {
			await targetConnector.stop();
			return finalConnector;
		}

		throw new GeneralError(
			MySqlEntityStorageConnector.CLASS_NAME,
			"finalizeMigrationFailedBootstrap",
			undefined
		);
	}

	/**
	 * Cleanup a failed or aborted migration by dropping the temporary migration table.
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
		// If something failed the only thing to cleanup is the migration table
		await targetConnector?.teardown?.(loggingComponentType);
	}

	/**
	 * Check if the database exists.
	 * @returns True if the database exists, false otherwise.
	 */
	public async databaseExists(): Promise<boolean> {
		try {
			const pool = await this.getPool();
			const [rows] = await pool.query("SHOW DATABASES LIKE ?;", [this._config.database]);
			return Is.arrayValue(rows);
		} catch {
			return false;
		}
	}

	/**
	 * Coerce MySQL raw row values back to proper TypeScript types based on the entity schema.
	 * MySQL returns TINYINT(1) as 0/1 rather than false/true; this method converts those.
	 * @param entity The raw entity row from MySQL.
	 * @returns The entity with schema-correct types.
	 * @internal
	 */
	private coerceEntityTypes(entity: Partial<T>): Partial<T> {
		for (const prop of this._entitySchema.properties ?? []) {
			const value = entity[prop.property];
			if (prop.type === EntitySchemaPropertyType.Boolean && !Is.empty(value)) {
				ObjectHelper.propertySet(entity, prop.property as string, Boolean(value));
			}
		}
		return entity;
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
	 * Ensure the secondary index for a property exists, replacing a legacy-named index if present.
	 * @param pool The pool to query with.
	 * @param prop The indexed property.
	 * @param nodeLogging Optional logging component.
	 * @internal
	 */
	private async ensureIndex(
		pool: Pool,
		prop: IEntitySchemaProperty<T>,
		nodeLogging?: ILoggingComponent
	): Promise<void> {
		const columnName = String(prop.property);
		const indexCol = this.indexColumn(columnName, this.mapSqlColumn(prop).indexPrefixLength);
		const indexName = IndexHelper.generateName(this._config.tableName, columnName);
		const qualifiedTable = `\`${this._config.database}\`.\`${this._config.tableName}\``;

		const [indexRows] = await pool.query(
			"SELECT DISTINCT index_name AS indexName FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema = ? AND table_name = ? AND column_name = ? AND seq_in_index = 1 AND is_visible = 'YES' AND index_type = 'BTREE'",
			[this._config.database, this._config.tableName, columnName]
		);
		const indexNames = Is.array(indexRows)
			? indexRows.map(row => ObjectHelper.propertyGet<string>(row, "indexName"))
			: [];

		if (!Is.arrayValue(indexNames)) {
			await pool.query(`CREATE INDEX \`${indexName}\` ON ${qualifiedTable} (${indexCol})`);
			return;
		}

		// TODO: remove the legacy index handling once every installation has bootstrapped on a release that contains it
		const legacyName = IndexHelper.generateLegacyName(this._config.tableName, columnName);
		if (!indexNames.includes(legacyName)) {
			return;
		}

		// The connector's own legacy indexes were always non-unique and single-column, anything else is an operator's
		const [legacyRows] = await pool.query(
			"SELECT MAX(non_unique) AS nonUnique, COUNT(1) AS keyColumnCount FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema = ? AND table_name = ? AND index_name = ?",
			[this._config.database, this._config.tableName, legacyName]
		);
		const legacyRow = Is.array(legacyRows) ? legacyRows[0] : undefined;
		if (
			!Is.object(legacyRow) ||
			Coerce.integer(ObjectHelper.propertyGet(legacyRow, "nonUnique")) !== 1 ||
			Coerce.integer(ObjectHelper.propertyGet(legacyRow, "keyColumnCount")) !== 1
		) {
			return;
		}

		const hasCurrent = indexNames.includes(indexName);
		if (hasCurrent) {
			await pool.query(`DROP INDEX \`${legacyName}\` ON ${qualifiedTable}`);
		} else {
			await pool.query(
				`ALTER TABLE ${qualifiedTable} RENAME INDEX \`${legacyName}\` TO \`${indexName}\``
			);
		}
		await nodeLogging?.log({
			level: "info",
			source: MySqlEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: hasCurrent ? "legacyIndexDropped" : "legacyIndexRenamed",
			data: {
				tableName: this._config.tableName,
				indexName: legacyName,
				newIndexName: indexName
			}
		});
	}

	/**
	 * Check if the table exists.
	 * @returns True if the table exists, false otherwise.
	 * @internal
	 */
	private async tableExists(): Promise<boolean> {
		try {
			const pool = await this.getPool();
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
	 * Get or create the shared connection pool for this endpoint.
	 * @returns The MySql connection pool.
	 * @internal
	 */
	private async getPool(): Promise<Pool> {
		return ConnectionHelper.openClient<Pool>(
			"mySqlPools",
			this.createClientId(),
			this._instanceId,
			this._mutexTimeoutMs,
			async () => createPool(this.createPoolConfig())
		);
	}

	/**
	 * Build a stable cache key for the shared pool based on connection parameters.
	 * @returns The pool cache key.
	 * @internal
	 */
	private createClientId(): string {
		return `${this._config.host}|${this._config.port ?? 3306}|${this._config.user}`;
	}

	/**
	 * Create the connection pool configuration.
	 * @returns The MySql pool configuration.
	 * @internal
	 */
	private createPoolConfig(): PoolOptions {
		return {
			host: this._config.host,
			port: this._config.port,
			user: this._config.user,
			password: this._config.password,

			connectionLimit: this._config.pool?.connectionLimit ?? 20,
			maxIdle: this._config.pool?.maxIdle,
			idleTimeout: this._config.pool?.idleTimeout,
			enableKeepAlive: this._config.pool?.enableKeepAlive,
			waitForConnections: this._config.pool?.waitForConnections,
			queueLimit: this._config.pool?.queueLimit
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
	): { whereClauses: string[]; values: unknown[] } {
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

		return { whereClauses, values };
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
			if (inValues.length === 0) {
				// MySQL rejects `IN ()` as a syntax error - short-circuit to a condition
				// that is always false so the query returns zero rows cleanly (#141).
				return "1 = 0";
			}
			values.push(...inValues.map(val => this.propertyToDbValue(val, type)));
			const placeholders = inValues.map(() => "?").join(", ");
			return `\`${prop}\` IN (${placeholders})`;
		}

		// null/undefined must use IS NULL / IS NOT NULL - never a parameterised placeholder.
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
				values.pop();
				values.push(JSON.stringify(comparator.value));
				return `JSON_CONTAINS(\`${prop}\`, ?)`;
			}
			case ComparisonOperator.NotIncludes: {
				if (type === EntitySchemaPropertyType.String) {
					values.pop();
					values.push(`%${String(comparator.value).toLowerCase()}%`);
					return `LOWER(\`${prop}\`) NOT LIKE ?`;
				}
				values.pop();
				values.push(JSON.stringify(comparator.value));
				return `NOT JSON_CONTAINS(\`${prop}\`, ?)`;
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
			return value ? 1 : 0;
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
		return `${MySqlEntityStorageConnector.CLASS_NAME}:optimistic:${this._config.database}:${this._config.tableName}:${partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE}:${id}`;
	}

	/**
	 * Map entity schema properties to SQL properties.
	 * @param schema The schema to use, defaults to the connector's own schema.
	 * @returns The SQL properties as a string.
	 * @throws GeneralError if the entity properties do not exist.
	 * @internal
	 */
	private mapMySqlProperties(schema?: IEntitySchema<T>): string {
		const entitySchema = schema ?? this._entitySchema;

		if (!entitySchema.properties) {
			throw new GeneralError(
				MySqlEntityStorageConnector.CLASS_NAME,
				"entitySchemaPropertiesUndefined"
			);
		}

		const primaryKeys: string[] = [];

		const props: IEntitySchemaProperty<T>[] = [...entitySchema.properties];

		props.unshift({
			property: MySqlEntityStorageConnector._PARTITION_KEY as keyof T,
			type: EntitySchemaPropertyType.String,
			isPrimary: true
		});

		const columnDefinitions = props
			.map(prop => {
				const { sqlType, indexPrefixLength } = this.mapSqlColumn(prop);
				const columnName = String(prop.property);
				const nullable = prop.optional ? " NULL" : " NOT NULL";

				if (prop.isPrimary) {
					primaryKeys.push(this.indexColumn(columnName, indexPrefixLength));
				}
				return `\`${columnName}\` ${sqlType}${nullable}`;
			})
			.join(", ");

		const primaryKeyDefinition =
			primaryKeys.length > 0 ? `, PRIMARY KEY (${primaryKeys.join(", ")})` : "";
		return columnDefinitions + primaryKeyDefinition;
	}

	/**
	 * Map an entity schema property to its MySQL column definition.
	 * A string property with an explicit maxLength is stored as VARCHAR(N), which takes precedence
	 * over the format mapping. A format which has a default length in EntitySchemaHelper.FORMAT_MAX_LENGTHS
	 * and no dedicated column type is also bounded to that length.
	 * @param prop The property to map.
	 * @returns The MySQL column type, and the prefix length needed to index it, if any.
	 * @internal
	 */
	private mapSqlColumn<U>(prop: IEntitySchemaProperty<U>): {
		sqlType: string;
		indexPrefixLength?: number;
	} {
		const sqlTypeMap: { [key in EntitySchemaPropertyType]: string } = {
			[EntitySchemaPropertyType.String]: "LONGTEXT",
			[EntitySchemaPropertyType.Number]: "FLOAT",
			[EntitySchemaPropertyType.Integer]: "INT",
			[EntitySchemaPropertyType.Object]: "JSON",
			[EntitySchemaPropertyType.Array]: "JSON",
			[EntitySchemaPropertyType.Boolean]: "TINYINT(1)"
		};

		let sqlType = sqlTypeMap[prop.type] || "TEXT";
		let columnLength: number | undefined;

		if (prop.format) {
			switch (prop.type) {
				case EntitySchemaPropertyType.String:
					sqlType = "LONGTEXT";
					switch (prop.format) {
						case "uuid":
							columnLength = EntitySchemaHelper.FORMAT_MAX_LENGTHS[EntitySchemaPropertyFormat.Uuid];
							sqlType = `CHAR(${columnLength})`;
							break;
						case "date":
						case "date-time":
							sqlType = "LONGTEXT";
							break;
					}
					break;
				case EntitySchemaPropertyType.Number:
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
				case EntitySchemaPropertyType.Integer:
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

		// An explicit maxLength always wins, otherwise a format default only applies when the
		// format did not already map to a dedicated column type such as CHAR for a uuid.
		const isUnboundedText = sqlType === "LONGTEXT" || sqlType === "TEXT";
		const formatMaxLength =
			isUnboundedText && Is.stringValue(prop.format)
				? EntitySchemaHelper.FORMAT_MAX_LENGTHS[prop.format]
				: undefined;
		const maxLength = prop.maxLength ?? formatMaxLength;

		if (
			prop.type === EntitySchemaPropertyType.String &&
			Is.integer(maxLength) &&
			maxLength > 0 &&
			maxLength <= MySqlEntityStorageConnector._MAX_VARCHAR_LENGTH
		) {
			columnLength = maxLength;
			sqlType = `VARCHAR(${columnLength})`;
		}

		// A column which cannot be indexed in full needs a prefix, anything which is not text
		// is always indexable in full.
		const needsPrefix = Is.integer(columnLength)
			? columnLength > MySqlEntityStorageConnector._INDEX_PREFIX_LENGTH
			: isUnboundedText;

		return {
			sqlType,
			indexPrefixLength: needsPrefix ? MySqlEntityStorageConnector._INDEX_PREFIX_LENGTH : undefined
		};
	}

	/**
	 * Build the column reference for an index or primary key.
	 * @param columnName The name of the column.
	 * @param indexPrefixLength The prefix length to index, or undefined to index the column in full.
	 * @returns The quoted column reference.
	 * @internal
	 */
	private indexColumn(columnName: string, indexPrefixLength?: number): string {
		return Is.integer(indexPrefixLength)
			? `\`${columnName}\`(${indexPrefixLength})`
			: `\`${columnName}\``;
	}
}
