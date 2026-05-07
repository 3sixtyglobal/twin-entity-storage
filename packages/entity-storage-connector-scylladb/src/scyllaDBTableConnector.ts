// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdHelper, ContextIdStore } from "@twin.org/context";
import {
	BaseError,
	ComponentFactory,
	GeneralError,
	Guards,
	HealthStatus,
	Is,
	type IError,
	type IHealth
} from "@twin.org/core";
import {
	EntitySchemaFactory,
	EntitySchemaHelper,
	EntitySchemaPropertyType,
	type IEntitySchemaProperty
} from "@twin.org/entity";
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { AbstractScyllaDBConnector } from "./abstractScyllaDBConnector.js";
import type { IScyllaDBTableConnectorConstructorOptions } from "./models/IScyllaDBTableConnectorConstructorOptions.js";

/**
 * Store entities using ScyllaDB.
 */
export class ScyllaDBTableConnector<T = unknown>
	extends AbstractScyllaDBConnector<T>
	implements IEntityStorageConnector<T>
{
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<ScyllaDBTableConnector>();

	/**
	 * Create a new instance of ScyllaDBTableConnector.
	 * @param options The options for the connector.
	 */
	// eslint-disable-next-line @typescript-eslint/no-useless-constructor
	constructor(options: IScyllaDBTableConnectorConstructorOptions) {
		super(options);
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return ScyllaDBTableConnector.CLASS_NAME;
	}

	/**
	 * Get the health of the component.
	 * @returns The health of the component.
	 */
	public async health(): Promise<IHealth[]> {
		let connection;
		try {
			connection = await this.openConnection();
			await this.queryDB(connection, `SELECT * FROM "${this._fullTableName}" LIMIT 1`, []);
			return [
				{
					source: ScyllaDBTableConnector.CLASS_NAME,
					status: HealthStatus.Ok,
					description: "healthDescription"
				}
			];
		} catch {
			return [
				{
					source: ScyllaDBTableConnector.CLASS_NAME,
					status: HealthStatus.Error,
					description: "healthDescription",
					message: "connectionFailed"
				}
			];
		} finally {
			await this.closeConnection(connection);
		}
	}

	/**
	 * Bootstrap the component by creating and initializing any resources it needs.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the bootstrapping process was successful.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		try {
			let dbConnection = await this.openConnection(true);

			const exists = await this.checkKeyspaceExists(dbConnection, this._config.keyspace);

			if (exists) {
				await nodeLogging?.log({
					level: "info",
					source: ScyllaDBTableConnector.CLASS_NAME,
					ts: Date.now(),
					message: "keyspaceExists",
					data: {
						keyspace: this._config.keyspace
					}
				});
			} else {
				await nodeLogging?.log({
					level: "info",
					source: ScyllaDBTableConnector.CLASS_NAME,
					ts: Date.now(),
					message: "keyspaceCreating",
					data: { keyspace: this._config.keyspace }
				});
				await this.createKeyspace(dbConnection, this._config.keyspace);
			}

			// Connection has to be closed and now open a new one with our keyspace
			await this.closeConnection(dbConnection);
			dbConnection = await this.openConnection();

			// Need to find structured properties (declared as type: object)
			const structuredProperties = this._entitySchema.properties?.filter(
				property =>
					(property.type === EntitySchemaPropertyType.Object ||
						property.type === EntitySchemaPropertyType.Array) &&
					Is.stringValue(property.itemTypeRef)
			);

			// Needs to support objects that may have itemRef other objects (to be done)
			if (Is.array(structuredProperties)) {
				for (const strProperty of structuredProperties) {
					const subTypeSchemaRef = strProperty.itemTypeRef;
					if (Is.stringValue(subTypeSchemaRef)) {
						if (!(await this.checkTypeExists(dbConnection, subTypeSchemaRef))) {
							const objSchema = EntitySchemaFactory.get(subTypeSchemaRef);
							const typeFields: string[] = [];
							for (const field of objSchema.properties ?? []) {
								typeFields.push(`"${String(field.property)}" ${this.toDbField(field)}`);
							}
							const sql = `CREATE TYPE IF NOT EXISTS "${subTypeSchemaRef}" (${typeFields.join(",")})`;

							await nodeLogging?.log({
								level: "info",
								source: ScyllaDBTableConnector.CLASS_NAME,
								ts: Date.now(),
								message: "typeCreating",
								data: { typeName: subTypeSchemaRef }
							});

							await this.execute(dbConnection, sql);
						}
					}
				}
			}

			const tableExists = await this.checkTableExists(
				dbConnection,
				this._config.keyspace,
				this._fullTableName
			);

			if (tableExists) {
				await nodeLogging?.log({
					level: "info",
					source: ScyllaDBTableConnector.CLASS_NAME,
					ts: Date.now(),
					message: "tableExists",
					data: {
						table: this._fullTableName
					}
				});
			} else {
				const fields: string[] = [];
				const primaryKeys: string[] = [];
				const secondaryKeys: string[] = [];

				primaryKeys.push(`"${AbstractScyllaDBConnector.PARTITION_KEY}"`);
				fields.push(`"${AbstractScyllaDBConnector.PARTITION_KEY}" TEXT`);

				for (const field of this._entitySchema.properties ?? []) {
					fields.push(`"${String(field.property)}" ${this.toDbField(field)}`);
					if (field.isPrimary) {
						primaryKeys.push(`"${field.property as string}"`);
					}
					if (field.isSecondary) {
						secondaryKeys.push(`"${field.property as string}"`);
					}
				}
				fields.push(`PRIMARY KEY ((${primaryKeys.join(",")})`);
				if (secondaryKeys.length > 0) {
					fields.push(`${secondaryKeys.join(",")})`);
				} else {
					fields[fields.length - 1] += ")";
				}

				const sql = `CREATE TABLE IF NOT EXISTS "${this._fullTableName}" (${fields.join(", ")})`;

				await nodeLogging?.log({
					level: "info",
					source: ScyllaDBTableConnector.CLASS_NAME,
					ts: Date.now(),
					message: "tableCreating",
					data: { table: this._fullTableName }
				});

				await this.execute(dbConnection, sql);
			}
		} catch (err) {
			if (BaseError.isErrorCode(err, "ResourceInUseException")) {
				await nodeLogging?.log({
					level: "info",
					source: ScyllaDBTableConnector.CLASS_NAME,
					ts: Date.now(),
					message: "tableExists",
					data: { table: this._fullTableName }
				});
			} else {
				await nodeLogging?.log({
					level: "error",
					source: ScyllaDBTableConnector.CLASS_NAME,
					ts: Date.now(),
					message: "tableCreateFailed",
					error: err as IError,
					data: { table: this._fullTableName }
				});
			}
			return false;
		}
		return true;
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @param conditions The optional conditions to match for the entities.
	 */
	public async set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void> {
		Guards.object<T>(ScyllaDBTableConnector.CLASS_NAME, nameof(entity), entity);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		EntitySchemaHelper.validateEntity(entity, this.getSchema());

		let connection;
		const id = entity[this._primaryKey?.property] as string;
		try {
			const propValues: unknown[] = [];
			const updateValues: string[] = [];

			const finalConditions: { property: keyof T; value: unknown }[] = [];

			finalConditions.push({
				property: AbstractScyllaDBConnector.PARTITION_KEY as keyof T,
				value: partitionKey ?? AbstractScyllaDBConnector.PARTITION_KEY_VALUE
			});

			for (const propDesc of this._entitySchema.properties ?? []) {
				if (!propDesc.isPrimary && !propDesc.isSecondary) {
					propValues.push(this.propertyToDbValue(entity[propDesc.property], propDesc));
					updateValues.push(`"${String(propDesc.property)}"=?`);
				} else {
					finalConditions.push({
						property: propDesc.property,
						value: this.propertyToDbValue(entity[propDesc.property], propDesc)
					});
				}
			}

			if (Is.arrayValue(conditions)) {
				finalConditions.push(...conditions);
			}

			const { sqlCondition, conditionValues } = this.buildConditions(finalConditions);
			propValues.push(...conditionValues);

			const sql = `UPDATE "${this._fullTableName}" SET ${updateValues.join(",")} WHERE ${sqlCondition}`;

			await this._logging?.log({
				level: "info",
				source: ScyllaDBTableConnector.CLASS_NAME,
				ts: Date.now(),
				message: "sql",
				data: { sql }
			});

			connection = await this.openConnection();

			await this.execute(connection, sql, propValues);
		} catch (error) {
			throw new GeneralError(
				ScyllaDBTableConnector.CLASS_NAME,
				"setFailed",
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
	 * Set multiple entities in a batch.
	 * @param entities The entities to set.
	 * @returns Nothing.
	 */
	public async setBatch(entities: T[]): Promise<void> {
		Guards.arrayValue(ScyllaDBTableConnector.CLASS_NAME, nameof(entities), entities);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		for (const entity of entities) {
			EntitySchemaHelper.validateEntity(entity, this.getSchema());
		}

		let connection;
		try {
			connection = await this.openConnection();
			const queries: { query: string; params: unknown[] }[] = [];

			for (const entity of entities) {
				const propValues: unknown[] = [];
				const updateValues: string[] = [];
				const finalConditions: { property: keyof T; value: unknown }[] = [];

				finalConditions.push({
					property: AbstractScyllaDBConnector.PARTITION_KEY as keyof T,
					value: partitionKey ?? AbstractScyllaDBConnector.PARTITION_KEY_VALUE
				});

				for (const propDesc of this._entitySchema.properties ?? []) {
					if (!propDesc.isPrimary && !propDesc.isSecondary) {
						propValues.push(this.propertyToDbValue(entity[propDesc.property], propDesc));
						updateValues.push(`"${String(propDesc.property)}"=?`);
					} else {
						finalConditions.push({
							property: propDesc.property,
							value: this.propertyToDbValue(entity[propDesc.property], propDesc)
						});
					}
				}

				const { sqlCondition, conditionValues } = this.buildConditions(finalConditions);
				propValues.push(...conditionValues);

				const sql = `UPDATE "${this._fullTableName}" SET ${updateValues.join(",")} WHERE ${sqlCondition}`;
				queries.push({ query: sql, params: propValues });
			}

			await connection.batch(queries, { prepare: true });
		} catch (err) {
			throw new GeneralError(ScyllaDBTableConnector.CLASS_NAME, "setBatchFailed", undefined, err);
		} finally {
			await this.closeConnection(connection);
		}
	}

	/**
	 * Remove all entities from the storage.
	 * @param partitionKey The optional partition key.
	 */
	public async empty(partitionKey?: string): Promise<void> {
		const contextIds = await ContextIdStore.getContextIds();
		const resolvedPartitionKey =
			partitionKey ??
			ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds) ??
			AbstractScyllaDBConnector.PARTITION_KEY_VALUE;

		let connection;
		try {
			connection = await this.openConnection();

			const result = await this.queryDB(
				connection,
				`SELECT * FROM "${this._fullTableName}" WHERE "${AbstractScyllaDBConnector.PARTITION_KEY}" = ? ALLOW FILTERING`,
				[resolvedPartitionKey],
				undefined,
				0
			);

			if (result.rows.length === 0) {
				return;
			}

			const queries: { query: string; params: unknown[] }[] = [];

			for (const row of result.rows) {
				const conditions: { property: keyof T; value: unknown }[] = [
					{
						property: AbstractScyllaDBConnector.PARTITION_KEY as keyof T,
						value: resolvedPartitionKey
					}
				];
				for (const prop of this._entitySchema.properties ?? []) {
					if (prop.isPrimary || prop.isSecondary) {
						conditions.push({ property: prop.property, value: row[prop.property as string] });
					}
				}
				const { sqlCondition, conditionValues } = this.buildConditions(conditions);
				queries.push({
					query: `DELETE FROM "${this._fullTableName}" WHERE ${sqlCondition}`,
					params: conditionValues
				});
			}

			await connection.batch(queries, { prepare: true });
		} catch (err) {
			throw new GeneralError(ScyllaDBTableConnector.CLASS_NAME, "emptyFailed", undefined, err);
		} finally {
			await this.closeConnection(connection);
		}
	}

	/**
	 * Remove the entity.
	 * @param id The id of the entity to remove.
	 * @param conditions The optional conditions to match for the entities.
	 */
	public async remove(
		id: string,
		conditions?: { property: keyof T; value: unknown }[]
	): Promise<void> {
		Guards.stringValue(ScyllaDBTableConnector.CLASS_NAME, nameof(id), id);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		let connection;

		try {
			conditions ??= [];
			conditions.unshift({
				property: AbstractScyllaDBConnector.PARTITION_KEY as keyof T,
				value: partitionKey ?? AbstractScyllaDBConnector.PARTITION_KEY_VALUE
			});
			conditions.unshift({ property: this._primaryKey?.property, value: id });

			const { sqlCondition, conditionValues } = this.buildConditions(conditions);

			const sql = `DELETE FROM "${this._fullTableName}" WHERE ${sqlCondition}`;

			await this._logging?.log({
				level: "info",
				source: ScyllaDBTableConnector.CLASS_NAME,
				ts: Date.now(),
				message: "sql",
				data: { sql }
			});

			connection = await this.openConnection();

			await this.execute(connection, sql, conditionValues);
		} catch (error) {
			throw new GeneralError(
				ScyllaDBTableConnector.CLASS_NAME,
				"removeFailed",
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
	 * Remove multiple entities.
	 * @param ids The ids of the entities to remove.
	 */
	public async removeBatch(ids: string[]): Promise<void> {
		Guards.arrayValue(ScyllaDBTableConnector.CLASS_NAME, nameof(ids), ids);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		let connection;
		try {
			connection = await this.openConnection();
			const queries: { query: string; params: unknown[] }[] = [];

			for (const id of ids) {
				const conditions: { property: keyof T; value: unknown }[] = [
					{
						property: AbstractScyllaDBConnector.PARTITION_KEY as keyof T,
						value: partitionKey ?? AbstractScyllaDBConnector.PARTITION_KEY_VALUE
					},
					{ property: this._primaryKey.property, value: id }
				];
				const { sqlCondition, conditionValues } = this.buildConditions(conditions);
				queries.push({
					query: `DELETE FROM "${this._fullTableName}" WHERE ${sqlCondition}`,
					params: conditionValues
				});
			}

			await connection.batch(queries, { prepare: true });
		} catch (err) {
			throw new GeneralError(
				ScyllaDBTableConnector.CLASS_NAME,
				"removeBatchFailed",
				undefined,
				err
			);
		} finally {
			await this.closeConnection(connection);
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
			source: ScyllaDBTableConnector.CLASS_NAME,
			ts: Date.now(),
			message: "tableDropping",
			data: { table: this._fullTableName }
		});

		let connection;

		try {
			connection = await this.openConnection();
			await connection.execute(`DROP TABLE IF EXISTS "${this._fullTableName}"`);

			await nodeLogging?.log({
				level: "info",
				source: ScyllaDBTableConnector.CLASS_NAME,
				ts: Date.now(),
				message: "tableDropped",
				data: { table: this._fullTableName }
			});

			return true;
		} catch (err) {
			await nodeLogging?.log({
				level: "error",
				source: ScyllaDBTableConnector.CLASS_NAME,
				ts: Date.now(),
				message: "teardownFailed",
				error: BaseError.fromError(err)
			});
			return false;
		} finally {
			await this.closeConnection(connection);
		}
	}

	/**
	 * Transform a logical description of a field into a DB field.
	 * @param logicalField The logical field description.
	 * @returns The DB type.
	 * @throws GeneralException if no mapping found.
	 * @internal
	 */
	private toDbField(logicalField: IEntitySchemaProperty<T>): string {
		let dbType: string;

		switch (logicalField.type) {
			case "string":
				dbType = "TEXT";
				switch (logicalField.format) {
					case "uuid":
						dbType = "UUID";
						break;
					case "date":
					case "date-time":
						dbType = "TIMESTAMP";
						break;
				}
				break;
			case "number":
				dbType = "DOUBLE";
				switch (logicalField.format) {
					case "float":
						dbType = "FLOAT";
						break;
					case "double":
						dbType = "DOUBLE";
						break;
				}
				break;
			case "integer":
				dbType = "INT";
				switch (logicalField.format) {
					case "int8":
					case "uint8":
						dbType = "TINYINT";
						break;
					case "int16":
					case "uint16":
						dbType = "SMALLINT";
						break;
					case "int32":
					case "uint32":
						dbType = "INT";
						break;
					case "int64":
					case "uint64":
						dbType = "BIGINT";
						break;
				}
				break;
			case "boolean":
				dbType = "BOOLEAN";
				break;
			case "object":
				if (Is.stringValue(logicalField.itemTypeRef)) {
					dbType = `frozen<"${logicalField.itemTypeRef}">`;
				} else {
					// Item type is unknown object, store as TEXT
					// so that it can be JSON serialized
					dbType = "TEXT";
				}
				break;
			case "array":
				if (Is.stringValue(logicalField.itemTypeRef)) {
					if (Is.stringValue(logicalField.itemType)) {
						dbType = `SET<${this.toDbField({
							property: logicalField.property,
							type: logicalField.itemType
						})}>`;
					} else {
						dbType = `SET<frozen<"${logicalField.itemTypeRef}">>`;
					}
				} else {
					// Item type is unknown object, store as TEXT
					// so that it can be JSON serialized
					dbType = "TEXT";
				}
				break;
		}

		return dbType;
	}
}
