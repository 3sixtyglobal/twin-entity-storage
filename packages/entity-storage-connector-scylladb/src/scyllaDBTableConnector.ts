// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	HealthCategory,
	HealthStatus,
	type IHealth,
	type IHealthProviderComponent
} from "@twin.org/api-models";
import { ContextIdHelper, ContextIdStore, type IContextIds } from "@twin.org/context";
import { BaseError, ComponentFactory, GeneralError, Guards, Is, type IError } from "@twin.org/core";
import {
	EntitySchemaFactory,
	EntitySchemaPropertyType,
	type IEntitySchema,
	type IEntitySchemaProperty
} from "@twin.org/entity";
import {
	EntityStorageHelper,
	type IEntityStorageMigrationConnector,
	type IMigrationOptions
} from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { AbstractScyllaDBConnector } from "./abstractScyllaDBConnector.js";
import type { IScyllaDBTableConnectorConstructorOptions } from "./models/IScyllaDBTableConnectorConstructorOptions.js";

/**
 * Store entities using ScyllaDB.
 */
export class ScyllaDBTableConnector<T = unknown>
	extends AbstractScyllaDBConnector<T>
	implements IEntityStorageMigrationConnector<T>, IHealthProviderComponent
{
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<ScyllaDBTableConnector>();

	/**
	 * The name for the schema.
	 * @internal
	 */
	private readonly _entitySchemaName: string;

	/**
	 * Create a new instance of ScyllaDBTableConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IScyllaDBTableConnectorConstructorOptions) {
		super(options);
		this._entitySchemaName = options.entitySchema;
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return ScyllaDBTableConnector.CLASS_NAME;
	}

	/**
	 * Returns the health status of the component.
	 * @returns The health status of the component.
	 */
	public async health(): Promise<IHealth[]> {
		let connection;
		try {
			connection = await this.openConnection();
			await this.queryDB(
				connection,
				`SELECT * FROM "${this.safeTableName(this._fullTableName)}" LIMIT 1`,
				[]
			);
			return [
				{
					source: ScyllaDBTableConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Ok,
					description: "healthDescription",
					data: { table: this.safeTableName(this._fullTableName) }
				}
			];
		} catch {
			return [
				{
					source: ScyllaDBTableConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Error,
					description: "healthDescription",
					message: "connectionFailed",
					data: { table: this.safeTableName(this._fullTableName) }
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
				this.safeTableName(this._fullTableName)
			);

			if (tableExists) {
				await nodeLogging?.log({
					level: "info",
					source: ScyllaDBTableConnector.CLASS_NAME,
					ts: Date.now(),
					message: "tableExists",
					data: {
						table: this.safeTableName(this._fullTableName)
					}
				});
			} else {
				const sql = `CREATE TABLE IF NOT EXISTS "${this.safeTableName(this._fullTableName)}" (${this.buildSchemaColumns(this._entitySchema)})`;

				await nodeLogging?.log({
					level: "info",
					source: ScyllaDBTableConnector.CLASS_NAME,
					ts: Date.now(),
					message: "tableCreating",
					data: { table: this.safeTableName(this._fullTableName) }
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
					data: { table: this.safeTableName(this._fullTableName) }
				});
			} else {
				await nodeLogging?.log({
					level: "error",
					source: ScyllaDBTableConnector.CLASS_NAME,
					ts: Date.now(),
					message: "tableCreateFailed",
					error: err as IError,
					data: { table: this.safeTableName(this._fullTableName) }
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
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const normalizedEntity = EntityStorageHelper.prepareEntity(
			entity,
			this._entitySchema,
			partitionKey
				? [{ property: AbstractScyllaDBConnector.PARTITION_KEY, value: partitionKey }]
				: undefined,
			{ nullBehavior: "omit" }
		);

		let connection;
		const id = normalizedEntity[this._primaryKey?.property] as string;
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
					const val = this.propertyToDbValue(normalizedEntity[propDesc.property], propDesc);
					if (val !== null && val !== undefined) {
						propValues.push(val);
						updateValues.push(`"${String(propDesc.property)}"=?`);
					}
				} else {
					finalConditions.push({
						property: propDesc.property,
						value: this.propertyToDbValue(normalizedEntity[propDesc.property], propDesc)
					});
				}
			}

			if (Is.arrayValue(conditions)) {
				finalConditions.push(...conditions);
			}

			const { sqlCondition, conditionValues } = this.buildConditions(finalConditions);

			let sql: string;
			let execParams: unknown[];
			if (updateValues.length > 0 || Is.arrayValue(conditions)) {
				propValues.push(...conditionValues);
				sql = `UPDATE "${this.safeTableName(this._fullTableName)}" SET ${updateValues.join(",")} WHERE ${sqlCondition}`;
				execParams = propValues;
			} else {
				// No non-null data columns and no extra conditions - INSERT writes a row marker
				// so the entity remains visible in SELECT even when all data fields are null.
				const cols = finalConditions.map(c => `"${String(c.property)}"`).join(",");
				const placeholders = finalConditions.map(() => "?").join(",");
				sql = `INSERT INTO "${this.safeTableName(this._fullTableName)}" (${cols}) VALUES (${placeholders})`;
				execParams = conditionValues;
			}

			await this._logging?.log({
				level: "info",
				source: ScyllaDBTableConnector.CLASS_NAME,
				ts: Date.now(),
				message: "sql",
				data: { sql }
			});

			connection = await this.openConnection();

			await this.execute(connection, sql, execParams);
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

		const normalizedEntities = entities.map(entity =>
			EntityStorageHelper.prepareEntity(
				entity,
				this._entitySchema,
				partitionKey
					? [{ property: AbstractScyllaDBConnector.PARTITION_KEY, value: partitionKey }]
					: undefined,
				{ nullBehavior: "omit" }
			)
		);

		let connection;
		try {
			connection = await this.openConnection();

			// Delete existing rows first so that a change in the clustering key (secondary
			// field) does not leave a stale row behind. Two separate batches are used to
			// ensure the deletes commit before the upserts, avoiding same-timestamp conflicts.
			const deleteQueries: { query: string; params: unknown[] }[] = [];
			const upsertQueries: { query: string; params: unknown[] }[] = [];

			for (const entity of normalizedEntities) {
				const id = entity[this._primaryKey.property] as string;
				const pk = partitionKey ?? AbstractScyllaDBConnector.PARTITION_KEY_VALUE;

				deleteQueries.push({
					query: `DELETE FROM "${this.safeTableName(this._fullTableName)}" WHERE "${AbstractScyllaDBConnector.PARTITION_KEY}"=? AND "${String(this._primaryKey.property)}"=?`,
					params: [pk, id]
				});

				const propValues: unknown[] = [];
				const updateValues: string[] = [];
				const finalConditions: { property: keyof T; value: unknown }[] = [];

				finalConditions.push({
					property: AbstractScyllaDBConnector.PARTITION_KEY as keyof T,
					value: pk
				});

				for (const propDesc of this._entitySchema.properties ?? []) {
					if (!propDesc.isPrimary && !propDesc.isSecondary) {
						const val = this.propertyToDbValue(entity[propDesc.property], propDesc);
						if (val !== null && val !== undefined) {
							propValues.push(val);
							updateValues.push(`"${String(propDesc.property)}"=?`);
						}
					} else {
						finalConditions.push({
							property: propDesc.property,
							value: this.propertyToDbValue(entity[propDesc.property], propDesc)
						});
					}
				}

				const { sqlCondition, conditionValues } = this.buildConditions(finalConditions);

				let sql: string;
				let queryParams: unknown[];
				if (updateValues.length > 0) {
					propValues.push(...conditionValues);
					sql = `UPDATE "${this.safeTableName(this._fullTableName)}" SET ${updateValues.join(",")} WHERE ${sqlCondition}`;
					queryParams = propValues;
				} else {
					// No non-null data columns - INSERT writes a row marker so the entity
					// remains visible in SELECT even when all data fields are null.
					const cols = finalConditions.map(c => `"${String(c.property)}"`).join(",");
					const placeholders = finalConditions.map(() => "?").join(",");
					sql = `INSERT INTO "${this.safeTableName(this._fullTableName)}" (${cols}) VALUES (${placeholders})`;
					queryParams = conditionValues;
				}
				upsertQueries.push({ query: sql, params: queryParams });
			}

			await connection.batch(deleteQueries, { prepare: true });
			await connection.batch(upsertQueries, { prepare: true });
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
				`SELECT * FROM "${this.safeTableName(this._fullTableName)}" WHERE "${AbstractScyllaDBConnector.PARTITION_KEY}" = ? ALLOW FILTERING`,
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
					query: `DELETE FROM "${this.safeTableName(this._fullTableName)}" WHERE ${sqlCondition}`,
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
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

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

			const sql = `DELETE FROM "${this.safeTableName(this._fullTableName)}" WHERE ${sqlCondition}`;

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
					query: `DELETE FROM "${this.safeTableName(this._fullTableName)}" WHERE ${sqlCondition}`,
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
			data: { table: this.safeTableName(this._fullTableName) }
		});

		let connection;

		try {
			connection = await this.openConnection();
			await connection.execute(`DROP TABLE IF EXISTS "${this.safeTableName(this._fullTableName)}"`);

			await nodeLogging?.log({
				level: "info",
				source: ScyllaDBTableConnector.CLASS_NAME,
				ts: Date.now(),
				message: "tableDropped",
				data: { table: this.safeTableName(this._fullTableName) }
			});

			// Drop UDTs referenced by this schema so they are recreated with the
			// current schema on the next bootstrap (table must be gone first).
			const structuredProperties = this._entitySchema.properties?.filter(
				property =>
					(property.type === EntitySchemaPropertyType.Object ||
						property.type === EntitySchemaPropertyType.Array) &&
					Is.stringValue(property.itemTypeRef)
			);
			if (Is.array(structuredProperties)) {
				for (const prop of structuredProperties) {
					if (Is.stringValue(prop.itemTypeRef)) {
						await connection.execute(`DROP TYPE IF EXISTS "${prop.itemTypeRef}"`);
					}
				}
			}

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
			await this.closePersistentClient();
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
		let connection;
		try {
			connection = await this.openConnection();
			const result = await this.queryDB(
				connection,
				`SELECT "${AbstractScyllaDBConnector.PARTITION_KEY}" FROM "${this.safeTableName(this._fullTableName)}" ALLOW FILTERING`,
				[],
				undefined,
				0
			);
			const seen = new Set<string>();
			const contextIds: IContextIds[] = [];
			for (const row of result.rows) {
				const id = row[AbstractScyllaDBConnector.PARTITION_KEY] as string;
				if (Is.stringValue(id) && !seen.has(id)) {
					seen.add(id);
					contextIds.push(ContextIdHelper.shortSplit(this._partitionContextIds ?? [], id));
				}
			}
			return contextIds;
		} catch (err) {
			throw new GeneralError(
				ScyllaDBTableConnector.CLASS_NAME,
				"getPartitionContextIdsFailed",
				undefined,
				err
			);
		} finally {
			await this.closeConnection(connection);
		}
	}

	/**
	 * Create a new target connector for the migration.
	 * @param entitySchemaName The entity schema name to use for the target connector.
	 * @returns A new connector configured with a migration table name.
	 */
	public async createTargetConnector<U>(
		entitySchemaName: string
	): Promise<ScyllaDBTableConnector<U>> {
		// We create a new table for the migration with a unique name to avoid conflicts with the existing table
		// This table will be swapped with the existing table once the migration is finalized.
		const migrationTableName = `${this._config.tableName}Migration${Date.now()}`;

		return new ScyllaDBTableConnector<U>({
			entitySchema: entitySchemaName,
			config: {
				...this._config,
				tableName: migrationTableName
			},
			partitionContextIds: this._partitionContextIds
		});
	}

	/**
	 * Finalize the migration by pointing a new connector at the migration table.
	 * @param targetConnector The connector pointing to the migration table.
	 * @param options The optional migration options.
	 * @param loggingComponentType The node logging component type.
	 * @returns A connector pointing to the migration table (now the live table).
	 */
	public async finalizeMigration<U>(
		targetConnector: ScyllaDBTableConnector<U>,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<ScyllaDBTableConnector<U>> {
		// There is no rename operation in ScyllaDB, so we have to create a new table with the original name and copy the data over

		// Teardown the existing table with the original name to free up the name for the new table
		await this.teardown(loggingComponentType);

		const finalConnector = new ScyllaDBTableConnector<U>({
			entitySchema: targetConnector._entitySchemaName,
			config: this._config,
			partitionContextIds: this._partitionContextIds
		});

		if (await finalConnector.bootstrap(loggingComponentType)) {
			// Since there is no rename, we need to copy the data from the migration table to the new table
			const partitions = await targetConnector.getPartitionContextIds();
			const batchSize = options?.batchSize ?? ScyllaDBTableConnector.DEFAULT_LIMIT;
			await this.bulkCopy(targetConnector, finalConnector, partitions, batchSize);

			await targetConnector.teardown(loggingComponentType);
			return finalConnector;
		}

		throw new GeneralError(
			ScyllaDBTableConnector.CLASS_NAME,
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
		targetConnector?: ScyllaDBTableConnector<U>,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<void> {
		// If something failed the only thing to cleanup is the migration table
		await targetConnector?.teardown?.(loggingComponentType);
	}

	/**
	 * Copy all entities from sourceConnector to destConnector, paging through each partition.
	 * @param sourceConnector The connector to read entities from.
	 * @param destConnector The connector to write entities to.
	 * @param partitions The partition list returned by getPartitionContextIds.
	 * @param batchSize The number of entities to read per page.
	 * @internal
	 */
	private async bulkCopy<U>(
		sourceConnector: ScyllaDBTableConnector<U>,
		destConnector: ScyllaDBTableConnector<U>,
		partitions: IContextIds[] | undefined,
		batchSize: number
	): Promise<void> {
		// undefined → not partitioned: one pass with no partition key.
		// []        → partitioned but empty: nothing to copy, return early before opening
		//             the connection.
		// [{…}, …]  → partitioned with data: iterate over each partition.
		if (partitions?.length === 0) {
			return;
		}
		const partitionList = partitions ?? [{}];

		const sourceColumns = [
			AbstractScyllaDBConnector.PARTITION_KEY,
			...(sourceConnector._entitySchema.properties?.map(p => p.property as string) ?? [])
		];
		const insertSql = `INSERT INTO "${destConnector.safeTableName(destConnector._fullTableName)}" (${sourceColumns.map(c => `"${c}"`).join(", ")}) VALUES (${sourceColumns.map(() => "?").join(", ")})`;

		let connection;
		try {
			connection = await sourceConnector.openConnection();
			for (let i = 0; i < partitionList.length; i++) {
				// Values from getPartitionContextIds are already short-form, so we join them
				// directly rather than using combinedContextKey, which expects long-form input
				// and calls guardAll (throwing if a registered handler rejects short-form values).
				const partitionKey = Is.arrayValue(sourceConnector._partitionContextIds)
					? sourceConnector._partitionContextIds.map(k => partitionList[i][k]).join("/")
					: AbstractScyllaDBConnector.PARTITION_KEY_VALUE;

				let pageState: string | undefined;
				do {
					const result = await sourceConnector.queryDB(
						connection,
						`SELECT * FROM "${sourceConnector.safeTableName(sourceConnector._fullTableName)}" WHERE "${AbstractScyllaDBConnector.PARTITION_KEY}" = ? ALLOW FILTERING`,
						[partitionKey],
						pageState,
						batchSize
					);

					pageState = Is.stringValue(result.pageState) ? result.pageState : undefined;

					if (Is.arrayValue(result.rows)) {
						await connection.batch(
							result.rows.map((row: { [key: string]: unknown }) => ({
								query: insertSql,
								params: sourceColumns.map(col => row[col])
							})),
							{ prepare: true }
						);
					}
				} while (Is.stringValue(pageState));
			}
		} finally {
			await sourceConnector.closeConnection(connection);
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

	/**
	 * Build the CQL column definitions string for a CREATE TABLE statement.
	 * @param schema The entity schema to build DDL from.
	 * @returns The column definitions string (without the outer parentheses).
	 * @internal
	 */
	private buildSchemaColumns(schema: IEntitySchema<T>): string {
		const fields: string[] = [];
		const clusteringKeys: string[] = [];

		// partitionId is always the sole partition key so that WHERE "partitionId" = ?
		// allows ORDER BY on the subsequent clustering keys.
		fields.push(`"${AbstractScyllaDBConnector.PARTITION_KEY}" TEXT`);

		for (const field of schema.properties ?? []) {
			fields.push(`"${String(field.property)}" ${this.toDbField(field)}`);
			if (field.isPrimary || field.isSecondary) {
				clusteringKeys.push(`"${field.property as string}"`);
			}
		}

		if (clusteringKeys.length > 0) {
			fields.push(
				`PRIMARY KEY ("${AbstractScyllaDBConnector.PARTITION_KEY}", ${clusteringKeys.join(", ")})`
			);
		} else {
			fields.push(`PRIMARY KEY ("${AbstractScyllaDBConnector.PARTITION_KEY}")`);
		}

		return fields.join(", ");
	}
}
