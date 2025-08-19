// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

import { ComponentFactory, GeneralError, Guards, Is, StringHelper } from "@twin.org/core";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	LogicalOperator,
	SortDirection,
	type EntityCondition,
	type IComparator,
	type IComparatorGroup,
	type IEntitySchema,
	type IEntitySchemaProperty
} from "@twin.org/entity";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { types as CassandraTypes, Client } from "cassandra-driver";
import type { IScyllaDBConfig } from "./models/IScyllaDBConfig";
import type { IScyllaDBTableConfig } from "./models/IScyllaDBTableConfig";

/**
 * Store entities using ScyllaDB.
 */
export abstract class AbstractScyllaDBConnector<T> {
	/**
	 * Limit the number of entities when finding.
	 * @internal
	 */
	protected static readonly PAGE_SIZE: number = 40;

	/**
	 * Runtime name for the class.
	 * @internal
	 */
	public readonly CLASS_NAME: string;

	/**
	 * The name of the database table.
	 * @internal
	 */
	protected _fullTableName: string;

	/**
	 * Configuration to connection to ScyllaDB.
	 * @internal
	 */
	protected readonly _config: IScyllaDBConfig;

	/**
	 * The logging component.
	 * @internal
	 */
	protected readonly _logging?: ILoggingComponent;

	/**
	 * The schema for the entity.
	 * @internal
	 */
	protected readonly _entitySchema: IEntitySchema<T>;

	/**
	 * The primary key.
	 * @internal
	 */
	protected readonly _primaryKey: IEntitySchemaProperty<T>;

