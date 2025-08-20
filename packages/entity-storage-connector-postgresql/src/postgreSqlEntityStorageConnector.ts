// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	BaseError,
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
	EntitySchemaPropertyType,
	type IComparator,
	type IEntitySchema,
	LogicalOperator,
	SortDirection
} from "@twin.org/entity";
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import postgres from "postgres";
import type { IPostgreSqlEntityStorageConnectorConfig } from "./models/IPostgreSqlEntityStorageConnectorConfig";
import type { IPostgreSqlEntityStorageConnectorConstructorOptions } from "./models/IPostgreSqlEntityStorageConnectorConstructorOptions";

/**
 * Class for performing entity storage operations using ql.
 */
export class PostgreSqlEntityStorageConnector<T = unknown> implements IEntityStorageConnector<T> {
	/**
	 * Limit the number of entities when finding.
	 * @internal
	 */
	private static readonly _PAGE_SIZE: number = 40;

	/**
	 * Runtime name for the class.
	 */
	public readonly CLASS_NAME: string = nameof<PostgreSqlEntityStorageConnector>();

	/**
	 * The schema for the entity.
	 * @internal
	 */
	private readonly _entitySchema: IEntitySchema<T>;

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
		Guards.object(this.CLASS_NAME, nameof(options), options);
		Guards.stringValue(this.CLASS_NAME, nameof(options.entitySchema), options.entitySchema);
		Guards.object<IPostgreSqlEntityStorageConnectorConfig>(
			this.CLASS_NAME,
			nameof(options.config),
			options.config
		);
		Guards.stringValue(this.CLASS_NAME, nameof(options.config.host), options.config.host);
		Guards.stringValue(this.CLASS_NAME, nameof(options.config.user), options.config.user);
		Guards.stringValue(this.CLASS_NAME, nameof(options.config.password), options.config.password);
		Guards.stringValue(this.CLASS_NAME, nameof(options.config.database), options.config.database);
		Guards.stringValue(this.CLASS_NAME, nameof(options.config.tableName), options.config.tableName);

		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);

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

			await nodeLogging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "databaseCreating",
				data: {
					database: this._config.database
				}
			});

			const res = await dbConnection.unsafe(
				`SELECT datname FROM pg_catalog.pg_database WHERE datname = '${this._config.database}'`
			);
			if (res.length === 0) {
				await dbConnection.unsafe(`CREATE DATABASE "${this._config.database}";`);
			}

			await nodeLogging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "databaseExists",
				data: {
					database: this._config.database
				}
			});

			const tableExistsQuery = `SELECT to_regclass('${this._config.tableName}')`;
			const tableExistsResult = await dbConnection.unsafe(tableExistsQuery);

			if (!tableExistsResult[0].to_regclass) {
				const createTableQuery = `CREATE TABLE IF NOT EXISTS ${this._config.tableName} (${this.mapPostgreSqlProperties(this._entitySchema)})`;
				await dbConnection.unsafe(createTableQuery);
			}

			await nodeLogging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "tableExists",
				data: {
					table: this._config.tableName
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
		Guards.stringValue(this.CLASS_NAME, nameof(id), id);

		try {
			const dbConnection = await this.createConnection();

			const whereClauses: string[] = [];
			const values: unknown[] = [];

			if (secondaryIndex) {
				whereClauses.push(`"${String(secondaryIndex)}" = $1`);
				values.push(id);
			} else {
				const primaryKey = EntitySchemaHelper.getPrimaryKey(this.getSchema());
				whereClauses.push(`"${primaryKey.property}" = $1`);
				values.push(id);
			}

			if (conditions) {
				for (const condition of conditions) {
					whereClauses.push(`"${String(condition.property)}" = $${values.length + 1}`);
					values.push(condition.value);
				}
			}

			const query = `SELECT * FROM "${this._config.tableName}" WHERE ${whereClauses.join(" AND ")} LIMIT 1`;
			const rows = await dbConnection.unsafe(query, values as postgres.ParameterOrJSON<never>[]);

			if (Array.isArray(rows) && rows.length === 1) {
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
							const rowValue = JSON.parse(
								(rows[0] as { [key: string]: unknown })[propColumn] as string
							);
							delete (rows[0] as { [key: string]: unknown })[propColumn];
							(rows[0] as { [key: string]: unknown })[prop.property as string] = rowValue;
						}
						if (row[propColumn] === null) {
							(rows[0] as { [key: string]: unknown })[prop.property as string] = undefined;
						}
					}
				}
				return rows[0] as T;
			}
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

		const primaryKey = EntitySchemaHelper.getPrimaryKey(this.getSchema());
		const id = entity[primaryKey.property as keyof T] as unknown as string;

		try {
			if (Is.arrayValue(conditions)) {
				const itemData = await this.get(id);
				if (Is.notEmpty(itemData) && !this.verifyConditions(conditions, itemData as T)) {
					return;
				}
			}
			const columns = Object.keys(entity as object)
				.map(key => `"${key}"`)
				.join(", ");
			// eslint-disable-next-line no-confusing-arrow
			const values = Object.values(entity as object).map(value =>
				value === undefined ? null : value
			);
			const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");

			const dbConnection = await this.createConnection();
			await dbConnection.unsafe(
				`INSERT INTO "${this._config.tableName}" (${columns}) VALUES (${placeholders}) ON CONFLICT ("${primaryKey.property}") DO UPDATE SET ${columns
					.split(", ")
					.map(col => `${col} = EXCLUDED.${col}`)
					.join(", ")};`,
				values
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
			const dbConnection = await this.createConnection();

			const itemData = await this.get(id);
			if (Is.notEmpty(itemData)) {
				const values: unknown[] = [id];
				let whereClauses: string[] = [];

				if (Is.arrayValue(conditions)) {
					whereClauses = conditions.map(condition => {
						values.push(condition.value);
						return `"${String(condition.property)}" = $${values.length}`;
					});
				}

				const primaryKey = EntitySchemaHelper.getPrimaryKey(this.getSchema());
				const query = `DELETE FROM "${this._config.tableName}" WHERE "${primaryKey.property}" = $1${whereClauses.length > 0 ? ` AND ${whereClauses.join(" AND ")}` : ""}`;
				await dbConnection.unsafe(query, values as postgres.ParameterOrJSON<never>[]);
			}
		} catch (err) {
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
			const returnSize = pageSize ?? PostgreSqlEntityStorageConnector._PAGE_SIZE;

			let orderByClause: string = "";
			if (Array.isArray(sortProperties)) {
				const orderClauses: string[] = [];
				for (const sortProperty of sortProperties) {
					const direction = sortProperty.sortDirection === SortDirection.Ascending ? "ASC" : "DESC";
					orderClauses.push(`"${String(sortProperty.property)}" ${direction}`);
				}
				orderByClause = `ORDER BY ${orderClauses.join(", ")}`;
			}

			const whereClauses: string[] = [];
			const values: unknown[] = [];

			if (conditions) {
				this.buildQueryParameters("", conditions, whereClauses, values);
			}

			const query = `SELECT ${properties ? properties.map(p => `"${String(p)}"`).join(", ") : "*"} FROM "${this._config.tableName}" ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""} ${orderByClause} LIMIT ${returnSize} OFFSET ${cursor ? Number(cursor) : 0}::integer`;
			const dbConnection = await this.createConnection();
			const rows = await dbConnection.unsafe(query, values as postgres.ParameterOrJSON<never>[]);

			if (this._entitySchema.properties) {
				for (const row of rows) {
					for (const prop of this._entitySchema.properties) {
						let propColumn = prop.property as string;
						propColumn = propColumn.toLowerCase();
						if (
							(prop.type === EntitySchemaPropertyType.Object ||
								prop.type === EntitySchemaPropertyType.Array) &&
							typeof row[propColumn] === "string"
						) {
							const rowValue = JSON.parse(row[propColumn] as string);
							delete row[propColumn];
							row[prop.property as string] = rowValue;
						}
						if (row[propColumn] === null) {
							row[prop.property as string] = undefined;
						}
					}
				}
			}
			return {
				entities: rows as unknown as Partial<T>[],
				cursor:
					Array.isArray(rows) && rows.length === returnSize
						? String((cursor ? Number(cursor) : 0) + returnSize)
						: undefined
			};
		} catch (err) {
			throw new GeneralError(this.CLASS_NAME, "queryFailed", { sql }, err);
		}
	}

	/**
	 * Drop the table.
	 * @returns Nothing.
	 */
	public async tableDrop(): Promise<void> {
		try {
			const dbConnection = await this.createConnection();
			await dbConnection.unsafe(`DROP TABLE ${this._config.tableName};`);
		} catch {
			// Ignore errors
		}
	}

	/**
	 * Create a new DB connection.
	 * @returns The PostgreSql connection.
	 * @internal
	 */
	private async createConnection(): Promise<postgres.Sql> {
		if (this._connection) {
			return this._connection;
		}
		const newConnection = await postgres(this.createConnectionConfig());
		this._connection = newConnection;
		return newConnection;
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

		prop += comparator.property as string;

		if (comparator.comparison === ComparisonOperator.In) {
			const inValues = Array.isArray(comparator.value) ? comparator.value : [comparator.value];
			values.push(...inValues.map(val => this.propertyToDbValue(val, type)));
			const placeholders = inValues
				.map((_, index) => `$${values.length - inValues.length + index + 1}`)
				.join(", ");
			return `"${prop}" IN (${placeholders})`;
		}
		const dbValue = this.propertyToDbValue(comparator.value, type);
		values.push(dbValue);

		if (comparator.property.split(".").length > 1) {
			const jsonPath = comparator.property
				.split(".")
				.slice(1)
				.map((p, i, arr) => (i === arr.length - 1 ? `->> '${p}'` : `-> '${p}'`))
				.join("");
			return `("${comparator.property.split(".")[0]}"::jsonb ${jsonPath}) = $${values.length}`;
		} else if (comparator.comparison === ComparisonOperator.Equals) {
			return `"${prop}" = $${values.length}`;
		} else if (comparator.comparison === ComparisonOperator.NotEquals) {
			return `"${prop}" <> $${values.length}`;
		} else if (comparator.comparison === ComparisonOperator.GreaterThan) {
			return `"${prop}" > $${values.length}`;
		} else if (comparator.comparison === ComparisonOperator.LessThan) {
			return `"${prop}" < $${values.length}`;
		} else if (comparator.comparison === ComparisonOperator.GreaterThanOrEqual) {
			return `"${prop}" >= $${values.length}`;
		} else if (comparator.comparison === ComparisonOperator.LessThanOrEqual) {
			return `"${prop}" <= $${values.length}`;
		} else if (comparator.comparison === ComparisonOperator.Includes) {
			return `EXISTS (SELECT 1 FROM jsonb_array_elements("${prop}") elem WHERE elem @> $${values.length}::jsonb)`;
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
		if (type === "string") {
			return String(value);
		} else if (type === "number") {
			return Number(value);
		} else if (type === "boolean") {
			return Boolean(value);
		} else if (type === "array") {
			return value;
		}

		if (Is.object(value)) {
			return JSON.stringify(value);
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
	 * Map entity schema properties to SQL properties.
	 * @param entitySchema The schema of the entity.
	 * @returns The SQL properties as a string.
	 * @throws GeneralError if the entity properties do not exist.
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
			throw new GeneralError(this.CLASS_NAME, "entitySchemaPropertiesUndefined");
		}

		const primaryKeys: string[] = [];

		const columnDefinitions = entitySchema.properties
			.map(prop => {
				const sqlType = sqlTypeMap[prop.type] || "TEXT";
				const columnName = String(prop.property);
				const nullable = prop.optional ? " NULL" : " NOT NULL";

				if (prop.isPrimary) {
					primaryKeys.push(columnName);
				}

				return `"${columnName}" ${sqlType}${nullable}`;
			})
			.join(", ");

		const primaryKeyDefinition =
			primaryKeys.length > 0 ? `, PRIMARY KEY (${primaryKeys.join(", ")})` : "";
		return columnDefinitions + primaryKeyDefinition;
	}
}
