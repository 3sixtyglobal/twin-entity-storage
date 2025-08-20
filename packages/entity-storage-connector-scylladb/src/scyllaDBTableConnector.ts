// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

import { BaseError, ComponentFactory, GeneralError, Guards, type IError, Is } from "@twin.org/core";
import {
	EntitySchemaFactory,
	EntitySchemaHelper,
	EntitySchemaPropertyType,
	type IEntitySchemaProperty
} from "@twin.org/entity";
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { AbstractScyllaDBConnector } from "./abstractScyllaDBConnector";
import type { IScyllaDBTableConnectorConstructorOptions } from "./models/IScyllaDBTableConnectorConstructorOptions";

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
	public readonly CLASS_NAME: string = nameof<ScyllaDBTableConnector>();

	/**
	 * Create a new instance of ScyllaDBTableConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IScyllaDBTableConnectorConstructorOptions) {
		super(options, nameof(ScyllaDBTableConnector));
	}

	/**
	 * Bootstrap the component by creating and initializing any resources it needs.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the bootstrapping process was successful.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		nodeLogging?.log({
			level: "info",
			source: this.CLASS_NAME,
			ts: Date.now(),
			message: "tableCreating",
			data: { table: this._fullTableName }
		});

		try {
			let dbConnection = await this.openConnection(true);

			await this.createKeyspace(dbConnection, this._config.keyspace);

			// Connection has to be closed and now open a new one with our keyspace
			await this.closeConnection(dbConnection);
			dbConnection = await this.openConnection();

			// Need to find structured properties (declared as type: object)
			const structuredProperties = this._entitySchema.properties?.filter(
				property =>
					property.type === EntitySchemaPropertyType.Object ||
					(property.type === EntitySchemaPropertyType.Array && property.itemTypeRef)
			);

			// Needs to support objects that may have itemRef other objects (to be done)
			if (Is.array(structuredProperties)) {
				for (const strProperty of structuredProperties) {
					const subTypeSchemaRef = strProperty.itemTypeRef;
					if (!Is.undefined(subTypeSchemaRef)) {
						const objSchema = EntitySchemaFactory.get(subTypeSchemaRef);
						const typeFields: string[] = [];
						for (const field of objSchema.properties ?? []) {
							typeFields.push(`"${String(field.property)}" ${this.toDbField(field)}`);
						}
						const sql = `CREATE TYPE IF NOT EXISTS
																		"${subTypeSchemaRef}" (${typeFields.join(",")})`;

						await nodeLogging?.log({
							level: "info",
							source: this.CLASS_NAME,
							ts: Date.now(),
							message: "sql",
							data: { sql }
						});

						await this.execute(dbConnection, sql);

						await nodeLogging?.log({
							level: "info",
							source: this.CLASS_NAME,
							ts: Date.now(),
							message: "typeCreated",
							data: { typeName: subTypeSchemaRef }
						});
					}
				}
			}

			const fields: string[] = [];
			const primaryKeys: string[] = [];
			const secondaryKeys: string[] = [];

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
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "sql",
				data: { sql }
			});

			await this.execute(dbConnection, sql);

			await nodeLogging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "tableCreated",
				data: { table: this._fullTableName }
			});
		} catch (err) {
			if (BaseError.isErrorCode(err, "ResourceInUseException")) {
				await nodeLogging?.log({
					level: "info",
					source: this.CLASS_NAME,
					ts: Date.now(),
					message: "tableExists",
					data: { table: this._fullTableName }
				});
			} else {
				await nodeLogging?.log({
					level: "error",
					source: this.CLASS_NAME,
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
		Guards.object<T>(this.CLASS_NAME, nameof(entity), entity);

		EntitySchemaHelper.validateEntity(entity, this.getSchema());

		let connection;
		const id = entity[this._primaryKey?.property] as string;
		try {
			const propValues: unknown[] = [];
			const updateValues: string[] = [];

			conditions ??= [];

			for (const propDesc of this._entitySchema.properties ?? []) {
				if (!propDesc.isPrimary && !propDesc.isSecondary) {
					propValues.push(this.propertyToDbValue(entity[propDesc.property], propDesc));
					updateValues.push(`"${String(propDesc.property)}"=?`);
				} else {
					conditions.unshift({
						property: propDesc.property,
						value: this.propertyToDbValue(entity[propDesc.property], propDesc)
					});
				}
			}

			const { sqlCondition, conditionValues } = this.buildConditions(conditions);

			let conditionString = "";
			if (sqlCondition.length > 0) {
				conditionString = ` WHERE ${sqlCondition}`;
				propValues.push(...conditionValues);
			}

			const sql = `UPDATE "${this._fullTableName}" SET ${updateValues.join(",")}${conditionString}`;

			await this._logging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "sql",
				data: { sql }
			});

			connection = await this.openConnection();

			await this.execute(connection, sql, propValues);
		} catch (error) {
			throw new GeneralError(
				this.CLASS_NAME,
				"entityStorage.setFailed",
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
	 * Remove the entity.
	 * @param id The id of the entity to remove.
	 * @param conditions The optional conditions to match for the entities.
	 */
	public async remove(
		id: string,
		conditions?: { property: keyof T; value: unknown }[]
	): Promise<void> {
		Guards.stringValue(this.CLASS_NAME, nameof(id), id);

		let connection;

		try {
			conditions ??= [];
			conditions.unshift({ property: this._primaryKey?.property, value: id });

			const { sqlCondition, conditionValues } = this.buildConditions(conditions);

			const sql = `DELETE FROM "${this._fullTableName}" WHERE ${sqlCondition}`;

			await this._logging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "entityStorage.sqlRemove",
				data: { sql }
			});

			connection = await this.openConnection();

			await this.execute(connection, sql, conditionValues);
		} catch (error) {
			throw new GeneralError(
				this.CLASS_NAME,
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
	 * Drops table.
	 */
	public async dropTable(): Promise<void> {
		let connection;

		try {
			connection = await this.openConnection();

			await connection.execute(`DROP TABLE IF EXISTS "${this._fullTableName}"`);
		} catch (error) {
			throw new GeneralError(
				this.CLASS_NAME,
				"dropTableFailed",
				{ table: this._fullTableName },
				error
			);
		} finally {
			await this.closeConnection(connection);
		}
	}

	/**
	 * Truncates (clear) table.
	 */
	public async truncateTable(): Promise<void> {
		let connection;

		try {
			connection = await this.openConnection();

			await connection.execute(`TRUNCATE TABLE "${this._fullTableName}"`);
		} catch (error) {
			throw new GeneralError(
				this.CLASS_NAME,
				"truncateTableFailed",
				{ table: this._fullTableName },
				error
			);
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
				if (!logicalField.itemTypeRef) {
					throw new GeneralError(this.CLASS_NAME, "itemTypeNotDefined", {
						type: logicalField.type,
						table: this._fullTableName
					});
				}
				dbType = `frozen<"${logicalField.itemTypeRef}">`;
				break;
			case "array":
				if (!logicalField.itemType && !logicalField.itemTypeRef) {
					throw new GeneralError(this.CLASS_NAME, "itemTypeNotDefined", {
						type: logicalField.type,
						table: this._fullTableName
					});
				}
				if (logicalField.itemType) {
					dbType = `SET<${this.toDbField({
						property: logicalField.property,
						type: logicalField.itemType as EntitySchemaPropertyType
					})}>`;
				} else {
					dbType = `SET<frozen<"${logicalField.itemTypeRef}">>`;
				}
				break;
		}

		return dbType;
	}

	/**
	 * Build the conditions for the query.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The SQL conditions and the values.
	 */
	private buildConditions(conditions: { property: keyof T; value: unknown }[] | undefined): {
		sqlCondition: string;
		conditionValues: unknown[];
	} {
		const conditionValues: unknown[] = [];
		const sqlConditions: string[] = [];

		if (Is.arrayValue(conditions)) {
			for (const condition of conditions) {
				sqlConditions.push(`"${condition.property as string}"=?`);
				const schemaProperty = this._entitySchema.properties?.find(
					s => s.property === condition.property
				);
				conditionValues.push(this.propertyToDbValue(condition.value, schemaProperty));
			}
		}
		return { sqlCondition: sqlConditions.join(" AND "), conditionValues };
	}
}
