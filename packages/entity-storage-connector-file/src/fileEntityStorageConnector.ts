// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { access, mkdir, readFile, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ContextIdHelper, ContextIdStore } from "@twin.org/context";
import {
	BaseError,
	Coerce,
	ComponentFactory,
	GeneralError,
	Guards,
	HealthStatus,
	type IHealth,
	Is,
	ObjectHelper
} from "@twin.org/core";
import {
	ComparisonOperator,
	EntityConditions,
	EntitySchemaFactory,
	EntitySchemaHelper,
	EntitySorter,
	LogicalOperator,
	type EntityCondition,
	type IEntitySchema,
	type IEntitySchemaProperty,
	type SortDirection
} from "@twin.org/entity";
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import type { IFileEntityStorageConnectorConstructorOptions } from "./models/IFileEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations in file.
 */
export class FileEntityStorageConnector<T = unknown> implements IEntityStorageConnector<T> {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<FileEntityStorageConnector>();

	/**
	 * Default limit for number of items to return.
	 * @internal
	 */
	private static readonly _DEFAULT_LIMIT: number = 20;

	/**
	 * Partition key for the operation.
	 * @internal
	 */
	private static readonly _PARTITION_KEY: string = "partitionId";

	/**
	 * Default disk space warning threshold: 500 MB.
	 * @internal
	 */
	private static readonly _DEFAULT_DISK_WARNING_THRESHOLD_BYTES: number = 500 * 1024 * 1024;

	/**
	 * Default disk space error threshold: 100 MB.
	 * @internal
	 */
	private static readonly _DEFAULT_DISK_ERROR_THRESHOLD_BYTES: number = 100 * 1024 * 1024;

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
	 * The primary key.
	 * @internal
	 */
	private readonly _primaryKey: IEntitySchemaProperty<T>;

	/**
	 * The directory to use for storage.
	 * @internal
	 */
	private readonly _directory: string;

	/**
	 * Free bytes below which health reports an error.
	 * @internal
	 */
	private readonly _diskErrorThresholdBytes: number;

	/**
	 * Free bytes below which health reports a warning.
	 * @internal
	 */
	private readonly _diskWarningThresholdBytes: number;

	/**
	 * Create a new instance of FileEntityStorageConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IFileEntityStorageConnectorConstructorOptions) {
		Guards.object(FileEntityStorageConnector.CLASS_NAME, nameof(options), options);
		Guards.stringValue(
			FileEntityStorageConnector.CLASS_NAME,
			nameof(options.entitySchema),
			options.entitySchema
		);
		Guards.object(FileEntityStorageConnector.CLASS_NAME, nameof(options.config), options.config);
		Guards.stringValue(
			FileEntityStorageConnector.CLASS_NAME,
			nameof(options.config.directory),
			options.config.directory
		);
		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._partitionContextIds = options.partitionContextIds;
		this._primaryKey = EntitySchemaHelper.getPrimaryKey<T>(this._entitySchema);
		this._directory = path.resolve(options.config.directory);
		this._diskErrorThresholdBytes =
			options.config.diskErrorThresholdBytes ??
			FileEntityStorageConnector._DEFAULT_DISK_ERROR_THRESHOLD_BYTES;
		this._diskWarningThresholdBytes =
			options.config.diskWarningThresholdBytes ??
			FileEntityStorageConnector._DEFAULT_DISK_WARNING_THRESHOLD_BYTES;
	}

	/**
	 * Deep-clone condition tree and map `null` to `undefined` on Equals/NotEquals leaves
	 * so in-memory evaluation matches SQL-style "IS NULL" / "IS NOT NULL" semantics.
	 * @param condition The user-supplied condition (not mutated).
	 * @returns A clone safe to pass to {@link EntityConditions.check}.
	 * @internal
	 */
	private static normalizeNullToUndefined<T>(condition: EntityCondition<T>): EntityCondition<T> {
		if ("conditions" in condition) {
			return {
				...condition,
				conditions: condition.conditions.map(c =>
					FileEntityStorageConnector.normalizeNullToUndefined(c)
				)
			};
		}

		const leaf = condition;
		if (
			(leaf.comparison === ComparisonOperator.Equals ||
				leaf.comparison === ComparisonOperator.NotEquals) &&
			leaf.value === null
		) {
			return { ...leaf, value: undefined };
		}
		return { ...leaf };
	}

