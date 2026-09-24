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
	type IEntityStorageJoinOptions,
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
	 * Maximum length of the partition id column. The column leads the primary key and every
	 * index, so it is bounded to a length which can be indexed in full rather than by prefix.
	 * @internal
	 */
	private static readonly _PARTITION_KEY_MAX_LENGTH: number = 255;

	/**
	 * Maximum number of rows per INSERT statement in setBatch.
	 * @internal
	 */
	private static readonly _BATCH_CHUNK_SIZE: number = 1000;

	/**
	 * The column the group ranking is emitted as when picking one row per group.
	 * @internal
	 */
	private static readonly _GROUP_RANK_COLUMN: string = "__groupRank";

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
	 * The longest prefix a string column is indexed with, matching the bound on the partition key
	 * so it can lead an index without one. MySQL itself allows more, up to the 3072 byte key limit.
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
	 * The properties which are optional in the schema.
	 * @internal
	 */
	private readonly _nullableProperties: Set<string>;

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
		this._nullableProperties = new Set(
			(this._entitySchema.properties ?? []).filter(p => p.optional).map(p => String(p.property))
		);

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
			await pool.query("SELECT 1 FROM ?? LIMIT 0", [this.qualifiedTable()]);
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

				await pool.query(`CREATE TABLE IF NOT EXISTS ?? (${this.mapMySqlProperties()})`, [
					this.qualifiedTable()
				]);

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

			const indexes = await this.readIndexes(pool);
			const columnLengths = await this.readColumnLengths(pool);

			for (const prop of this._entitySchema.properties ?? []) {
				if (
					(prop.isSecondary === true || !Is.empty(prop.sortDirection)) &&
					prop.type !== EntitySchemaPropertyType.Object &&
					prop.type !== EntitySchemaPropertyType.Array
				) {
					await this.ensureIndex(pool, indexes, columnLengths, prop, nodeLogging);
				}
			}

			const indexGroups = EntitySchemaHelper.getIndexGroups(this._entitySchema);
			for (const indexProperties of Object.values(indexGroups)) {
				await this.ensureCompositeIndex(pool, indexes, columnLengths, indexProperties);
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

			const query = `SELECT * FROM ?? WHERE ${whereClauses.join(" AND ")} LIMIT 1`;
			const [rows] = await pool.query(query, [this.qualifiedTable(), ...values]);

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
				const updateSql = `UPDATE ?? SET ${keys.map(key => `\`${key}\` = ?`).join(", ")} WHERE \`${this._primaryKeyProperty.property as string}\` = ? AND \`${MySqlEntityStorageConnector._PARTITION_KEY}\` = ? AND \`${this._versionKey}\` = ?`;
				const updateValues = [
					this.qualifiedTable(),
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
				let sql = "INSERT INTO ??";
				sql += ` (${keys.map(key => `\`${key}\``).join(", ")})`;
				sql += ` VALUES (${values.map(() => "?").join(", ")})`;
				sql += ` ON DUPLICATE KEY UPDATE ${keys.map(key => `\`${key}\` = VALUES(\`${key}\`)`).join(", ")};`;

				await pool.query(sql, [this.qualifiedTable(), ...values]);
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
			const baseInsert = `INSERT INTO ?? ${columnList} VALUES `;
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
					[this.qualifiedTable(), ...chunkValues]
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
				`DELETE FROM ?? WHERE \`${MySqlEntityStorageConnector._PARTITION_KEY}\` = ?`,
				[this.qualifiedTable(), partitionKey ?? MySqlEntityStorageConnector._PARTITION_KEY_VALUE]
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

				const query = `DELETE FROM ?? WHERE ${whereClauses.join(" AND ")}`;
				await pool.query(query, [this.qualifiedTable(), ...values]);
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
				await pool.query("DROP TABLE ??;", [this.qualifiedTable()]);
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
			const sql = `DELETE FROM ?? WHERE \`${MySqlEntityStorageConnector._PARTITION_KEY}\` = ? AND \`${String(this._primaryKeyProperty.property)}\` IN (?)`;
			await pool.query(sql, [
				this.qualifiedTable(),
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

			// Full ordered column list used for both ORDER BY and the keySet condition.
			// Format: [user sort cols…] + [pk tie-breaker if not already present].
			const keySetCols = this.buildKeySetColumns(sortProperties);

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

			const orderByClause = `ORDER BY ${this.buildKeySetOrderBy(keySetCols)}`;

			const { whereClauses, values } = this.buildWhereClause(conditions, partitionKey);

			// Apply keySet condition when continuing from a previous page.
			if (Is.stringBase64(cursor)) {
				const parsedCursor = ObjectHelper.fromBytes<{ i: string; sv?: unknown[] }>(
					Converter.base64ToBytes(cursor)
				);

				// Reconstruct the ordered last-value list: [sort-col values…, pk].
				const lastValues: unknown[] = [...(parsedCursor.sv ?? []), parsedCursor.i];

				this.appendKeySetClause(keySetCols, lastValues, whereClauses, values);
			}

			sql = `SELECT ${selectClause} FROM ??`;
			if (whereClauses.length > 0) {
				sql += ` WHERE ${whereClauses.join(" AND ")}`;
			}
			sql += ` ${orderByClause} LIMIT ${returnSize + 1}`;

			const pool = await this.getPool();
			const [rows] = (await pool.query(sql, [this.qualifiedTable(), ...values])) ?? [];

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
	 * Find all the entities which match the conditions, attaching to each one the entities from a
	 * second storage connector whose join property matches. The join behaves like a left join by
	 * default, a primary entity with no matches is still returned with an empty joined list, unless
	 * joinRequired asks for an inner join and those entities are left out altogether. Both connectors
	 * must be MySQL connectors reading from the same database so the work can be done in a single
	 * statement.
	 * @param joinConnector The connector holding the entities to join to.
	 * @param joinOptions The properties to join on, the conditions, sort order, projection and
	 * paging for the primary entities, the optional grouping and group conditions, and the optional
	 * conditions, sort order and projection for the joined entities.
	 * @returns All the entities for the storage matching the conditions with their joined entities,
	 * and a cursor which can be used to request more entities.
	 * @throws GeneralError if the join connector does not read from the same server and database.
	 */
	public async queryJoin<U>(
		joinConnector: IEntityStorageConnector<U>,
		joinOptions: IEntityStorageJoinOptions<T, U>
	): Promise<{ entities: (Partial<T> & { joined: Partial<U>[] })[]; cursor?: string }> {
		Guards.object<IEntityStorageConnector<U>>(
			MySqlEntityStorageConnector.CLASS_NAME,
			nameof(joinConnector),
			joinConnector
		);

		// The join runs as one statement against this connector's pool, so the other side has to be
		// a MySQL connector reading from the same server and database.
		const typedJoinConnector = joinConnector as MySqlEntityStorageConnector<U>;
		if (
			joinConnector.className() !== MySqlEntityStorageConnector.CLASS_NAME ||
			typedJoinConnector._config?.host !== this._config.host ||
			typedJoinConnector._config?.port !== this._config.port ||
			typedJoinConnector._config?.database !== this._config.database
		) {
			throw new GeneralError(MySqlEntityStorageConnector.CLASS_NAME, "joinConnectorMismatch", {
				database: this._config.database
			});
		}

		EntityStorageHelper.validateJoinOptions(
			this._entitySchema,
			typedJoinConnector.getSchema(),
			joinOptions
		);

		return this.queryJoinPage(typedJoinConnector, joinOptions, joinOptions.groupProperty);
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

			sql = "SELECT COUNT(*) AS count FROM ??";
			if (whereClauses.length > 0) {
				sql += ` WHERE ${whereClauses.join(" AND ")}`;
			}

			const [rows] = await pool.query(sql, [this.qualifiedTable(), ...values]);
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
			const partitionColumn = MySqlEntityStorageConnector._PARTITION_KEY;
			const [rows] = await pool.query(
				`SELECT \`${partitionColumn}\`, COUNT(*) AS count FROM ?? GROUP BY \`${partitionColumn}\``,
				[this.qualifiedTable()]
			);
			const contextIds: IContextIds[] = [];
			const skipped = new Map<string, number>();
			for (const row of rows as { [key: string]: string | number }[]) {
				const partitionId = row[partitionColumn];
				if (Is.stringValue(partitionId)) {
					const split = EntityStorageHelper.tryShortSplit(
						this._partitionContextIds ?? [],
						partitionId
					);
					if (Is.undefined(split)) {
						skipped.set(partitionId, Number(row.count));
					} else {
						contextIds.push(split);
					}
				}
			}
			if (skipped.size > 0) {
				const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(loggingComponentType);
				await nodeLogging?.log({
					level: "warn",
					source: MySqlEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "partitionIdsSkipped",
					data: {
						expected: this._partitionContextIds?.length,
						partitionIds: Array.from(skipped, ([id, count]) => `${id}: ${count}`).join(", ")
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
		return 2;
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
	 * Finalize the migration by swapping the migration table into the original name and dropping the old table.
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
		// One statement swaps the two tables through a transient third name, so a failure or a
		// process death leaves either the untouched source or the complete migrated table in place.
		const swapTable = `${this._config.database}.${MigrationHelper.generateTargetName(
			targetConnector._config.tableName,
			MySqlEntityStorageConnector._MAX_IDENTIFIER_LENGTH
		)}`;
		const pool = await this.getPool();
		await pool.query("RENAME TABLE ?? TO ??, ?? TO ??, ?? TO ??", [
			this.qualifiedTable(),
			swapTable,
			targetConnector.qualifiedTable(),
			this.qualifiedTable(),
			swapTable,
			targetConnector.qualifiedTable()
		]);

		// The migration table now holds the old rows.
		await targetConnector.teardown(loggingComponentType);

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
	 * Read a page of primary entities and their joined entities in a single statement. The page of
	 * primary rows is selected in a derived table so the limit and the cursor apply to the primary
	 * entities rather than to the rows the join multiplies them into. When grouping, the derived
	 * table keeps only the first row of each group in the sort order, which makes one row stand for
	 * the whole group and lets the same key set cursor step past every row the group holds.
	 * @param joinConnector The connector holding the entities to join to.
	 * @param joinOptions The join configuration.
	 * @param groupProperty The optional property to group the primary entities by.
	 * @returns The entities with their joined entities, and the next page cursor.
	 * @internal
	 */
	private async queryJoinPage<U>(
		joinConnector: MySqlEntityStorageConnector<U>,
		joinOptions: IEntityStorageJoinOptions<T, U>,
		groupProperty: keyof T | undefined
	): Promise<{ entities: (Partial<T> & { joined: Partial<U>[] })[]; cursor?: string }> {
		const returnSize = joinOptions.limit ?? MySqlEntityStorageConnector._DEFAULT_LIMIT;
		const pkPropName = String(this._primaryKeyProperty.property);
		const joinColumn = String(joinOptions.property);
		const joinedPrimaryKey = String(joinConnector._primaryKeyProperty.property);

		const normalizedOptions = EntityStorageHelper.normalizeJoinOptions(joinOptions);
		const keySetValues = EntityStorageHelper.decodeCursor<T, U, unknown[]>(
			normalizedOptions,
			joinOptions.cursor
		);

		let sql = "";
		try {
			const keySetCols = this.buildKeySetColumns(joinOptions.sortProperties);

			// The key set columns and the join column are needed to page and to join, so they are
			// read even when the caller did not ask for them, then removed from the entities.
			const primary = this.buildColumnSelection(
				this._entitySchema,
				joinOptions.properties,
				keySetCols
					.map(c => c.prop)
					.concat(joinColumn)
					.concat(Is.empty(groupProperty) ? [] : [String(groupProperty)])
			);
			const joined = this.buildColumnSelection(
				joinConnector._entitySchema,
				joinOptions.joinProperties,
				[joinedPrimaryKey]
			);

			const partitionKey = await this.resolvePartitionKey();
			const { whereClauses, values } = this.buildWhereClause(joinOptions.conditions, partitionKey);

			if (!Is.empty(groupProperty)) {
				whereClauses.push(`\`${String(groupProperty)}\` IS NOT NULL`);
			}

			// The clauses which narrow the rows the page is built from, beyond the plain conditions,
			// each correlated back to the row being considered. They have to be added before the
			// page position so the bound values stay in statement order.
			const narrowing = await this.buildNarrowingClauses(
				joinConnector,
				joinOptions,
				groupProperty,
				partitionKey,
				"t"
			);
			whereClauses.push(...narrowing.clauses);
			values.push(...narrowing.values);

			const columnList = primary.columns.map(c => `\`${c}\``).join(", ");
			const pageOrderBy = this.buildKeySetOrderBy(keySetCols);

			const keySetClauses: string[] = [];
			this.appendKeySetClause(keySetCols, keySetValues, keySetClauses, values);

			let pageSql: string;
			if (Is.empty(groupProperty)) {
				pageSql = `SELECT ${columnList} FROM ?? AS t WHERE ${[...whereClauses, ...keySetClauses].join(" AND ")} ORDER BY ${pageOrderBy} LIMIT ${returnSize + 1}`;
			} else {
				// Ranking inside each group and keeping the first row collapses the group to the one
				// row the result stands on, so the ordering, the projection and the cursor all work
				// on ordinary rows rather than on a distinct list of group values.
				const rankedSql = `SELECT ${columnList}, ROW_NUMBER() OVER (PARTITION BY \`${String(groupProperty)}\` ORDER BY ${pageOrderBy}) AS \`${MySqlEntityStorageConnector._GROUP_RANK_COLUMN}\` FROM ?? AS t WHERE ${whereClauses.join(" AND ")}`;
				const rankedWhere = [
					`\`${MySqlEntityStorageConnector._GROUP_RANK_COLUMN}\` = 1`,
					...keySetClauses
				];
				pageSql = `SELECT ${columnList} FROM (${rankedSql}) AS ranked WHERE ${rankedWhere.join(" AND ")} ORDER BY ${pageOrderBy} LIMIT ${returnSize + 1}`;
			}

			// A group stands on one row for ordering and paging, but its joined list has to hold the
			// matches of every entity in the group, so the other members are re-attached to the
			// page and the join hangs off them. The same joined entity reached through more than
			// one member is collapsed when the rows are collected.
			const memberValues: unknown[] = [];
			let fromClause = `(${pageSql}) AS p`;
			let joinFromAlias = "p";

			if (!Is.empty(groupProperty)) {
				const members = this.buildWhereClause(joinOptions.conditions, partitionKey, "m");
				// A member has to pass the same narrowing as the row standing for the group,
				// otherwise an inner join would let entities back in through the members.
				const memberNarrowing = await this.buildNarrowingClauses(
					joinConnector,
					joinOptions,
					undefined,
					partitionKey,
					"m"
				);
				memberValues.push(...members.values, ...memberNarrowing.values);
				fromClause += ` LEFT JOIN ?? AS m ON ${[
					`m.\`${String(groupProperty)}\` = p.\`${String(groupProperty)}\``,
					...members.whereClauses,
					...memberNarrowing.clauses
				].join(" AND ")}`;
				joinFromAlias = "m";
			}

			const join = await joinConnector.buildJoinClause(
				String(joinOptions.joinProperty),
				joinOptions.joinConditions,
				"j",
				joinFromAlias,
				joinColumn
			);

			const selectClause = primary.columns
				.map(c => `p.\`${c}\``)
				.concat(joined.columns.map(c => `j.\`${c}\``))
				.join(", ");

			const outerOrderBy = [
				this.buildKeySetOrderBy(keySetCols, "p"),
				...this.buildJoinOrderBy(joinOptions, "j")
			].join(", ");

			sql = `SELECT ${selectClause} FROM ${fromClause} LEFT JOIN ?? AS j ON ${join.clause} ORDER BY ${outerOrderBy}`;

			// The bound values follow the order the placeholders appear in the statement: the
			// primary table with its conditions and page position, the primary table again when
			// the other members of each group are re-attached, then the joined table.
			const queryValues = [
				this.qualifiedTable(),
				...values,
				...(Is.empty(groupProperty) ? [] : [this.qualifiedTable(), ...memberValues]),
				joinConnector.qualifiedTable(),
				...join.values
			];

			const pool = await this.getPool();
			const [rows] = (await pool.query({ sql, values: queryValues, nestTables: true })) ?? [];

			const groups = this.collectJoinRows<U>(rows, "p", pkPropName, "j", joinedPrimaryKey);
			const hasMore = groups.length > returnSize;
			const pageGroups = hasMore ? groups.slice(0, returnSize) : groups;

			const entities: (Partial<T> & { joined: Partial<U>[] })[] = [];
			for (const group of pageGroups) {
				const entity = this.prepareJoinEntity<T>(group.key, this._entitySchema, primary.internal);
				entities.push({
					...entity,
					joined: group.joined.map(j =>
						this.prepareJoinEntity<U>(j, joinConnector._entitySchema, joined.internal)
					)
				});
			}

			let nextCursor: string | undefined;
			if (hasMore && pageGroups.length > 0) {
				const lastRow = pageGroups[pageGroups.length - 1].key;
				nextCursor = EntityStorageHelper.encodeCursor(
					normalizedOptions,
					keySetCols.map(c => ObjectHelper.propertyGet(lastRow, c.prop))
				);
			}

			return { entities, cursor: nextCursor };
		} catch (err) {
			throw new GeneralError(
				MySqlEntityStorageConnector.CLASS_NAME,
				"queryJoinFailed",
				{ sql },
				err
			);
		}
	}

	/**
	 * Build the clauses which narrow the rows a page is built from, beyond the plain conditions.
	 * An inner join requires the row to have at least one joined entity, and a group condition
	 * requires the group the row belongs to to hold an entity which matches it.
	 * @param joinConnector The connector holding the entities to join to.
	 * @param joinOptions The join configuration.
	 * @param groupProperty The optional property the entities are grouped by.
	 * @param partitionKey The partition key of this connector.
	 * @param alias The alias of the row being narrowed.
	 * @returns The clauses and their bound values.
	 * @internal
	 */
	private async buildNarrowingClauses<U>(
		joinConnector: MySqlEntityStorageConnector<U>,
		joinOptions: IEntityStorageJoinOptions<T, U>,
		groupProperty: keyof T | undefined,
		partitionKey: string | undefined,
		alias: string
	): Promise<{ clauses: string[]; values: unknown[] }> {
		const clauses: string[] = [];
		const values: unknown[] = [];

		if (joinOptions.joinRequired ?? false) {
			const exists = await joinConnector.buildJoinExistsClause(
				String(joinOptions.joinProperty),
				joinOptions.joinConditions,
				"jx",
				alias,
				String(joinOptions.property)
			);
			clauses.push(exists.clause);
			values.push(...exists.values);
		}

		if (!Is.empty(groupProperty) && Is.arrayValue(joinOptions.groupConditions)) {
			const groupColumn = String(groupProperty);
			for (let i = 0; i < joinOptions.groupConditions.length; i++) {
				const memberAlias = `gx${i}`;
				const group = this.buildWhereClause(
					joinOptions.groupConditions[i],
					partitionKey,
					memberAlias
				);
				clauses.push(
					`EXISTS (SELECT 1 FROM ?? AS ${memberAlias} WHERE ${memberAlias}.\`${groupColumn}\` = ${alias}.\`${groupColumn}\` AND ${group.whereClauses.join(" AND ")})`
				);
				values.push(this.qualifiedTable(), ...group.values);
			}
		}

		return { clauses, values };
	}

	/**
	 * Build the clause which requires a primary entity to have at least one joined entity. Called
	 * on the connector holding the joined entities so its partition key and property types apply.
	 * @param joinProperty The column on this connector's table to join to.
	 * @param joinConditions The optional conditions to match for the joined entities.
	 * @param alias The alias of the joined table inside the clause.
	 * @param primaryAlias The alias of the primary entity being narrowed.
	 * @param primaryColumn The column on the primary entity to join from.
	 * @returns The clause and its bound values.
	 * @internal
	 */
	private async buildJoinExistsClause(
		joinProperty: string,
		joinConditions: EntityCondition<T> | undefined,
		alias: string,
		primaryAlias: string,
		primaryColumn: string
	): Promise<{ clause: string; values: unknown[] }> {
		const partitionKey = await this.resolvePartitionKey();
		const { whereClauses, values } = this.buildWhereClause(joinConditions, partitionKey, alias);

		return {
			clause: `EXISTS (SELECT 1 FROM ?? AS ${alias} WHERE ${alias}.\`${joinProperty}\` = ${primaryAlias}.\`${primaryColumn}\` AND ${whereClauses.join(" AND ")})`,
			values: [this.qualifiedTable(), ...values]
		};
	}

	/**
	 * Build the ON clause which attaches the joined table, including its own partition key and any
	 * conditions the caller supplied for the joined entities. Called on the connector holding the
	 * joined entities so the partition key and the property types come from its own schema and
	 * configuration.
	 * @param joinProperty The column on this connector's table to join to.
	 * @param joinConditions The optional conditions to match for the joined entities.
	 * @param alias The alias of the joined table.
	 * @param primaryAlias The alias of the table holding the primary entities.
	 * @param primaryColumn The column on the primary table to join from.
	 * @returns The ON clause and its bound values.
	 * @internal
	 */
	private async buildJoinClause(
		joinProperty: string,
		joinConditions: EntityCondition<T> | undefined,
		alias: string,
		primaryAlias: string,
		primaryColumn: string
	): Promise<{ clause: string; values: unknown[] }> {
		const partitionKey = await this.resolvePartitionKey();
		const { whereClauses, values } = this.buildWhereClause(joinConditions, partitionKey, alias);

		const clauses = [
			`${alias}.\`${joinProperty}\` = ${primaryAlias}.\`${primaryColumn}\``,
			...whereClauses
		];

		return { clause: clauses.join(" AND "), values };
	}

	/**
	 * Build the ORDER BY fragments which order the joined entities within each primary entity.
	 * @param joinOptions The join configuration.
	 * @param alias The alias of the joined table.
	 * @returns The order by fragments, empty when no sort order was requested.
	 * @internal
	 */
	private buildJoinOrderBy<U>(
		joinOptions: IEntityStorageJoinOptions<T, U>,
		alias: string
	): string[] {
		return (joinOptions.joinSortProperties ?? []).map(
			s =>
				`${alias}.\`${String(s.property)}\` ${s.sortDirection === SortDirection.Ascending ? "ASC" : "DESC"}`
		);
	}

	/**
	 * Build the ordered keySet columns used for the page order and the cursor, matching the
	 * behaviour of query so both paginate the same way.
	 * @param sortProperties The optional sort order.
	 * @returns The ordered columns with their direction.
	 * @internal
	 */
	private buildKeySetColumns(
		sortProperties?: { property: keyof T; sortDirection: SortDirection }[]
	): { prop: string; asc: boolean; nullable: boolean }[] {
		const pkPropName = String(this._primaryKeyProperty.property);
		const keySetCols: { prop: string; asc: boolean; nullable: boolean }[] = [];

		for (const sortProperty of sortProperties ?? []) {
			keySetCols.push({
				prop: String(sortProperty.property),
				asc: sortProperty.sortDirection === SortDirection.Ascending,
				nullable: this._nullableProperties.has(String(sortProperty.property))
			});
			// The primary key is unique, so nothing after it can change the order.  Stopping here
			// keeps it last, which is what the cursor assumes when it pairs values with columns.
			if (String(sortProperty.property) === pkPropName) {
				break;
			}
		}

		if (!keySetCols.some(c => c.prop === pkPropName)) {
			keySetCols.push({ prop: pkPropName, asc: true, nullable: false });
		}

		return keySetCols;
	}

	/**
	 * Build the ORDER BY fragment for the keySet columns.
	 * @param keySetCols The ordered keySet columns.
	 * @param alias The optional alias qualifying the columns.
	 * @returns The order by fragment.
	 * @internal
	 */
	private buildKeySetOrderBy(
		keySetCols: { prop: string; asc: boolean; nullable: boolean }[],
		alias?: string
	): string {
		const prefix = Is.stringValue(alias) ? `${alias}.` : "";
		// NULLs sort after all other values.
		return keySetCols
			.map(c => {
				const dir = c.asc ? "ASC" : "DESC";
				const col = `${prefix}\`${c.prop}\``;
				return c.nullable ? `${col} IS NULL ${dir}, ${col} ${dir}` : `${col} ${dir}`;
			})
			.join(", ");
	}

	/**
	 * Add the keySet condition which continues the page from a previous cursor.
	 * @param keySetCols The ordered keySet columns.
	 * @param lastValues The key set values of the last entity of the previous page.
	 * @param whereClauses The where clauses to append to.
	 * @param values The values to append to.
	 * @internal
	 */
	private appendKeySetClause(
		keySetCols: { prop: string; asc: boolean; nullable: boolean }[],
		lastValues: unknown[] | undefined,
		whereClauses: string[],
		values: unknown[]
	): void {
		if (!Is.arrayValue(lastValues)) {
			return;
		}

		const orParts: string[] = [];
		for (let i = 0; i < keySetCols.length; i++) {
			// Nothing sorts after NULL when ascending, so such a branch can never match.
			if (!keySetCols[i].asc || !Is.empty(lastValues[i])) {
				const parts: string[] = [];
				for (let j = 0; j < i; j++) {
					if (Is.empty(lastValues[j])) {
						parts.push(`\`${keySetCols[j].prop}\` IS NULL`);
					} else {
						values.push(lastValues[j]);
						parts.push(`\`${keySetCols[j].prop}\` = ?`);
					}
				}
				const col = `\`${keySetCols[i].prop}\``;
				if (Is.empty(lastValues[i])) {
					parts.push(`${col} IS NOT NULL`);
				} else {
					values.push(lastValues[i]);
					if (keySetCols[i].asc) {
						parts.push(keySetCols[i].nullable ? `(${col} > ? OR ${col} IS NULL)` : `${col} > ?`);
					} else {
						parts.push(`${col} < ?`);
					}
				}
				orParts.push(parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`);
			}
		}
		whereClauses.push(`(${orParts.join(" OR ")})`);
	}

	/**
	 * Work out which columns to read for one side of the join, honouring the caller's projection
	 * but adding the columns the join itself needs.
	 * @param schema The schema of the entities being read.
	 * @param properties The optional projection requested by the caller.
	 * @param required The columns the join needs regardless of the projection.
	 * @returns The columns to read and the ones which were only added internally.
	 * @internal
	 */
	private buildColumnSelection<E>(
		schema: IEntitySchema<E>,
		properties: (keyof E)[] | undefined,
		required: string[]
	): { columns: string[]; internal: string[] } {
		const columns: string[] = [];
		const internal: string[] = [];

		if (Is.arrayValue(properties)) {
			for (const prop of properties) {
				const column = String(prop);
				if (!columns.includes(column)) {
					columns.push(column);
				}
			}
			for (const column of required) {
				if (!columns.includes(column)) {
					columns.push(column);
					internal.push(column);
				}
			}
		} else {
			for (const prop of schema.properties ?? []) {
				const column = String(prop.property);
				if (!columns.includes(column)) {
					columns.push(column);
				}
			}
		}

		return { columns, internal };
	}

	/**
	 * Collapse the flat rows returned by the join into one entry per primary entity, preserving the
	 * order the database returned them in.
	 * @param rows The nested rows from the join statement.
	 * @param primaryAlias The alias holding the primary entity columns.
	 * @param identityColumn The column which identifies a primary entity.
	 * @param joinedAlias The alias holding the joined entity columns.
	 * @param joinedPrimaryKey The primary key column of the joined entities.
	 * @returns One entry per primary entity with its joined entities.
	 * @internal
	 */
	private collectJoinRows<U>(
		rows: unknown,
		primaryAlias: string,
		identityColumn: string,
		joinedAlias: string,
		joinedPrimaryKey: string
	): { key: { [column: string]: unknown }; joined: Partial<U>[] }[] {
		const groups: { key: { [column: string]: unknown }; joined: Partial<U>[] }[] = [];
		if (!Is.array(rows)) {
			return groups;
		}

		let current: { key: { [column: string]: unknown }; joined: Partial<U>[] } | undefined;
		let currentIdentity: string | undefined;
		let seenJoined = new Set<string>();

		for (const row of rows as { [alias: string]: { [column: string]: unknown } }[]) {
			const primaryRow = row[primaryAlias] ?? {};
			const identity = this.rowKey(primaryRow[identityColumn]);

			if (Is.undefined(current) || identity !== currentIdentity) {
				current = { key: primaryRow, joined: [] };
				currentIdentity = identity;
				seenJoined = new Set<string>();
				groups.push(current);
			}

			// A left join with no match produces a row whose joined columns are all null, and the
			// same joined entity appears more than once when several primary rows in a group share
			// the same join value.
			const joinedRow = row[joinedAlias];
			if (!Is.empty(joinedRow) && !Is.empty(joinedRow[joinedPrimaryKey])) {
				const joinedIdentity = this.rowKey(joinedRow[joinedPrimaryKey]);
				if (!seenJoined.has(joinedIdentity)) {
					seenJoined.add(joinedIdentity);
					current.joined.push(joinedRow as Partial<U>);
				}
			}
		}

		return groups;
	}

	/**
	 * Turn a raw column value into a key which can be compared between rows.
	 * @param value The value read from the storage.
	 * @returns The key for the value.
	 * @internal
	 */
	private rowKey(value: unknown): string {
		return Is.string(value) ? value : JSON.stringify(value);
	}

	/**
	 * Apply to a row read by a join the same clean up a plain query applies to its entities, then
	 * remove the columns which were only read to satisfy the join.
	 * @param row The raw row read from the storage.
	 * @param schema The schema of the entity.
	 * @param internal The columns to remove.
	 * @returns The entity.
	 * @internal
	 */
	private prepareJoinEntity<E>(
		row: { [column: string]: unknown },
		schema: IEntitySchema<E>,
		internal: string[]
	): Partial<E> {
		const entity = EntityStorageHelper.unPrepareEntity<E>({ ...row } as Partial<E>, [
			MySqlEntityStorageConnector._PARTITION_KEY,
			...internal
		]);

		for (const prop of schema.properties ?? []) {
			const value = entity[prop.property];
			if (prop.type === EntitySchemaPropertyType.Boolean && !Is.empty(value)) {
				ObjectHelper.propertySet(entity, prop.property as string, Boolean(value));
			}
		}

		return entity;
	}

	/**
	 * Get the partition key for the current context.
	 * @returns The partition key, or undefined when the connector is not partitioned.
	 * @internal
	 */
	private async resolvePartitionKey(): Promise<string | undefined> {
		const contextIds = await ContextIdStore.getContextIds();
		return ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);
	}

	/**
	 * Get the fully qualified table name for this connector, for binding to a ?? placeholder so
	 * the driver escapes it rather than the identifier being spliced into the statement.
	 * @returns The database and table name.
	 * @internal
	 */
	private qualifiedTable(): string {
		return `${this._config.database}.${this._config.tableName}`;
	}

	/**
	 * Qualify a column with a table alias, needed when the statement reads from more than one table.
	 * @param column The column name.
	 * @param tableAlias The optional table alias.
	 * @returns The quoted column, prefixed with the alias when one was supplied.
	 * @internal
	 */
	private qualifiedColumn(column: string, tableAlias?: string): string {
		return Is.stringValue(tableAlias) ? `${tableAlias}.\`${column}\`` : `\`${column}\``;
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
	 * Read the key columns of every usable index on the table, in key order.
	 * @param pool The pool to query with.
	 * @returns The key columns and uniqueness of each index, keyed by index name.
	 * @internal
	 */
	private async readIndexes(
		pool: Pool
	): Promise<{ [indexName: string]: { columns: string[]; nonUnique: boolean } }> {
		const [indexRows] = await pool.query(
			"SELECT index_name AS indexName, column_name AS columnName, non_unique AS nonUnique FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema = ? AND table_name = ? AND is_visible = 'YES' AND index_type = 'BTREE' ORDER BY index_name, seq_in_index",
			[this._config.database, this._config.tableName]
		);

		const indexes: { [indexName: string]: { columns: string[]; nonUnique: boolean } } = {};

		for (const row of Is.array(indexRows) ? indexRows : []) {
			const indexName = ObjectHelper.propertyGet<string>(row, "indexName");
			const columnName = ObjectHelper.propertyGet<string>(row, "columnName");
			if (Is.stringValue(indexName) && Is.stringValue(columnName)) {
				indexes[indexName] ??= {
					columns: [],
					nonUnique: Coerce.integer(ObjectHelper.propertyGet(row, "nonUnique")) === 1
				};
				indexes[indexName].columns.push(columnName);
			}
		}

		return indexes;
	}

	/**
	 * Read the character length of every column on the table.
	 * @param pool The pool to query with.
	 * @returns The character length of each column, keyed by column name, absent for a non-string column.
	 * @internal
	 */
	private async readColumnLengths(pool: Pool): Promise<{ [columnName: string]: number }> {
		const [columnRows] = await pool.query(
			"SELECT column_name AS columnName, character_maximum_length AS characterMaximumLength FROM INFORMATION_SCHEMA.COLUMNS WHERE table_schema = ? AND table_name = ?",
			[this._config.database, this._config.tableName]
		);

		const columnLengths: { [columnName: string]: number } = {};

		for (const row of Is.array(columnRows) ? columnRows : []) {
			const columnName = ObjectHelper.propertyGet<string>(row, "columnName");
			const characterMaximumLength = Coerce.integer(
				ObjectHelper.propertyGet(row, "characterMaximumLength")
			);
			if (Is.stringValue(columnName) && Is.integer(characterMaximumLength)) {
				columnLengths[columnName] = characterMaximumLength;
			}
		}

		return columnLengths;
	}

	/**
	 * Build the column reference for an index key, with a prefix which is legal on the column as it
	 * exists rather than as the schema declares it. A table created by an earlier release can hold
	 * the column as LONGTEXT, or shorter than a length the schema has since raised, and either way
	 * the index has to be created before the schema version rebuild can convert the column.
	 * @param prop The indexed property.
	 * @param columnLengths The character length of each column on the table.
	 * @returns The quoted column reference.
	 * @internal
	 */
	private indexKeyColumn<U>(
		prop: IEntitySchemaProperty<U>,
		columnLengths: { [columnName: string]: number }
	): string {
		const columnName = String(prop.property);
		const declaredPrefixLength = this.mapSqlColumn(prop).indexPrefixLength;
		const columnLength = columnLengths[columnName];

		return this.indexColumn(
			columnName,
			Is.integer(declaredPrefixLength) && Is.integer(columnLength)
				? Math.min(declaredPrefixLength, columnLength)
				: declaredPrefixLength
		);
	}

	/**
	 * Ensure the secondary index for a property exists, dropping a legacy-named index if present.
	 * Every query is scoped to a single partition, so the index leads with the partition key and
	 * the property follows it, letting one index serve both the partition filter and the sort.
	 * @param pool The pool to query with.
	 * @param indexes The indexes already on the table, keyed by index name.
	 * @param columnLengths The character length of each column on the table.
	 * @param prop The indexed property.
	 * @param nodeLogging Optional logging component.
	 * @internal
	 */
	private async ensureIndex(
		pool: Pool,
		indexes: { [indexName: string]: { columns: string[]; nonUnique: boolean } },
		columnLengths: { [columnName: string]: number },
		prop: IEntitySchemaProperty<T>,
		nodeLogging?: ILoggingComponent
	): Promise<void> {
		const columnName = String(prop.property);
		const indexName = IndexHelper.generateName(this._config.tableName, columnName);
		const keyColumns = [MySqlEntityStorageConnector._PARTITION_KEY, columnName];

		if (!this.isIndexCovered(indexes, keyColumns)) {
			const indexCols = [
				this.partitionKeyIndexColumn(columnLengths),
				this.indexKeyColumn(prop, columnLengths)
			];

			// An index of ours under the same name but with a different shape predates the partition
			// key leading the key columns, so it has to be replaced rather than left in place.
			await this.addIndex(pool, indexName, indexCols, !Is.empty(indexes[indexName]));
		}

		// TODO: remove the legacy index handling once every installation has bootstrapped on a release that contains it
		const legacyName = IndexHelper.generateLegacyName(this._config.tableName, columnName);
		const legacyIndex = indexes[legacyName];

		// The connector's own legacy indexes were always non-unique and single-column, anything else is an operator's
		if (!Is.empty(legacyIndex) && legacyIndex.nonUnique && legacyIndex.columns.length === 1) {
			await pool.query(`DROP INDEX \`${legacyName}\` ON ??`, [this.qualifiedTable()]);
			await nodeLogging?.log({
				level: "info",
				source: MySqlEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "legacyIndexDropped",
				data: {
					tableName: this._config.tableName,
					indexName: legacyName,
					newIndexName: indexName
				}
			});
		}
	}

	/**
	 * Ensure the composite index for a schema index group exists.
	 * A group needs at least two properties to form a composite index, otherwise it is skipped.
	 * The partition key leads the index for the same reason it leads a single property index.
	 * @param pool The pool to query with.
	 * @param indexes The indexes already on the table, keyed by index name.
	 * @param columnLengths The character length of each column on the table.
	 * @param indexProperties The properties in the group, ordered by their index position.
	 * @internal
	 */
	private async ensureCompositeIndex(
		pool: Pool,
		indexes: { [indexName: string]: { columns: string[]; nonUnique: boolean } },
		columnLengths: { [columnName: string]: number },
		indexProperties: { property: IEntitySchemaProperty<T>; direction: SortDirection }[]
	): Promise<void> {
		const indexName = IndexHelper.generateCompositeName(this._config.tableName, indexProperties);
		const keyColumns = [
			MySqlEntityStorageConnector._PARTITION_KEY,
			...indexProperties.map(indexProperty => String(indexProperty.property.property))
		];

		if (this.isIndexCovered(indexes, keyColumns)) {
			return;
		}

		const indexCols = [
			`${this.partitionKeyIndexColumn(columnLengths)} ASC`,
			...indexProperties.map(indexProperty => {
				const column = this.indexKeyColumn(indexProperty.property, columnLengths);
				return `${column} ${indexProperty.direction === SortDirection.Descending ? "DESC" : "ASC"}`;
			})
		];

		// An index of ours under the same name but with a different shape predates the partition
		// key leading the key columns, so it has to be replaced rather than left in place.
		await this.addIndex(pool, indexName, indexCols, !Is.empty(indexes[indexName]));
	}

	/**
	 * Add an index to the table, replacing a same-named one in the same statement so that a
	 * failed create leaves the existing index in place.
	 * @param pool The pool to query with.
	 * @param indexName The name of the index.
	 * @param indexCols The key column references, in key order.
	 * @param replace True to drop the same-named index in the same statement.
	 * @internal
	 */
	private async addIndex(
		pool: Pool,
		indexName: string,
		indexCols: string[],
		replace: boolean
	): Promise<void> {
		const dropClause = replace ? `DROP INDEX \`${indexName}\`, ` : "";
		await pool.query(
			`ALTER TABLE ?? ${dropClause}ADD INDEX \`${indexName}\` (${indexCols.join(", ")})`,
			[this.qualifiedTable()]
		);
	}

	/**
	 * Check if any of the indexes already starts with the given key columns.
	 * @param indexes The indexes on the table, keyed by index name.
	 * @param keyColumns The leading key columns the index must have, in order.
	 * @returns True if an index already leads with the key columns.
	 * @internal
	 */
	private isIndexCovered(
		indexes: { [indexName: string]: { columns: string[]; nonUnique: boolean } },
		keyColumns: string[]
	): boolean {
		return Object.values(indexes).some(index =>
			keyColumns.every((keyColumn, position) => index.columns[position] === keyColumn)
		);
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
	 * @param tableAlias The optional table alias to qualify the columns with, needed when the
	 * clauses are used in a statement which reads from more than one table.
	 * @returns The where clauses and bound values.
	 * @internal
	 */
	private buildWhereClause(
		conditions: EntityCondition<T> | undefined,
		partitionKey: string | undefined,
		tableAlias?: string
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

		this.buildQueryParameters("", finalConditions, whereClauses, values, tableAlias);

		return { whereClauses, values };
	}

	/**
	 * Create an SQL condition clause.
	 * @param objectPath The path for the nested object.
	 * @param condition The conditions to create the query from.
	 * @param whereClauses The where clauses to use in the query.
	 * @param values The values to use in the query.
	 * @param tableAlias The optional table alias to qualify the columns with.
	 * @internal
	 */
	private buildQueryParameters(
		objectPath: string,
		condition: EntityCondition<T> | undefined,
		whereClauses: string[],
		values: unknown[],
		tableAlias?: string
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
				this.buildQueryParameters(objectPath, c, subWhereClauses, subValues, tableAlias);
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
		const comparison = this.mapComparisonOperator(
			objectPath,
			condition,
			schemaProp?.type,
			values,
			tableAlias
		);
		whereClauses.push(comparison);
	}

	/**
	 * Map the framework comparison operators to those in MySQL.
	 * @param objectPath The prefix to use for the condition.
	 * @param comparator The operator to map.
	 * @param type The type of the property.
	 * @param values The values to use in the query.
	 * @param tableAlias The optional table alias to qualify the columns with.
	 * @returns The comparison expression.
	 * @throws GeneralError if the comparison operator is not supported.
	 * @internal
	 */
	private mapComparisonOperator(
		objectPath: string,
		comparator: IComparator,
		type: EntitySchemaPropertyType | undefined,
		values: unknown[],
		tableAlias?: string
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
			return `${this.qualifiedColumn(prop, tableAlias)} IN (${placeholders})`;
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
					const jsonExpr = `JSON_UNQUOTE(JSON_EXTRACT(${this.qualifiedColumn(rootProp, tableAlias)}, '${jsonPath}'))`;
					return `${jsonExpr} ${nullCheck}`;
				}
				return `${this.qualifiedColumn(prop, tableAlias)} ${nullCheck}`;
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
			const jsonExpr = `JSON_UNQUOTE(JSON_EXTRACT(${this.qualifiedColumn(rootProp, tableAlias)}, '${jsonPath}'))`;

			switch (comparator.comparison) {
				case ComparisonOperator.Includes: {
					values.pop();
					values.push(`%${String(comparator.value)}%`);
					return `${jsonExpr} LIKE ?`;
				}
				case ComparisonOperator.StartsWith: {
					values.pop();
					values.push(`${this.escapeLike(String(comparator.value))}%`);
					return `${jsonExpr} LIKE ?`;
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
					return `JSON_CONTAINS(${this.qualifiedColumn(prop, tableAlias)}, ?)`;
				}
				return `${this.qualifiedColumn(prop, tableAlias)} = ?`;
			case ComparisonOperator.NotEquals:
				if (Is.object(comparator.value) || Is.array(comparator.value)) {
					return `NOT JSON_CONTAINS(${this.qualifiedColumn(prop, tableAlias)}, ?)`;
				}
				return `${this.qualifiedColumn(prop, tableAlias)} <> ?`;
			case ComparisonOperator.GreaterThan:
				return `${this.qualifiedColumn(prop, tableAlias)} > ?`;
			case ComparisonOperator.LessThan:
				return `${this.qualifiedColumn(prop, tableAlias)} < ?`;
			case ComparisonOperator.GreaterThanOrEqual:
				return `${this.qualifiedColumn(prop, tableAlias)} >= ?`;
			case ComparisonOperator.LessThanOrEqual:
				return `${this.qualifiedColumn(prop, tableAlias)} <= ?`;
			case ComparisonOperator.Includes: {
				if (type === EntitySchemaPropertyType.String) {
					values.pop();
					values.push(`%${String(comparator.value)}%`);
					return `${this.qualifiedColumn(prop, tableAlias)} LIKE ?`;
				}
				values.pop();
				values.push(JSON.stringify(comparator.value));
				return `JSON_CONTAINS(${this.qualifiedColumn(prop, tableAlias)}, ?)`;
			}
			case ComparisonOperator.NotIncludes: {
				if (type === EntitySchemaPropertyType.String) {
					values.pop();
					values.push(`%${String(comparator.value)}%`);
					return `${this.qualifiedColumn(prop, tableAlias)} NOT LIKE ?`;
				}
				values.pop();
				values.push(JSON.stringify(comparator.value));
				return `NOT JSON_CONTAINS(${this.qualifiedColumn(prop, tableAlias)}, ?)`;
			}
			case ComparisonOperator.StartsWith: {
				if (type === EntitySchemaPropertyType.String) {
					values.pop();
					values.push(`${this.escapeLike(String(comparator.value))}%`);
					return `${this.qualifiedColumn(prop, tableAlias)} LIKE ?`;
				}
				throw new GeneralError(MySqlEntityStorageConnector.CLASS_NAME, "comparisonNotSupported", {
					comparison: comparator.comparison,
					type
				});
			}
			default:
				throw new GeneralError(MySqlEntityStorageConnector.CLASS_NAME, "comparisonNotSupported", {
					comparison: comparator.comparison
				});
		}
	}

	/**
	 * Escape the LIKE wildcard characters in a value so they match literally.
	 * @param value The value to escape.
	 * @returns The escaped value.
	 * @internal
	 */
	private escapeLike(value: string): string {
		return value.replace(/[\\%_]/g, "\\$&");
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

		props.unshift(this.partitionKeyProperty());

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
	 * @returns The MySQL column type, and the prefix length to index it with, undefined for a non-string column.
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

		// Every string column is indexed with a prefix, so the same DDL is legal on the VARCHAR or
		// CHAR the schema creates and on the LONGTEXT a table from an earlier release still has.
		// MySQL records a prefix that covers the whole column as a full index.
		const indexPrefixLength =
			prop.type === EntitySchemaPropertyType.String
				? Math.min(
						Is.integer(columnLength)
							? columnLength
							: MySqlEntityStorageConnector._INDEX_PREFIX_LENGTH,
						MySqlEntityStorageConnector._INDEX_PREFIX_LENGTH
					)
				: undefined;

		return { sqlType, indexPrefixLength };
	}

	/**
	 * Build the schema property describing the partition key column.
	 * @returns The partition key property.
	 * @internal
	 */
	private partitionKeyProperty(): IEntitySchemaProperty<T> {
		return {
			property: MySqlEntityStorageConnector._PARTITION_KEY as keyof T,
			type: EntitySchemaPropertyType.String,
			maxLength: MySqlEntityStorageConnector._PARTITION_KEY_MAX_LENGTH,
			isPrimary: true
		};
	}

	/**
	 * Build the column reference for the partition key when it leads an index.
	 * @param columnLengths The character length of each column on the table.
	 * @returns The quoted column reference.
	 * @internal
	 */
	private partitionKeyIndexColumn(columnLengths: { [columnName: string]: number }): string {
		return this.indexKeyColumn(this.partitionKeyProperty(), columnLengths);
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