	/**
	 * Create a new instance of AbstractScyllaDBConnector.
	 * @param options The options for the connector.
	 * @param options.loggingComponentType The type of logging component to use, defaults to no logging.
	 * @param options.entitySchema The name of the entity schema.
	 * @param options.config The configuration for the connector.
	 * @param className The name of the derived class.
	 */
	constructor(
		options: {
			loggingComponentType?: string;
			entitySchema: string;
			config: IScyllaDBTableConfig;
		},
		className: string
	) {
		this.CLASS_NAME = className;

		Guards.object(this.CLASS_NAME, nameof(options), options);
		Guards.stringValue(this.CLASS_NAME, nameof(options.entitySchema), options.entitySchema);
		Guards.object<IScyllaDBConfig>(this.CLASS_NAME, nameof(options.config), options.config);
		Guards.arrayValue(this.CLASS_NAME, nameof(options.config.hosts), options.config.hosts);
		Guards.stringValue(
			this.CLASS_NAME,
			nameof(options.config.localDataCenter),
			options.config.localDataCenter
		);
		Guards.stringValue(this.CLASS_NAME, nameof(options.config.keyspace), options.config.keyspace);

		this._logging = ComponentFactory.getIfExists(options.loggingComponentType ?? "logging");

		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._primaryKey = EntitySchemaHelper.getPrimaryKey<T>(this._entitySchema);

		this._config = options.config;
		this._fullTableName = StringHelper.camelCase(
			Is.stringValue(options.config.tableName) ? options.config.tableName : options.entitySchema
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
		Guards.stringValue(this.CLASS_NAME, nameof(id), id);

		let connection;
		try {
			const indexField = secondaryIndex ?? this._primaryKey?.property;

			let sql = `SELECT * FROM "${this._fullTableName}" WHERE "${String(indexField)}"=?`;

			if (secondaryIndex) {
				sql += "ALLOW FILTERING";
			}

			await this._logging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "sql",
				data: { sql }
			});

			connection = await this.openConnection();

			const result = await this.queryDB(connection, sql, [id]);

			if (result.rows.length === 1) {
				return this.convertRowToObject(result.rows[0]);
			}
		} catch (error) {
			throw new GeneralError(
				this.CLASS_NAME,
				"getFailed",
				{
					id
				},
				error
			);
		} finally {
			await this.closeConnection(connection);
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
		sortProperties?: {
			property: keyof T;
			sortDirection: SortDirection;
		}[],
		properties?: (keyof T)[],
		cursor?: string,
		pageSize?: number
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
		let connection;
		try {
			let returnSize = pageSize ?? AbstractScyllaDBConnector.PAGE_SIZE;
			let sql = `SELECT * FROM "${this._fullTableName}"`;

			if (Is.array(properties)) {
				const fields: string[] = [];

				for (const property of properties) {
					fields.push(property.toString());
				}

				const selectFields = fields.join(",");
				sql = sql.replace("*", selectFields);
			}

			const conds: string[] = [];
			let conditionQuery = "";
			// The params to be used to execute the query
			const params: unknown[] = [];

			let theConditions: EntityCondition<T>[] = [];
			if (!Is.undefined(conditions)) {
				if ("conditions" in conditions) {
					theConditions = (conditions as IComparatorGroup).conditions;
				} else {
					theConditions.push(conditions as EntityCondition<T>);
				}
			}

			// TODO: This code needs refactoring to support conditions for sub properties.
			for (const cond of theConditions) {
				const condition = cond as IComparator;

				const descriptor = this._entitySchema.properties?.find(
					p => p.property === condition.property
				);
				if (
					condition.comparison === ComparisonOperator.Includes ||
					condition.comparison === ComparisonOperator.NotIncludes
				) {
					const propValue = `'%${condition.value}%'`;
					if (condition.comparison === ComparisonOperator.Includes) {
						conds.push(`"${condition.property}" LIKE ${propValue}`);
					} else if (condition.comparison === ComparisonOperator.NotIncludes) {
						conds.push(`"${condition.property}" NOT LIKE ${propValue}`);
					}
				} else if (condition.comparison === ComparisonOperator.In) {
					let value: unknown[] = [];
					if (!Is.arrayValue(condition.value)) {
						value.push(this.propertyToDbValue(condition.value, descriptor));
					} else {
						value = condition.value.map(v => this.propertyToDbValue(v, descriptor));
					}
					params.push(value);
					conds.push(`"${condition.property}" IN ?`);
				} else {
					const propValue = condition.value;
					params.push(propValue);
					if (condition.comparison === ComparisonOperator.Equals) {
						conds.push(`"${condition.property}" = ?`);
					} else if (condition.comparison === ComparisonOperator.NotEquals) {
						conds.push(`"${condition.property}" <> ?`);
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

				const operator = (conditions as IComparatorGroup).logicalOperator ?? LogicalOperator.And;
				conditionQuery = `${conds.join(` ${operator} `)}`;
			}

			if (conditionQuery.length > 0) {
				sql += ` WHERE ${conditionQuery}`;
			}

			connection = await this.openConnection();

			// TODO: Only supported one sort property at the moment. This code would need to be revised in a follow-up
			if (Is.array(sortProperties) && sortProperties.length >= 1) {
				const sortKey = sortProperties[0].property ?? this._primaryKey.property;
				const sortDir =
					sortProperties[0].sortDirection ??
					this._entitySchema.properties?.find(e => e.property === sortKey)?.sortDirection;

				let sqlSortDir = "asc";
				if (sortDir === SortDirection.Descending) {
					sqlSortDir = "desc";
				}

				sql += ` ORDER BY "${String(sortKey)}" ${sqlSortDir.toUpperCase()}`;
				// Disabling paging in order by situations
				returnSize = 0;
			}

			await this._logging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "sql",
				data: { sql }
			});

			const result = await this.queryDB(connection, sql, params, cursor, returnSize);

			const entities: Partial<T>[] = [];

			for (const row of result.rows) {
				entities.push(this.convertRowToObject(row));
			}

			return {
				entities,
				cursor: Is.stringValue(result.pageState) ? result.pageState : undefined
			};
		} catch (error) {
			throw new GeneralError(this.CLASS_NAME, "findFailed", { table: this._fullTableName }, error);
		} finally {
			await this.closeConnection(connection);
		}
	}

