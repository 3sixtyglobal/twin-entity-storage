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
	Mutex,
	type IValidationFailure,
	ObjectHelper,
	RandomHelper,
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
	ConnectionHelper,
	EntityStorageHelper,
	IndexHelper,
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
export class PostgreSqlEntityStorageConnector<T = unknown>
	implements IEntityStorageMigrationConnector<T>, IHealthProviderComponent
{
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
	 * Maximum number of rows per INSERT statement in setBatch.
	 * @internal
	 */
	private static readonly _BATCH_CHUNK_SIZE: number = 1000;

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
	 * The name of the version property, if any.
	 * @internal
	 */
	private readonly _versionKey?: string;

	/**
	 * The configuration for the connector.
	 * @internal
	 */
	private readonly _config: IPostgreSqlEntityStorageConnectorConfig;

	/**
	 * Milliseconds to wait for optimistic-lock mutexes before throwing.
	 * @internal
	 */
	private readonly _mutexTimeoutMs?: number;

	/**
	 * Unique identifier for this connector instance, used to track references in SharedStore.
	 * @internal
	 */
	private readonly _instanceId: string;

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

		if (!Is.empty(options.config.pool?.connectTimeout)) {
			Guards.integer(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
				nameof(options.config.pool?.connectTimeout),
				options.config.pool?.connectTimeout
			);
		}

		if (!Is.empty(options.config.pool?.idleTimeout)) {
			Guards.integer(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
				nameof(options.config.pool?.idleTimeout),
				options.config.pool?.idleTimeout
			);
		}

		if (!Is.empty(options.config.pool?.max)) {
			Guards.integer(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
				nameof(options.config.pool?.max),
				options.config.pool?.max
			);
		}

		if (!Is.empty(options.config.pool?.maxLifetime)) {
			Guards.integer(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
				nameof(options.config.pool?.maxLifetime),
				options.config.pool?.maxLifetime
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
	 * Initialize the PostgreSql environment.
	 * @param nodeLoggingComponentType Optional type of the logging component.
	 * @returns A promise that resolves to a boolean indicating success.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		try {
			const adminClient = postgres(this.createConnectionConfig(false));
			try {
				const databaseExists = await this.databaseExists(adminClient);
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
					await adminClient.unsafe(`CREATE DATABASE "${this._config.database}";`);
					await this.waitForDatabaseExists(adminClient);
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
			} finally {
				await adminClient.end();
			}

			const dbConnection = await this.getClient();

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

			for (const prop of this._entitySchema.properties ?? []) {
				if (
					(prop.isSecondary === true || !Is.empty(prop.sortDirection)) &&
					prop.type !== EntitySchemaPropertyType.Object &&
					prop.type !== EntitySchemaPropertyType.Array
				) {
					const columnName = String(prop.property);
					const indexName = IndexHelper.generateName(this._config.tableName, columnName);
					const coveringIndexRows = await dbConnection.unsafe(
						`SELECT 1
						FROM pg_index ix
						JOIN pg_class t ON t.oid = ix.indrelid
						JOIN pg_namespace n ON n.oid = t.relnamespace
						JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
						JOIN pg_class i ON i.oid = ix.indexrelid
						JOIN pg_am am ON am.oid = i.relam
						WHERE n.nspname = 'public'
							AND t.relname = $1
							AND a.attname = $2
							AND ix.indisvalid
							AND ix.indisready
							AND ix.indpred IS NULL
							AND am.amname = 'btree'
						LIMIT 1`,
						[this._config.tableName, columnName] as ParameterOrJSON<never>[]
					);
					if (coveringIndexRows.length === 0) {
						await dbConnection.unsafe(
							`CREATE INDEX IF NOT EXISTS "${indexName}" ON "${this._config.tableName}" ("${columnName}")`
						);
					}
				}
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
	 * Returns the health status of the component.
	 * @returns The health status of the component.
	 */
	public async health(): Promise<IHealth[]> {
		try {
			const sql = await this.getClient();
			await sql`SELECT 1 FROM ${sql(this._config.tableName)} LIMIT 0`;
			return [
				{
					source: PostgreSqlEntityStorageConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Ok,
					description: "healthDescription",
					data: { tableName: this._config.tableName }
				}
			];
		} catch {
			return [
				{
					source: PostgreSqlEntityStorageConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
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
		await ConnectionHelper.closeClient<postgres.Sql>(
			"postgreSqlConnections",
			`${this._config.host}|${this._config.port ?? 5432}|${this._config.user}|${this._config.database}`,
			this._instanceId,
			this._mutexTimeoutMs,
			async sql => sql.end()
		);
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
			const dbConnection = await this.getClient();

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
							Is.string(row[propColumn])
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
	 * @throws ConflictError when the entity exists but the supplied conditions or version do not match the stored state.
	 */
	public async set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void> {
		Guards.object<T>(PostgreSqlEntityStorageConnector.CLASS_NAME, nameof(entity), entity);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const submittedVersion = Is.stringValue(this._versionKey)
			? Coerce.integer(ObjectHelper.propertyGet(entity, this._versionKey))
			: undefined;
		const hasVersionCheck =
			!Is.empty(this._versionKey) && !Is.empty(submittedVersion) && submittedVersion > 0;

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
		const optimisticMutexKey = Is.stringValue(this._versionKey)
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
						throw new ConflictError(
							PostgreSqlEntityStorageConnector.CLASS_NAME,
							"conditionFailed",
							id
						);
					}
				}
				ObjectHelper.propertySet(prepared, this._versionKey, submittedVersion + 1);
			} else if (this._versionKey || Is.arrayValue(conditions)) {
				const currentEntity = await this.get(id);
				if (!Is.empty(currentEntity)) {
					if (Is.arrayValue(conditions) && !this.verifyConditions(conditions, currentEntity)) {
						if (Is.stringValue(this._versionKey)) {
							throw new ConflictError(
								PostgreSqlEntityStorageConnector.CLASS_NAME,
								"conditionFailed",
								id
							);
						}
						return;
					}
				}
				if (Is.stringValue(this._versionKey)) {
					const storedVersion =
						Coerce.integer(
							!Is.empty(currentEntity)
								? ObjectHelper.propertyGet(currentEntity, this._versionKey)
								: 0
						) ?? 0;
					ObjectHelper.propertySet(prepared, this._versionKey, storedVersion + 1);
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

			if (hasVersionCheck) {
				sql += ` DO UPDATE SET ${keys.map(key => `"${key}" = EXCLUDED."${key}"`).join(", ")}`;
				sql += ` WHERE "${this._config.tableName}"."${this._versionKey}" = $${values.length + 1}`;
				values.push(submittedVersion);
			} else {
				sql += ` DO UPDATE SET ${keys.map(key => `"${key}" = EXCLUDED."${key}"`).join(", ")};`;
			}

			const dbConnection = await this.getClient();
			const result = await dbConnection.unsafe(sql, values as ParameterOrJSON<never>[]);

			if (hasVersionCheck && result.count === 0) {
				throw new ConflictError(
					PostgreSqlEntityStorageConnector.CLASS_NAME,
					"optimisticLockFailed",
					id
				);
			}
		} catch (err) {
			if (BaseError.isErrorName(err, ConflictError.CLASS_NAME)) {
				throw err;
			}
			throw new GeneralError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
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

			const dbConnection = await this.getClient();
			const chunkSize = PostgreSqlEntityStorageConnector._BATCH_CHUNK_SIZE;

			for (let offset = 0; offset < preparedEntities.length; offset += chunkSize) {
				const chunk = preparedEntities.slice(offset, offset + chunkSize);
				const allValues: unknown[] = [];
				const rowPlaceholders: string[] = [];

				for (const prepared of chunk) {
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

				await dbConnection.unsafe(sql, allValues as ParameterOrJSON<never>[]);
			}
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
			const dbConnection = await this.getClient();
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
		const optimisticMutexKey = Is.stringValue(this._versionKey)
			? this.buildOptimisticMutexKey(partitionKey, id)
			: undefined;

		if (Is.stringValue(optimisticMutexKey)) {
			await Mutex.lock(optimisticMutexKey, {
				throwOnTimeout: true,
				timeoutMs: this._mutexTimeoutMs
			});
		}

		try {
			const dbConnection = await this.getClient();

			const itemData = await this.get(id);
			if (!Is.empty(itemData)) {
				if (Is.arrayValue(conditions) && !this.verifyConditions(conditions, itemData)) {
					if (Is.stringValue(this._versionKey)) {
						throw new ConflictError(
							PostgreSqlEntityStorageConnector.CLASS_NAME,
							"conditionFailed",
							id
						);
					}
					return;
				}

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
			if (BaseError.isErrorName(err, ConflictError.CLASS_NAME)) {
				throw err;
			}
			throw new GeneralError(
				PostgreSqlEntityStorageConnector.CLASS_NAME,
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
			const dbConnection = await this.getClient();
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
				const dbConnection = await this.getClient();
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
	 * Get the connector implementation version.
	 * @returns The connector implementation version.
	 */
	public connectorVersion(): number {
		return 0;
	}

	/**
	 * Get all the distinct partition context ids from the storage.
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
			const dbConnection = await this.getClient();
			const rows = await dbConnection.unsafe(
				`SELECT DISTINCT "${PostgreSqlEntityStorageConnector._PARTITION_KEY}" FROM "${this._config.tableName}"`
			);
			const partitionIds = (rows as { [key: string]: string }[])
				.map(row => row[PostgreSqlEntityStorageConnector._PARTITION_KEY])
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
					source: PostgreSqlEntityStorageConnector.CLASS_NAME,
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

		const dbConnection = await targetConnector.getClient();
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

			const pkPropName = String(this._primaryKeyProperty.property);

			const sortsByPK =
				Is.array(sortProperties) && sortProperties.some(s => String(s.property) === pkPropName);

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
				selectClause = [...selectSet].map(p => `"${p}"`).join(", ");
			} else {
				selectClause = "*";
			}

			const orderByClause = `ORDER BY ${keySetCols.map(c => `"${c.prop}" ${c.asc ? "ASC" : "DESC"}`).join(", ")}`;

			const { whereClauses, values } = this.buildWhereClause(conditions, partitionKey);

			if (Is.stringBase64(cursor)) {
				const parsedCursor = ObjectHelper.fromBytes<{ i: string; sv?: unknown[] }>(
					Converter.base64ToBytes(cursor)
				);
				const lastValues: unknown[] = [...(parsedCursor.sv ?? []), parsedCursor.i];
				const orParts: string[] = [];
				for (let i = 0; i < keySetCols.length; i++) {
					const parts: string[] = [];
					for (let j = 0; j < i; j++) {
						values.push(lastValues[j] as ParameterOrJSON<never>);
						parts.push(`"${keySetCols[j].prop}" = $${values.length}`);
					}
					const op = keySetCols[i].asc ? ">" : "<";
					values.push(lastValues[i] as ParameterOrJSON<never>);
					parts.push(`"${keySetCols[i].prop}" ${op} $${values.length}`);
					orParts.push(parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`);
				}
				whereClauses.push(`(${orParts.join(" OR ")})`);
			}

			sql = `SELECT ${selectClause} FROM "${this._config.tableName}"`;
			if (whereClauses.length > 0) {
				sql += ` WHERE ${whereClauses.join(" AND ")}`;
			}
			sql += ` ${orderByClause} LIMIT ${returnSize + 1}`;

			const dbConnection = await this.getClient();
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

			let nextCursor: string | undefined;
			if (hasMore && entities.length > 0) {
				const lastRow = entities[entities.length - 1];
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
					PostgreSqlEntityStorageConnector._PARTITION_KEY
				]);
				for (const col of internallyAdded) {
					ObjectHelper.propertyDelete(entities[i], col);
				}
			}

			return { entities, cursor: nextCursor };
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
			const dbConnection = await this.getClient();

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
	 * @param adminClient The server-level connection to use for the check.
	 * @returns True if the database exists, false otherwise.
	 * @internal
	 */
	private async databaseExists(adminClient: postgres.Sql): Promise<boolean> {
		try {
			const res = await adminClient.unsafe(
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
	 * @param adminClient The server-level connection to use for the check.
	 * @returns Nothing.
	 * @internal
	 */
	private async waitForDatabaseExists(adminClient: postgres.Sql): Promise<void> {
		for (let attempt = 0; attempt < 20; attempt++) {
			const databaseExists = await this.databaseExists(adminClient);
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
			const dbConnection = await this.getClient();
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
	 * Retrieve (or lazily create) the shared postgres connection for this endpoint and database.
	 * @returns The shared connection.
	 * @internal
	 */
	private async getClient(): Promise<postgres.Sql> {
		return ConnectionHelper.openClient<postgres.Sql>(
			"postgreSqlConnections",
			`${this._config.host}|${this._config.port ?? 5432}|${this._config.user}|${this._config.database}`,
			this._instanceId,
			this._mutexTimeoutMs,
			async () => postgres(this.createConnectionConfig())
		);
	}

	/**
	 * Create a new DB connection configuration.
	 * @param includeDatabase Whether to include the database name in the options.
	 * @returns The PostgreSql connection configuration.
	 * @internal
	 */
	private createConnectionConfig(
		includeDatabase: boolean = true
	): postgres.Options<{ [key: string]: postgres.PostgresType }> {
		const opts: { [key: string]: unknown } = {
			host: this._config.host,
			port: this._config.port ?? 5432,
			user: this._config.user,
			password: this._config.password,
			max: this._config?.pool?.max,
			// eslint-disable-next-line camelcase
			idle_timeout: this._config?.pool?.idleTimeout,
			// eslint-disable-next-line camelcase
			connect_timeout: this._config?.pool?.connectTimeout,
			// eslint-disable-next-line camelcase
			max_lifetime: this._config?.pool?.maxLifetime
		};
		if (includeDatabase) {
			opts.database = this._config.database;
		}
		return opts;
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
				// PostgreSQL rejects `IN ()` as a syntax error - short-circuit to a condition
				// that is always false so the query returns zero rows cleanly (#141).
				return "1 = 0";
			}
			values.push(...inValues.map(val => this.propertyToDbValue(val, type)));
			const placeholders = inValues.map((value, index) => `$${valueIndex + index}`).join(", ");
			return `"${prop}" IN (${placeholders})`;
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
	 * Build a mutex key for optimistic-locking critical sections.
	 * @param partitionKey The resolved partition key.
	 * @param id The entity id.
	 * @returns The mutex key.
	 * @internal
	 */
	private buildOptimisticMutexKey(partitionKey: string | undefined, id: string): string {
		return `${PostgreSqlEntityStorageConnector.CLASS_NAME}:optimistic:${this._config.tableName}:${partitionKey ?? PostgreSqlEntityStorageConnector._PARTITION_KEY_VALUE}:${id}`;
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
