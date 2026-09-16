// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	BaseError,
	ComponentFactory,
	Guards,
	NotSupportedError,
	type IError
} from "@twin.org/core";
import { EntitySchemaFactory, type IEntitySchema } from "@twin.org/entity";
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { AbstractScyllaDBConnector } from "./abstractScyllaDBConnector.js";
import type { IScyllaDBViewConnectorConstructorOptions } from "./models/IScyllaDBViewConnectorConstructorOptions.js";

/**
 * Manage entities using ScyllaDB Views.
 */
export class ScyllaDBViewConnector<T>
	extends AbstractScyllaDBConnector<T>
	implements IEntityStorageConnector<T>
{
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<ScyllaDBViewConnector<unknown>>();

	/**
	 * The schema of the base table the view is built from.
	 * @internal
	 */
	private readonly _baseSchema: IEntitySchema;

	/**
	 * The name of the base table the view is built from.
	 * @internal
	 */
	private readonly _baseTableName: string;

	/**
	 * Create a new instance of ScyllaDBViewConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IScyllaDBViewConnectorConstructorOptions) {
		Guards.object<IScyllaDBViewConnectorConstructorOptions>(
			ScyllaDBViewConnector.CLASS_NAME,
			nameof(options),
			options
		);
		Guards.stringValue(
			ScyllaDBViewConnector.CLASS_NAME,
			nameof(options.viewSchema),
			options.viewSchema
		);

		// The view schema is the superclass entity schema so that reads go through the view
		super({
			loggingComponentType: options.loggingComponentType,
			entitySchema: options.viewSchema,
			partitionContextIds: options.partitionContextIds,
			config: options.config
		});

		Guards.stringValue(
			ScyllaDBViewConnector.CLASS_NAME,
			nameof(options.entitySchema),
			options.entitySchema
		);
		Guards.stringValue(
			ScyllaDBViewConnector.CLASS_NAME,
			nameof(options.config.viewName),
			options.config.viewName
		);

		this._baseSchema = EntitySchemaFactory.get(options.entitySchema);
		this._baseTableName = this._fullTableName;
		this._fullTableName = options.config.viewName;
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return ScyllaDBViewConnector.CLASS_NAME;
	}

	/**
	 * Bootstrap the component by creating the materialized view over the base table.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the bootstrapping process was successful.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);
		const viewName = this.safeTableName(this._fullTableName);

		await nodeLogging?.log({
			level: "info",
			source: ScyllaDBViewConnector.CLASS_NAME,
			ts: Date.now(),
			message: "viewCreating",
			data: { view: viewName }
		});

		try {
			const dbConnection = await this.openConnectionNoKeyspace();
			try {
				await this.createKeyspace(dbConnection, this._config.keyspace);

				const keyColumns = this.buildViewKeyColumns().map(column => `"${column}"`);
				const sql = `CREATE MATERIALIZED VIEW IF NOT EXISTS "${this._config.keyspace}"."${viewName}" AS SELECT * FROM "${this._config.keyspace}"."${this.safeTableName(this._baseTableName)}" WHERE ${keyColumns.map(column => `${column} IS NOT NULL`).join(" AND ")} PRIMARY KEY (${keyColumns.join(", ")})`;

				await this.execute(dbConnection, sql);

				await nodeLogging?.log({
					level: "info",
					source: ScyllaDBViewConnector.CLASS_NAME,
					ts: Date.now(),
					message: "viewCreated",
					data: { view: viewName }
				});
			} finally {
				await this.closeConnectionNoKeyspace(dbConnection);
			}
		} catch (err) {
			if (BaseError.isErrorCode(err, "ResourceInUseException")) {
				await nodeLogging?.log({
					level: "info",
					source: ScyllaDBViewConnector.CLASS_NAME,
					ts: Date.now(),
					message: "viewExists",
					data: { view: viewName }
				});
			} else {
				await nodeLogging?.log({
					level: "error",
					source: ScyllaDBViewConnector.CLASS_NAME,
					ts: Date.now(),
					message: "viewCreateFailed",
					error: err as IError,
					data: { view: viewName }
				});
			}
			return false;
		}
		return true;
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 */
	public async set(entity: T): Promise<void> {
		throw new NotSupportedError(ScyllaDBViewConnector.CLASS_NAME, "notSupported", {
			methodName: "set"
		});
	}

	/**
	 * Set multiple entities in a batch.
	 * @param entities The entities to set.
	 */
	public async setBatch(entities: T[]): Promise<void> {
		throw new NotSupportedError(ScyllaDBViewConnector.CLASS_NAME, "notSupported", {
			methodName: "setBatch"
		});
	}

	/**
	 * Remove all entities from the storage.
	 */
	public async empty(): Promise<void> {
		throw new NotSupportedError(ScyllaDBViewConnector.CLASS_NAME, "notSupported", {
			methodName: "empty"
		});
	}

	/**
	 * Delete the entity.
	 * @param id The id of the entity to remove.
	 */
	public async remove(id: string): Promise<void> {
		throw new NotSupportedError(ScyllaDBViewConnector.CLASS_NAME, "notSupported", {
			methodName: "remove"
		});
	}

	/**
	 * Remove multiple entities.
	 * @param ids The ids of the entities to remove.
	 */
	public async removeBatch(ids: string[]): Promise<void> {
		throw new NotSupportedError(ScyllaDBViewConnector.CLASS_NAME, "notSupported", {
			methodName: "removeBatch"
		});
	}

	/**
	 * Teardown the entity storage by dropping the view.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the teardown process was successful.
	 */
	public async teardown(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);
		const viewName = this.safeTableName(this._fullTableName);

		await nodeLogging?.log({
			level: "info",
			source: ScyllaDBViewConnector.CLASS_NAME,
			ts: Date.now(),
			message: "viewDropping",
			data: { view: viewName }
		});

		try {
			const connection = await this.getClient();
			await connection.execute(`DROP MATERIALIZED VIEW IF EXISTS "${viewName}"`);

			await nodeLogging?.log({
				level: "info",
				source: ScyllaDBViewConnector.CLASS_NAME,
				ts: Date.now(),
				message: "viewDropped",
				data: { view: viewName }
			});

			return true;
		} catch (err) {
			await nodeLogging?.log({
				level: "error",
				source: ScyllaDBViewConnector.CLASS_NAME,
				ts: Date.now(),
				message: "teardownFailed",
				error: BaseError.fromError(err)
			});
			return false;
		} finally {
			await this.closePersistentClient();
		}
	}

	/**
	 * Build the view key: the partition key, the view primary property, then the rest of the base table key.
	 * @returns The key column names in order.
	 * @internal
	 */
	private buildViewKeyColumns(): string[] {
		const keyColumns = [AbstractScyllaDBConnector.PARTITION_KEY, String(this._primaryKey.property)];
		for (const key of this.keyProperties(this._baseSchema)) {
			if (!keyColumns.includes(key)) {
				keyColumns.push(key);
			}
		}
		return keyColumns;
	}
}
