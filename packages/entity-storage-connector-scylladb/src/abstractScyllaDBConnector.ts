// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdHelper, ContextIdStore } from "@twin.org/context";
import {
	Coerce,
	ComponentFactory,
	GeneralError,
	Guards,
	Is,
	type IValidationFailure,
	RandomHelper,
	Validation
} from "@twin.org/core";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaPropertyFormat,
	EntitySchemaPropertyType,
	EntitySchemaHelper,
	LogicalOperator,
	SortDirection,
	type EntityCondition,
	type IComparator,
	type IComparatorGroup,
	type IEntitySchema,
	type IEntitySchemaProperty
} from "@twin.org/entity";
import { ConnectionHelper, EntityStorageHelper } from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { types as CassandraTypes, Client } from "cassandra-driver";
import type { IScyllaDBConfig } from "./models/IScyllaDBConfig.js";
import type { IScyllaDBTableConfig } from "./models/IScyllaDBTableConfig.js";

/**
 * Store entities using ScyllaDB.
 */
export abstract class AbstractScyllaDBConnector<T> {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<AbstractScyllaDBConnector<unknown>>();

	/**
	 * Partition id field name.
	 * @internal
	 */
	protected static readonly PARTITION_KEY: string = "partitionId";

	/**
	 * Partition id field value.
	 * @internal
	 */
	protected static readonly PARTITION_KEY_VALUE: string = "root";

	/**
	 * Limit the number of entities when finding.
	 * @internal
	 */
	protected static readonly DEFAULT_LIMIT: number = 40;

	/**
	 * The name of the database table.
	 * @internal
	 */
	protected _fullTableName: string;

	/**
	 * Configuration to connection to ScyllaDB.
	 * @internal
	 */
	protected readonly _config: IScyllaDBTableConfig;

	/**
	 * The logging component.
	 * @internal
	 */
	protected readonly _logging?: ILoggingComponent;

	/**
	 * The schema for the entity.
	 * @internal
	 */
	protected _entitySchema: IEntitySchema<T>;

	/**
	 * The keys to use from the context ids to create partitions.
	 * @internal
	 */
	protected readonly _partitionContextIds?: string[];

	/**
	 * The primary key.
	 * @internal
	 */
	protected readonly _primaryKey: IEntitySchemaProperty<T>;

	/**
	 * The name of the version property, if any.
	 * @internal
	 */
	protected readonly _versionKey?: string;

	/**
	 * Milliseconds to wait for optimistic-lock mutexes before throwing.
	 * @internal
	 */
	protected readonly _mutexTimeoutMs?: number;

	/**
	 * Unique identifier for this connector instance, used to track references in SharedStore.
	 * @internal
	 */
	private readonly _instanceId: string;

	/**
	 * Temporary connections opened with skipKeySpace=true, tracked for lifecycle management.
	 * @internal
	 */
	private readonly _temporaryConnections: WeakSet<Client>;

	/**
	 * Create a new instance of AbstractScyllaDBConnector.
	 * @param options The options for the connector.
	 * @param options.loggingComponentType The type of logging component to use, defaults to no logging.
	 * @param options.entitySchema The name of the entity schema.
	 * @param options.partitionContextIds The keys to use from the context ids to create partitions.
	 * @param options.config The configuration for the connector.
	 */
	constructor(options: {
		loggingComponentType?: string;
		entitySchema: string;
		partitionContextIds?: string[];
		config: IScyllaDBTableConfig;
	}) {
		Guards.object(AbstractScyllaDBConnector.CLASS_NAME, nameof(options), options);
		Guards.stringValue(
			AbstractScyllaDBConnector.CLASS_NAME,
			nameof(options.entitySchema),
			options.entitySchema
		);
		Guards.object<IScyllaDBConfig>(
			AbstractScyllaDBConnector.CLASS_NAME,
			nameof(options.config),
			options.config
		);
		Guards.arrayValue(
			AbstractScyllaDBConnector.CLASS_NAME,
			nameof(options.config.hosts),
			options.config.hosts
		);
		Guards.stringValue(
			AbstractScyllaDBConnector.CLASS_NAME,
			nameof(options.config.localDataCenter),
			options.config.localDataCenter
		);
		Guards.stringValue(
			AbstractScyllaDBConnector.CLASS_NAME,
			nameof(options.config.keyspace),
			options.config.keyspace
		);

		if (!Is.empty(options.config.pool?.coreConnectionsPerHost)) {
			Guards.integer(
				AbstractScyllaDBConnector.CLASS_NAME,
				nameof(options.config.pool?.coreConnectionsPerHost),
				options.config.pool?.coreConnectionsPerHost
			);
		}

		if (!Is.empty(options.config.pool?.maxRequestsPerConnection)) {
			Guards.integer(
				AbstractScyllaDBConnector.CLASS_NAME,
				nameof(options.config.pool?.maxRequestsPerConnection),
				options.config.pool?.maxRequestsPerConnection
			);
		}

		this._logging = ComponentFactory.getIfExists(options.loggingComponentType);

		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._partitionContextIds = options.partitionContextIds;
		this._primaryKey = EntitySchemaHelper.getPrimaryKey<T>(this._entitySchema);
		this._versionKey = EntitySchemaHelper.findVersionProperty(this._entitySchema);
		this._mutexTimeoutMs = Coerce.integer(options.config.mutexTimeoutMs);

		this._config = options.config;
		this._fullTableName = options.config.tableName;
		this._instanceId = RandomHelper.generateUuidV7("compact");
		this._temporaryConnections = new WeakSet();
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return AbstractScyllaDBConnector.CLASS_NAME;
	}