	/**
	 * Open a new database connection.
	 * @param config The config for the connection.
	 * @param skipKeySpace Don't include the keyspace in the connection.
	 * @returns The new connection.
	 * @internal
	 */
	protected async openConnection(skipKeySpace: boolean = false): Promise<Client> {
		const client = new Client({
			contactPoints: this._config.hosts,
			localDataCenter: this._config.localDataCenter,
			keyspace: skipKeySpace ? undefined : this._config.keyspace,
			protocolOptions: {
				port: this._config.port
			}
		});
		await client.connect();

		return client;
	}

	/**
	 * Close database connection.
	 * @param connection The connection to close.
	 * @internal
	 */
	protected async closeConnection(connection?: Client): Promise<void> {
		if (!connection) {
			return;
		}
		return connection.shutdown();
	}

	/**
	 * Query the database.
	 * @param connection The connection to query.
	 * @param sql The sql statement to execute.
	 * @param params The params to use when executing the query.
	 * @param state The state to use when it comes to pagination.
	 * @returns The rows.
	 * @internal
	 */
	protected async queryDB(
		connection: Client,
		sql: string,
		params: unknown[],
		pageState?: string,
		pageSize?: number
	): Promise<CassandraTypes.ResultSet> {
		return new Promise<CassandraTypes.ResultSet>((resolve, reject) => {
			const rows: CassandraTypes.Row[] = [];

			connection.eachRow(
				sql,
				params,
				{
					prepare: true,
					autoPage: false,
					fetchSize: pageSize ?? AbstractScyllaDBConnector.PAGE_SIZE,
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
	 * @internal
	 */
	protected async createKeyspace(
		connection: Client,
		keyspaceName: string
	): Promise<CassandraTypes.ResultSet> {
		return this.execute(
			connection,
			`CREATE KEYSPACE IF NOT EXISTS "${keyspaceName}"
            WITH REPLICATION = { 'class' : 'SimpleStrategy', 'replication_factor' : 1}`
		);
	}

	/**
	 * Format a field from the DB.
	 * @param value The value to convert to original form.
	 * @param fieldDescriptor The descriptor for the field.
	 * @returns The value as a property for the object.
	 * @internal
	 */
	protected dbValueToProperty(value: unknown, fieldDescriptor: IEntitySchemaProperty<T>): unknown {
		if (fieldDescriptor.type === "object") {
			if (
				value === "null" ||
				value === "undefined" ||
				value === "" ||
				value === null ||
				value === undefined
			) {
				return;
			}
		} else if (fieldDescriptor.type === "string" && fieldDescriptor.format === "json") {
			try {
				return JSON.parse(value as string);
			} catch {
				throw new GeneralError(this.CLASS_NAME, "parseJSONFailed", {
					name: fieldDescriptor.property,
					value
				});
			}
		} else if (fieldDescriptor.format === "uuid") {
			return (value as CassandraTypes.Uuid).toString();
		}

		return value;
	}

	/**
	 * Format a value for the DB. As the driver takes care of conversion from Javascript
	 * @param value The value to format.
	 * @param fieldDescriptor The descriptor for the field
	 * @returns The value after conversion.
	 * @internal
	 */
	protected propertyToDbValue(
		value: unknown,
		fieldDescriptor?: Pick<IEntitySchemaProperty<T>, "type" | "format">
	): unknown {
		if (fieldDescriptor) {
			// eslint-disable-next-line no-constant-condition
			if (fieldDescriptor.type === "string" && fieldDescriptor.format === "json") {
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
	 * @param row The row to convert.
	 * @returns The row as an object.
	 * @internal
	 */
	protected convertRowToObject(row: { [id: string]: unknown }): T {
		const obj: { [id: string]: unknown } = {};

		for (const field of this._entitySchema.properties ?? []) {
			const value = row[field.property as string];
			if (value) {
				obj[field.property as string] = this.dbValueToProperty(value, field);
			}
		}

		return obj as T;
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

		// eslint-disable-next-line no-control-regex
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
}
