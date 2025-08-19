// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	BaseError,
	ComponentFactory,
	Is,
	NotSupportedError,
	StringHelper,
	type IError
} from "@twin.org/core";
import { EntitySchemaHelper, type IEntitySchema } from "@twin.org/entity";
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { AbstractScyllaDBConnector } from "./abstractScyllaDBConnector";
import type { IScyllaDBViewConnectorConstructorOptions } from "./models/IScyllaDBViewConnectorConstructorOptions";

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
	public readonly CLASS_NAME: string = nameof<ScyllaDBViewConnector<T>>();

	/**
	 * The view descriptor.
	 * @internal
	 */
	private readonly _viewSchema: IEntitySchema<T>;

	/**
	 * The name of the database table.
	 * @internal
	 */
	private readonly _originalFullTableName: string;

	/**
	 * Create a new instance of ScyllaDBViewConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IScyllaDBViewConnectorConstructorOptions) {
		// We need this conversion so that types can match in the superclass and reuse the get method
		super(
			{
				loggingComponentType: options.loggingComponentType,
				entitySchema: options.viewSchema,
				config: options.config
			},
			nameof(ScyllaDBViewConnector)
		);

		this._viewSchema = EntitySchemaHelper.getSchema<T>(options.viewSchema);

		// We need the underlying class to use the view name for lookups
		// so substitute the view name for the entity name
		// but store the original table name to use when bootstrapping the view
		this._originalFullTableName = this._fullTableName;
		this._fullTableName = StringHelper.camelCase(
			Is.stringValue(options.config.viewName) ? options.config.viewName : options.entitySchema
		);
	}

	/**
	 * Bootstrap the component by creating and initializing any resources it needs.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the bootstrapping process was successful.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(
			nodeLoggingComponentType ?? "logging"
		);

		nodeLogging?.log({
			level: "info",
			source: this.CLASS_NAME,
			ts: Date.now(),
			message: "viewCreating",
			data: { view: this._fullTableName }
		});

		try {
			const dbConnection = await this.openConnection(true);

			await this.createKeyspace(dbConnection, this._config.keyspace);

			const fields: string[] = [];
			const primaryKeys: string[] = [];

			for (const field of this._viewSchema.properties ?? []) {
				fields.push(`"${String(field.property)}" IS NOT NULL `);
				if (field.isPrimary) {
					primaryKeys.push(field.property as string);
				}
			}
			fields.push(`PRIMARY KEY (${primaryKeys.join(",")})`);

			const sql = `CREATE MATERIALIZED VIEW IF NOT EXISTS ${this._config.keyspace}.${this._fullTableName}
            AS SELECT * FROM ${this._config.keyspace}.${this._originalFullTableName} WHERE
            ${this._fullTableName} (${fields.join(" AND ")})`;

			await this.execute(dbConnection, sql);

			nodeLogging?.log({
				level: "info",
				source: this.CLASS_NAME,
				ts: Date.now(),
				message: "viewCreated",
				data: { view: this._fullTableName }
			});
		} catch (err) {
			if (BaseError.isErrorCode(err, "ResourceInUseException")) {
				nodeLogging?.log({
					level: "info",
					source: this.CLASS_NAME,
					ts: Date.now(),
					message: "viewExists",
					data: { view: this._fullTableName }
				});
			} else {
				nodeLogging?.log({
					level: "error",
					source: this.CLASS_NAME,
					ts: Date.now(),
					message: "viewCreateFailed",
					error: err as IError,
					data: { view: this._fullTableName }
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
		throw new NotSupportedError(this.CLASS_NAME, "set", {});
	}

	/**
	 * Delete the entity.
	 * @param id The id of the entity to remove.
	 */
	public async remove(id: string): Promise<void> {
		throw new NotSupportedError(this.CLASS_NAME, "remove", {});
	}
}