	/**
	 * Get the schema for the entities.
	 * @returns The schema for the entities.
	 */
	public getSchema(): IEntitySchema {
		return this._entitySchema as IEntitySchema;
	}

	/**
	 * The component needs to be stopped when the node is closed.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns Nothing.
	 */
	public async stop(nodeLoggingComponentType?: string): Promise<void> {
		await this.closePersistentClient();
	}

	/**
	 * Get an entity.
	 * @param id The id of the entity to get.
	 * @param secondaryIndex Get the item using a secondary index.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The object if it can be found or undefined.
	 */
	public async get(
		id: string,
		secondaryIndex?: keyof T,
		conditions?: { property: keyof T; value: unknown }[]
	): Promise<T | undefined> {
		Guards.stringValue(AbstractScyllaDBConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const indexField = secondaryIndex ?? this._primaryKey?.property;

			conditions ??= [];
			conditions.unshift({
				property: AbstractScyllaDBConnector.PARTITION_KEY as keyof T,
				value: partitionKey ?? AbstractScyllaDBConnector.PARTITION_KEY_VALUE
			});
			conditions.unshift({
				property: indexField,
				value: id
			});

			const { sqlCondition, conditionValues } = this.buildConditions(conditions);

			let sql = `SELECT * FROM "${this.safeTableName(this._fullTableName)}" WHERE ${sqlCondition}`;

			if (secondaryIndex) {
				sql += " ALLOW FILTERING";
			}

			await this._logging?.log({
				level: "info",
				source: AbstractScyllaDBConnector.CLASS_NAME,
				ts: Date.now(),
				message: "sql",
				data: { sql }
			});

			const connection = await this.getClient();

			const result = await this.queryDB(connection, sql, conditionValues);

			if (result.rows.length === 1) {
				return this.convertRowToObject(this._entitySchema.properties, result.rows[0]);
			}
		} catch (error) {
			throw new GeneralError(
				AbstractScyllaDBConnector.CLASS_NAME,
				"getFailed",
				{
					id
				},
				error
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

		EntityStorageHelper.validateSortProperties(this._entitySchema, sortProperties);
		EntityStorageHelper.validateProperties(this._entitySchema, properties);

		if (!Is.empty(limit)) {
			const validationFailures: IValidationFailure[] = [];
			Validation.integer(nameof(limit), limit, validationFailures, undefined, { minValue: 1 });
			Validation.asValidationError(
				AbstractScyllaDBConnector.CLASS_NAME,
				"query",
				validationFailures
			);
		}

		// CQL ORDER BY is only valid on clustering columns (isPrimary). Secondary-index
		// properties cannot be used; throw before reaching the try-catch so the error
		// surfaces directly to the caller without being wrapped as findFailed.
		if (Is.arrayValue(sortProperties)) {
			for (const sortProperty of sortProperties) {
				const propertySchema = this._entitySchema.properties?.find(
					p => p.property === sortProperty.property
				);
				if (!propertySchema?.isPrimary) {
					throw new GeneralError(AbstractScyllaDBConnector.CLASS_NAME, "sortOnlyPrimaryKey", {
						property: sortProperty.property
					});
				}
			}
		}

		// Validates and throws for unsupported conditions before entering the try-catch
		// so that comparisonNotSupported errors surface directly to the caller.
		const { whereClause, params, noResults } = this.buildCqlConditions(conditions, partitionKey);

		if (noResults) {
			return { entities: [], cursor: undefined };
		}

		try {
			const returnSize = limit ?? AbstractScyllaDBConnector.DEFAULT_LIMIT;
			let sql = `SELECT * FROM "${this.safeTableName(this._fullTableName)}"`;

			if (Is.array(properties)) {
				const fields: string[] = [];
				for (const property of properties) {
					fields.push(property.toString());
				}
				sql = sql.replace("*", fields.join(","));
			}

			sql += ` WHERE ${whereClause}`;

			if (Is.array(sortProperties) && sortProperties.length >= 1) {
				const orderClauses = sortProperties.map(sp => {
					const dir = sp.sortDirection === SortDirection.Descending ? "DESC" : "ASC";
					return `"${String(sp.property)}" ${dir}`;
				});
				sql += ` ORDER BY ${orderClauses.join(", ")}`;
			}

			const connection = await this.getClient();

			sql += " ALLOW FILTERING";

			await this._logging?.log({
				level: "info",
				source: AbstractScyllaDBConnector.CLASS_NAME,
				ts: Date.now(),
				message: "sql",
				data: { sql }
			});

			const result = await this.queryDB(connection, sql, params, cursor, returnSize);

			const entities: Partial<T>[] = [];

			for (const row of result.rows) {
				entities.push(this.convertRowToObject(this._entitySchema.properties, row));
			}

			// ScyllaDB may return a pageState even when the current page is the last one
			// (when rows.length == fetchSize). Peek at the next page to verify there are
			// actually more rows before surfacing the cursor to the caller.
			let nextCursor: string | undefined;
			if (returnSize > 0 && result.rows.length >= returnSize && Is.stringValue(result.pageState)) {
				const peek = await this.queryDB(connection, sql, params, result.pageState, 1);
				if (peek.rows.length > 0) {
					nextCursor = result.pageState;
				}
			}

			return {
				entities,
				cursor: nextCursor
			};
		} catch (error) {
			throw new GeneralError(
				AbstractScyllaDBConnector.CLASS_NAME,
				"findFailed",
				{ table: this.safeTableName(this._fullTableName) },
				error
			);
		}
	}

	/**
	 * Count all the entities which match the conditions.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The total count of entities in the storage.
	 */
	public async count(conditions?: EntityCondition<T>): Promise<number> {
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);
		const { whereClause, params, noResults } = this.buildCqlConditions(conditions, partitionKey);

		if (noResults) {
			return 0;
		}

		try {
			const sql = `SELECT COUNT(*) FROM "${this.safeTableName(this._fullTableName)}" WHERE ${whereClause} ALLOW FILTERING`;

			const connection = await this.getClient();
			const result = await this.queryDB(connection, sql, params);
			return Number(result.rows[0]?.get("count") ?? 0);
		} catch (err) {
			throw new GeneralError(AbstractScyllaDBConnector.CLASS_NAME, "countFailed", undefined, err);
		}
	}

	/**
	 * Open a keyspace-free connection for bootstrap operations such as keyspace creation.
	 * @returns A temporary client not bound to any keyspace.
	 * @internal
	 */
	protected async openConnectionNoKeyspace(): Promise<Client> {
		const client = new Client({
			contactPoints: this._config.hosts,
			localDataCenter: this._config.localDataCenter,
			protocolOptions: { port: this._config.port }
		});
		await client.connect();
		this._temporaryConnections.add(client);
		return client;
	}

	/**
	 * Close a temporary connection opened via openConnectionNoKeyspace.
	 * @param connection The temporary connection to shut down.
	 * @returns Nothing.
	 * @internal
	 */
	protected async closeConnectionNoKeyspace(connection: Client): Promise<void> {
		if (this._temporaryConnections.has(connection)) {
			this._temporaryConnections.delete(connection);
			return connection.shutdown();
		}
	}

	/**
	 * Release this instance's reference to the shared client. When the last reference
	 * is released the underlying TCP connection is shut down.
	 * @internal
	 */
	protected async closePersistentClient(): Promise<void> {
		await ConnectionHelper.closeClient<Client>(
			"scyllaDbClients",
			this.createClientId(),
			this._instanceId,
			this._mutexTimeoutMs,
			async client => client.shutdown()
		);
	}

	/**
	 * Query the database.
	 * @param connection The connection to query.
	 * @param sql The sql statement to execute.
	 * @param params The params to use when executing the query.
	 * @param pageState The page state to use when it comes to pagination.
	 * @param limit The maximum number of rows to return.
	 * @returns The rows.
	 * @internal
	 */
	protected async queryDB(
		connection: Client,
		sql: string,
		params: unknown[],
		pageState?: string,
		limit?: number
	): Promise<CassandraTypes.ResultSet> {
		return new Promise<CassandraTypes.ResultSet>((resolve, reject) => {
			const rows: CassandraTypes.Row[] = [];

			connection.eachRow(
				sql,
				params,
				{
					prepare: true,
					autoPage: false,
					fetchSize: limit ?? AbstractScyllaDBConnector.DEFAULT_LIMIT,
					pageState
				},
				(n: number, row: CassandraTypes.Row) => {
					rows.push(row);
				},
				(err: Error, res: CassandraTypes.ResultSet) => {
					if (err) {
						reject(err);
						return;
					}
					res.rows = rows;
					resolve(res);
				}
			);
		});
	}

	/**
	 * Execute on the database.
	 * @param connection The connection to execute.
	 * @param sql The sql statement to execute.
	 * @param params The optional params to use when executing the statement.
	 * @returns The result set.
	 * @internal
	 */
	protected async execute(
		connection: Client,
		sql: string,
		params?: unknown[]
	): Promise<CassandraTypes.ResultSet> {
		return connection.execute(sql, params, { prepare: true });
	}

	/**
	 * Create keyspace if it doesn't exist.
	 * @param connection The connection to perform the query with.
	 * @param keyspaceName The name of the keyspace to create.
	 * @returns The result set.
	 * @internal
	 */
	protected async createKeyspace(
		connection: Client,
		keyspaceName: string
	): Promise<CassandraTypes.ResultSet> {
		return this.execute(
			connection,
			`CREATE KEYSPACE IF NOT EXISTS "${keyspaceName}" WITH REPLICATION = { 'class' : 'SimpleStrategy', 'replication_factor' : 1}`
		);
	}

	/**
	 * Check if a keyspace exists.
	 * @param connection The connection to perform the query with.
	 * @param keyspaceName The name of the keyspace to check.
	 * @returns True if the keyspace exists, false otherwise.
	 * @internal
	 */
	protected async checkKeyspaceExists(connection: Client, keyspaceName: string): Promise<boolean> {
		const result = await this.queryDB(
			connection,
			"SELECT keyspace_name FROM system_schema.keyspaces WHERE keyspace_name = ?",
			[keyspaceName]
		);

		return result.rowLength > 0;
	}

	/**
	 * Check if a type exists.
	 * @param connection The connection to perform the query with.
	 * @param typeName The name of the type to check.
	 * @returns True if the type exists, false otherwise.
	 * @internal
	 */
	protected async checkTypeExists(connection: Client, typeName: string): Promise<boolean> {
		const result = await this.queryDB(
			connection,
			"SELECT type_name FROM system_schema.types WHERE type_name = ?",
			[typeName]
		);

		return result.rowLength > 0;
	}

	/**
	 * Check if a table exists.
	 * @param connection The connection to perform the query with.
	 * @param keyspaceName The name of the keyspace to check.
	 * @param tableName The name of the table to check.
	 * @returns True if the table exists, false otherwise.
	 * @internal
	 */
	protected async checkTableExists(
		connection: Client,
		keyspaceName: string,
		tableName: string
	): Promise<boolean> {
		const result = await this.queryDB(
			connection,
			"SELECT table_name FROM system_schema.tables WHERE keyspace_name = ? AND table_name = ?",
			[keyspaceName, tableName]
		);

		return result.rowLength > 0;
	}

	/**
	 * Format a field from the DB.
	 * @param value The value to convert to original form.
	 * @param fieldDescriptor The descriptor for the field.
	 * @returns The value as a property for the object.
	 * @throws GeneralError if parsing JSON fails.
	 * @internal
	 */
	protected dbValueToProperty(value: unknown, fieldDescriptor: IEntitySchemaProperty<T>): unknown {
		if (
			Is.stringValue(fieldDescriptor.itemTypeRef) &&
			(fieldDescriptor.type === EntitySchemaPropertyType.Object ||
				fieldDescriptor.type === EntitySchemaPropertyType.Array)
		) {
			const objSchema = EntitySchemaFactory.get(fieldDescriptor.itemTypeRef);
			return this.convertRowToObject(objSchema.properties, value as { [id: string]: unknown });
		} else if (
			// If the field is json format
			(fieldDescriptor.type === EntitySchemaPropertyType.String &&
				fieldDescriptor.format === EntitySchemaPropertyFormat.Json) ||
			// Or its and object or array without a type ref
			(!Is.stringValue(fieldDescriptor.itemTypeRef) &&
				(fieldDescriptor.type === EntitySchemaPropertyType.Object ||
					fieldDescriptor.type === EntitySchemaPropertyType.Array))
		) {
			try {
				return JSON.parse(value as string);
			} catch {
				throw new GeneralError(AbstractScyllaDBConnector.CLASS_NAME, "parseJSONFailed", {
					name: fieldDescriptor.property,
					value
				});
			}
		} else if (
			fieldDescriptor.type === EntitySchemaPropertyType.String &&
			(fieldDescriptor.format === EntitySchemaPropertyFormat.DateTime ||
				fieldDescriptor.format === EntitySchemaPropertyFormat.Date) &&
			Is.date(value)
		) {
			return Coerce.string(value);
		} else if (fieldDescriptor.type === EntitySchemaPropertyType.Object) {
			if (
				value === "null" ||
				value === "undefined" ||
				value === "" ||
				value === null ||
				value === undefined
			) {
				return null;
			}
		} else if (fieldDescriptor.format === EntitySchemaPropertyFormat.Uuid) {
			return (value as CassandraTypes.Uuid).toString();
		} else if (
			fieldDescriptor.type === EntitySchemaPropertyType.Integer &&
			CassandraTypes.Long.isLong(value)
		) {
			return value.toNumber();
		}

		return value;
	}

	/**
	 * Format a value for the DB.
	 * @param value The value to format.
	 * @param fieldDescriptor The descriptor for the field.
	 * @returns The value after conversion.
	 * @internal
	 */
	protected propertyToDbValue(value: unknown, fieldDescriptor?: IEntitySchemaProperty<T>): unknown {
		if (fieldDescriptor) {
			// If the field is json format
			if (
				(fieldDescriptor.type === "string" && fieldDescriptor.format === "json") ||
				// Or its and object or array without a type ref
				(!Is.stringValue(fieldDescriptor.itemTypeRef) &&
					(fieldDescriptor.type === "object" || fieldDescriptor.type === "array"))
			) {
				return Is.empty(value) ? "null" : this.jsonWrap(value);
			} else if (fieldDescriptor.format === "uuid") {
				if (!Is.string(value)) {
					return;
				}
				return CassandraTypes.Uuid.fromString(value);
			}
			return value;
		}
	}

	/**
	 * Convert a row back to an object.
	 * @param properties The optional properties to convert.
	 * @param row The row to convert.
	 * @returns The row as an object.
	 * @internal
	 */
	protected convertRowToObject(
		properties: IEntitySchemaProperty<T>[] | undefined,
		row: { [id: string]: unknown }
	): T {
		const obj: { [id: string]: unknown } = {};

		for (const field of properties ?? []) {
			const value = row[field.property as string];
			if (!Is.empty(value)) {
				obj[field.property as string] = this.dbValueToProperty(value, field);
			}
		}

		return EntityStorageHelper.unPrepareEntity(obj as T, [AbstractScyllaDBConnector.PARTITION_KEY]);
	}

	/**
	 * Wrap a string for DB format.
	 * @param value The value to wrap.
	 * @returns The wrapped string.
	 * @internal
	 */
	protected stringWrap(value: string): string {
		if (value === undefined || value === null) {
			return "''";
		}

		return `'${value.replace(/'/g, "''")}'`;
	}

	/**
	 * Wrap an object for json in DB format.
	 * @param value The value to wrap.
	 * @returns The wrapped string.
	 * @internal
	 */
	protected jsonWrap(value: unknown): string {
		let json = JSON.stringify(value);

		json = json.replace(/[\b\0\t\n\r\u001A\\]/g, s => {
			switch (s) {
				case "\0":
					return String.raw`\0`;
				case "\n":
					return String.raw`\n`;
				case "\r":
					return String.raw`\r`;
				case "\b":
					return String.raw`\b`;
				case "\t":
					return String.raw`\t`;
				case "\u001A":
					return String.raw`\Z`;
				default:
					return `\\${s}`;
			}
		});
		return json;
	}

	/**
	 * Build the conditions for the query.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The SQL conditions and the values.
	 * @internal
	 */
	protected buildConditions(conditions: { property: keyof T; value: unknown }[] | undefined): {
		sqlCondition: string;
		conditionValues: unknown[];
	} {
		const conditionValues: unknown[] = [];
		const sqlConditions: string[] = [];

		const properties = (this._entitySchema.properties ?? []).concat([
			{
				property: AbstractScyllaDBConnector.PARTITION_KEY,
				type: "string"
			} as IEntitySchemaProperty<T>
		]);

		if (Is.arrayValue(conditions)) {
			for (const condition of conditions) {
				const propName = condition.property as string;
				sqlConditions.push(`"${propName}"=?`);
				const schemaProperty = properties.find(s => s.property === condition.property);
				conditionValues.push(this.propertyToDbValue(condition.value, schemaProperty));
			}
		}
		return { sqlCondition: sqlConditions.join(" AND "), conditionValues };
	}

	/**
	 * Get a safe table name by replacing any non-alphanumeric characters.
	 * @param name The name to sanitize.
	 * @returns The safe table name.
	 */
	protected safeTableName(name: string): string {
		return name.replace(/[^\dA-Za-z]/g, "");
	}

	/**
	 * Retrieve (or lazily create) the shared ScyllaDB client for this endpoint.
	 * @returns The shared client.
	 * @internal
	 */
	protected async getClient(): Promise<Client> {
		return ConnectionHelper.openClient<Client>(
			"scyllaDbClients",
			this.createClientId(),
			this._instanceId,
			this._mutexTimeoutMs,
			async () => {
				const client = new Client({
					contactPoints: this._config.hosts,
					localDataCenter: this._config.localDataCenter,
					keyspace: this._config.keyspace,
					protocolOptions: { port: this._config.port },
					pooling: {
						coreConnectionsPerHost: {
							[CassandraTypes.distance.local]: this._config.pool?.coreConnectionsPerHost ?? 1,
							[CassandraTypes.distance.remote]: 1
						},
						maxRequestsPerConnection: this._config.pool?.maxRequestsPerConnection
					}
				});
				await client.connect();
				return client;
			}
		);
	}

	/**
	 * Build a stable cache key for the shared client based on connection parameters.
	 * @returns The client cache key.
	 * @internal
	 */
	private createClientId(): string {
		return `${[...this._config.hosts].sort().join(",")}|${this._config.localDataCenter}|${this._config.keyspace}`;
	}

	/**
	 * Recursively flatten nested AND-only groups into a flat list of comparators.
	 * @param conditions The group's conditions array to flatten.
	 * @returns A flat list of leaf comparators.
	 * @throws GeneralError if any OR group is encountered.
	 * @internal
	 */
	private flattenConditions(conditions: EntityCondition<T>[]): IComparator[] {
		const result: IComparator[] = [];
		for (const cond of conditions) {
			if ("conditions" in cond) {
				if (cond.logicalOperator === LogicalOperator.Or) {
					throw new GeneralError(AbstractScyllaDBConnector.CLASS_NAME, "orConditionNotSupported");
				}
				result.push(...this.flattenConditions(cond.conditions));
			} else {
				result.push(cond);
			}
		}
		return result;
	}

	/**
	 * Parse, validate, and build a CQL WHERE clause from an EntityCondition tree.
	 * The partition key equality is always the first clause; user conditions follow.
	 * @param conditions The optional conditions to match for the entities.
	 * @param partitionKey The partition key value to filter by.
	 * @returns The complete WHERE clause (without the WHERE keyword) and bound params.
	 * @throws GeneralError if OR conditions, dot-notation paths, null comparisons, NotEquals, or NotIncludes operators are used.
	 * @internal
	 */
	private buildCqlConditions(
		conditions: EntityCondition<T> | undefined,
		partitionKey: string | undefined
	): { whereClause: string; params: unknown[]; noResults?: boolean } {
		let conditionsList: IComparator[] = [];
		if (conditions !== undefined) {
			if ("conditions" in conditions) {
				if (conditions.logicalOperator === LogicalOperator.Or) {
					throw new GeneralError(AbstractScyllaDBConnector.CLASS_NAME, "orConditionNotSupported");
				}
				conditionsList = this.flattenConditions(conditions.conditions);
			} else {
				conditionsList = [conditions];
			}
		}

		for (const cond of conditionsList) {
			const comparator = cond;
			if (comparator.property.includes(".")) {
				throw new GeneralError(AbstractScyllaDBConnector.CLASS_NAME, "comparisonNotSupported", {
					property: comparator.property,
					reason: "dot-notation nested property paths are not supported in CQL"
				});
			}
			EntityStorageHelper.validateConditionProperties(this._entitySchema, cond);
			if (
				(comparator.comparison === ComparisonOperator.Equals ||
					comparator.comparison === ComparisonOperator.NotEquals) &&
				(comparator.value === null || comparator.value === undefined)
			) {
				throw new GeneralError(AbstractScyllaDBConnector.CLASS_NAME, "comparisonNotSupported", {
					property: comparator.property,
					reason: "null/undefined comparisons are not supported in CQL WHERE clauses"
				});
			}
			if (comparator.comparison === ComparisonOperator.NotEquals) {
				throw new GeneralError(AbstractScyllaDBConnector.CLASS_NAME, "notEqualsNotSupported", {
					property: comparator.property
				});
			}
			if (comparator.comparison === ComparisonOperator.NotIncludes) {
				throw new GeneralError(AbstractScyllaDBConnector.CLASS_NAME, "notIncludesNotSupported", {
					property: comparator.property
				});
			}
		}

		const conds: string[] = [];
		const params: unknown[] = [partitionKey ?? AbstractScyllaDBConnector.PARTITION_KEY_VALUE];

		for (const cond of conditionsList) {
			const condition = cond;
			const descriptor = this._entitySchema.properties?.find(
				p => p.property === condition.property
			);
			if (
				condition.comparison === ComparisonOperator.Includes ||
				condition.comparison === ComparisonOperator.NotIncludes
			) {
				const serialized = this.propertyToDbValue(condition.value, descriptor);
				const searchStr = Is.stringValue(serialized) ? serialized : "";
				params.push(`%${searchStr}%`);
				if (condition.comparison === ComparisonOperator.Includes) {
					conds.push(`"${condition.property}" LIKE ?`);
				} else {
					conds.push(`"${condition.property}" NOT LIKE ?`);
				}
			} else if (condition.comparison === ComparisonOperator.In) {
				// Guard must come first: Is.arrayValue([]) returns false for an empty array,
				// so an empty value would be wrapped as a single element below and bypass
				// the length check. Check Is.array (true for any array) before branching (#141).
				if (Is.array(condition.value) && condition.value.length === 0) {
					return {
						whereClause: "",
						params: [],
						noResults: true
					};
				}
				let value: unknown[] = [];
				if (!Is.arrayValue(condition.value)) {
					value.push(this.propertyToDbValue(condition.value, descriptor));
				} else {
					value = condition.value.map(v => this.propertyToDbValue(v, descriptor));
				}
				params.push(value);
				conds.push(`"${condition.property}" IN ?`);
			} else {
				const propValue = this.propertyToDbValue(condition.value, descriptor);
				params.push(propValue);
				if (condition.comparison === ComparisonOperator.Equals) {
					conds.push(`"${condition.property}" = ?`);
				} else if (condition.comparison === ComparisonOperator.NotEquals) {
					conds.push(`"${condition.property}" != ?`);
				} else if (condition.comparison === ComparisonOperator.GreaterThan) {
					conds.push(`"${condition.property}" > ?`);
				} else if (condition.comparison === ComparisonOperator.LessThan) {
					conds.push(`"${condition.property}" < ?`);
				} else if (condition.comparison === ComparisonOperator.GreaterThanOrEqual) {
					conds.push(`"${condition.property}" >= ?`);
				} else if (condition.comparison === ComparisonOperator.LessThanOrEqual) {
					conds.push(`"${condition.property}" <= ?`);
				}
			}
		}

		const operator =
			"conditions" in (conditions ?? {})
				? ((conditions as IComparatorGroup).logicalOperator ?? LogicalOperator.And)
				: LogicalOperator.And;

		let whereClause = `"${AbstractScyllaDBConnector.PARTITION_KEY}" = ?`;
		if (conds.length > 0) {
			whereClause += ` AND ${conds.join(` ${operator} `)}`;
		}

		return { whereClause, params };
	}
}