	/**
	 * Bootstrap the connector by creating and initializing any resources it needs.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the bootstrapping process was successful.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		if (!(await this.dirExists(this._directory))) {
			await nodeLogging?.log({
				level: "info",
				source: FileEntityStorageConnector.CLASS_NAME,
				message: "directoryCreating",
				data: {
					directory: this._directory
				}
			});

			try {
				await mkdir(this._directory, { recursive: true });

				await nodeLogging?.log({
					level: "info",
					source: FileEntityStorageConnector.CLASS_NAME,
					message: "directoryCreated",
					data: {
						directory: this._directory
					}
				});
			} catch (err) {
				await nodeLogging?.log({
					level: "error",
					source: FileEntityStorageConnector.CLASS_NAME,
					message: "directoryCreateFailed",
					data: {
						directory: this._directory
					},
					error: BaseError.fromError(err)
				});
				return false;
			}
		} else {
			await nodeLogging?.log({
				level: "info",
				source: FileEntityStorageConnector.CLASS_NAME,
				message: "directoryExists",
				data: {
					directory: this._directory
				}
			});
		}
		return true;
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return FileEntityStorageConnector.CLASS_NAME;
	}

	/**
	 * Returns the health status of the component.
	 * @returns The health status of the component, can return multiple entries for elements within the component.
	 */
	public async health(): Promise<IHealth[]> {
		try {
			const stats = await statfs(this._directory);
			const freeBytes = stats.bavail * stats.bsize;

			if (freeBytes < this._diskErrorThresholdBytes) {
				return [
					{
						source: FileEntityStorageConnector.CLASS_NAME,
						status: HealthStatus.Error,
						description: "healthDescription",
						message: "diskSpaceError",
						data: { freeBytes, thresholdBytes: this._diskErrorThresholdBytes }
					}
				];
			} else if (freeBytes < this._diskWarningThresholdBytes) {
				return [
					{
						source: FileEntityStorageConnector.CLASS_NAME,
						status: HealthStatus.Warning,
						description: "healthDescription",
						message: "diskSpaceWarning",
						data: { freeBytes, thresholdBytes: this._diskWarningThresholdBytes }
					}
				];
			}
			return [
				{
					source: FileEntityStorageConnector.CLASS_NAME,
					status: HealthStatus.Ok,
					description: "healthDescription"
				}
			];
		} catch {
			return [
				{
					source: FileEntityStorageConnector.CLASS_NAME,
					status: HealthStatus.Error,
					description: "healthDescription",
					message: "diskSpaceCheckFailed"
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
	 * Get an entity.
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
		Guards.stringValue(FileEntityStorageConnector.CLASS_NAME, nameof(id), id);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const store = await this.readStore();

		const finalConditions = conditions ?? [];
		if (Is.stringValue(partitionKey)) {
			finalConditions.push({
				property: FileEntityStorageConnector._PARTITION_KEY as keyof T,
				value: partitionKey
			});
		}

		const index = this.findItem(store, id, secondaryIndex, finalConditions);
		const item = index >= 0 ? store[index] : undefined;

		if (Is.objectValue(item)) {
			ObjectHelper.propertyDelete(item, FileEntityStorageConnector._PARTITION_KEY);
		}

		return item;
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The id of the entity.
	 */
	public async set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void> {
		Guards.object<T>(FileEntityStorageConnector.CLASS_NAME, nameof(entity), entity);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		EntitySchemaHelper.validateEntity(entity, this.getSchema());

		const store = await this.readStore();

		const finalEntity = ObjectHelper.clone(entity);

		const finalConditions = conditions ?? [];
		if (Is.stringValue(partitionKey)) {
			finalConditions.push({
				property: FileEntityStorageConnector._PARTITION_KEY as keyof T,
				value: partitionKey
			});
			ObjectHelper.propertySet(
				finalEntity,
				FileEntityStorageConnector._PARTITION_KEY,
				partitionKey
			);
		}

		const existingIndex = this.findItem(
			store,
			finalEntity[this._primaryKey.property] as string,
			undefined,
			finalConditions
		);
		if (existingIndex >= 0) {
			store[existingIndex] = finalEntity;
		} else {
			store.push(finalEntity);
		}

		await this.writeStore(store);
	}

	/**
	 * Set multiple entities in a batch.
	 * @param entities The entities to set.
	 * @returns Nothing.
	 */
	public async setBatch(entities: T[]): Promise<void> {
		Guards.arrayValue(FileEntityStorageConnector.CLASS_NAME, nameof(entities), entities);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);
		const store = await this.readStore();

		for (const entity of entities) {
			Guards.object<T>(FileEntityStorageConnector.CLASS_NAME, nameof(entity), entity);
			EntitySchemaHelper.validateEntity(entity, this.getSchema());

			const finalEntity = ObjectHelper.clone(entity);

			if (Is.stringValue(partitionKey)) {
				ObjectHelper.propertySet(
					finalEntity,
					FileEntityStorageConnector._PARTITION_KEY,
					partitionKey
				);
			}

			const existingIndex = this.findItem(
				store,
				finalEntity[this._primaryKey.property] as string,
				undefined,
				Is.stringValue(partitionKey)
					? [
							{
								property: FileEntityStorageConnector._PARTITION_KEY as keyof T,
								value: partitionKey
							}
						]
					: []
			);
			if (existingIndex >= 0) {
				store[existingIndex] = finalEntity;
			} else {
				store.push(finalEntity);
			}
		}

		await this.writeStore(store);
	}

	/**
	 * Remove all entities from the storage.
	 * @returns Nothing.
	 */
	public async empty(): Promise<void> {
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const store = await this.readStore();
			const remaining = Is.stringValue(partitionKey)
				? store.filter(
						item =>
							ObjectHelper.propertyGet(
								item as object,
								FileEntityStorageConnector._PARTITION_KEY
							) !== partitionKey
					)
				: [];
			await this.writeStore(remaining);
		} catch (err) {
			throw new GeneralError(FileEntityStorageConnector.CLASS_NAME, "emptyFailed", undefined, err);
		}
	}

	/**
	 * Remove multiple entities by id.
	 * @param ids The ids of the entities to remove.
	 * @returns Nothing.
	 */
	public async removeBatch(ids: string[]): Promise<void> {
		Guards.arrayValue(FileEntityStorageConnector.CLASS_NAME, nameof(ids), ids);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const store = await this.readStore();
			const idSet = new Set(ids);
			const remaining = store.filter(item => {
				if (
					Is.stringValue(partitionKey) &&
					ObjectHelper.propertyGet(item as object, FileEntityStorageConnector._PARTITION_KEY) !==
						partitionKey
				) {
					return true;
				}
				return !idSet.has(item[this._primaryKey.property] as string);
			});
			await this.writeStore(remaining);
		} catch (err) {
			throw new GeneralError(
				FileEntityStorageConnector.CLASS_NAME,
				"removeBatchFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Teardown the storage by deleting the underlying store file.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the teardown process was successful.
	 */
	public async teardown(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		await nodeLogging?.log({
			level: "info",
			source: FileEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "storeTearingDown"
		});

		try {
			const filename = path.join(this._directory, "store.json");
			await unlink(filename);

			await nodeLogging?.log({
				level: "info",
				source: FileEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "storeTornDown"
			});

			return true;
		} catch (err) {
			await nodeLogging?.log({
				level: "error",
				source: FileEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "teardownFailed",
				error: BaseError.fromError(err)
			});
			return false;
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
		Guards.stringValue(FileEntityStorageConnector.CLASS_NAME, nameof(id), id);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const store = await this.readStore();

		const finalConditions = conditions ?? [];
		if (Is.stringValue(partitionKey)) {
			finalConditions.push({
				property: FileEntityStorageConnector._PARTITION_KEY as keyof T,
				value: partitionKey
			});
		}

		const index = this.findItem(store, id, undefined, finalConditions);

		if (index >= 0) {
			store.splice(index, 1);
			await this.writeStore(store);
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

		let allEntities = await this.readStore();

		const finalConditions: EntityCondition<T> = {
			conditions: [],
			logicalOperator: LogicalOperator.And
		};

		if (Is.stringValue(partitionKey)) {
			finalConditions.conditions.push({
				property: FileEntityStorageConnector._PARTITION_KEY,
				comparison: ComparisonOperator.Equals,
				value: partitionKey
			});
		}

		if (!Is.empty(conditions)) {
			finalConditions.conditions.push(
				FileEntityStorageConnector.normalizeNullToUndefined(conditions)
			);
		}

		const entities = [];
		const finalLimit = limit ?? FileEntityStorageConnector._DEFAULT_LIMIT;
		let nextCursor: string | undefined;

		if (allEntities.length > 0) {
			const finalSortKeys = EntitySchemaHelper.buildSortProperties<T>(
				this._entitySchema,
				sortProperties
			);
			allEntities = EntitySorter.sort(allEntities, finalSortKeys);

			const startIndex = Coerce.number(cursor) ?? 0;

			for (let i = startIndex; i < allEntities.length; i++) {
				if (
					EntityConditions.check(allEntities[i], finalConditions) &&
					entities.length < finalLimit
				) {
					const entity = ObjectHelper.pick(allEntities[i], properties);
					ObjectHelper.propertyDelete(entity, FileEntityStorageConnector._PARTITION_KEY);
					entities.push(entity);
					if (entities.length >= finalLimit) {
						if (i < allEntities.length - 1) {
							nextCursor = (i + 1).toString();
						}
						break;
					}
				}
			}
		}

		return {
			entities,
			cursor: nextCursor
		};
	}

	/**
	 * Count all the entities which match the conditions.
	 * @returns The total count of entities in the storage.
	 */
	public async count(): Promise<number> {
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		const store = await this.readStore();

		if (!Is.stringValue(partitionKey)) {
			return store.length;
		}

		return store.filter(
			item =>
				ObjectHelper.propertyGet(item as object, FileEntityStorageConnector._PARTITION_KEY) ===
				partitionKey
		).length;
	}

	/**
	 * Read the store from file.
	 * @returns The store.
	 * @internal
	 */
	private async readStore(): Promise<T[]> {
		try {
			const filename = path.join(this._directory, "store.json");
			const store = await readFile(filename, "utf8");
			return JSON.parse(store) as T[];
		} catch {
			return [];
		}
	}

	/**
	 * Write the store to the file.
	 * @param store The store to write.
	 * @returns Nothing.
	 * @internal
	 */
	private async writeStore(store: T[]): Promise<void> {
		try {
			const filename = path.join(this._directory, "store.json");
			await writeFile(filename, JSON.stringify(store, undefined, "\t"), "utf8");
		} catch {}
	}

	/**
	 * Check if the dir exists.
	 * @param dir The directory to check.
	 * @returns True if the dir exists.
	 * @internal
	 */
	private async dirExists(dir: string): Promise<boolean> {
		try {
			await access(dir);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Find the item in the store.
	 * @param store The store to search.
	 * @param id The id to search for.
	 * @param secondaryIndex The secondary index to search for.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The index of the item if found or -1.
	 * @internal
	 */
	private findItem(
		store: T[],
		id: string,
		secondaryIndex?: keyof T,
		conditions?: { property: keyof T; value: unknown }[]
	): number {
		const finalConditions: EntityCondition<T>[] = [];

		if (!Is.empty(secondaryIndex)) {
			finalConditions.push({
				property: secondaryIndex as string,
				comparison: ComparisonOperator.Equals,
				value: id
			});
		}

		if (Is.arrayValue(conditions)) {
			// If we haven't added a secondary index condition we need to add the primary key condition.
			if (finalConditions.length === 0) {
				finalConditions.push({
					property: this._primaryKey.property as string,
					comparison: ComparisonOperator.Equals,
					value: id
				});
			}
			finalConditions.push(
				...conditions.map(c => ({
					property: c.property as string,
					comparison: ComparisonOperator.Equals,
					value: c.value
				}))
			);
		}

		if (finalConditions.length > 0) {
			for (let i = 0; i < store.length; i++) {
				if (EntityConditions.check(store[i], { conditions: finalConditions })) {
					return i;
				}
			}
		} else {
			return store.findIndex(e => e[this._primaryKey.property] === id);
		}

		return -1;
	}
}
