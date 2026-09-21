// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	type DocumentSnapshot,
	Filter,
	Firestore,
	type Query,
	type Settings
} from "@google-cloud/firestore";
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
	EntityConditions,
	EntitySchemaFactory,
	EntitySchemaHelper,
	type IEntitySchema,
	type IEntitySchemaProperty,
	LogicalOperator,
	SortDirection
} from "@twin.org/entity";
import {
	ConnectionHelper,
	EntityStorageCommon,
	EntityStorageHelper,
	type IEntityStorageConnector,
	type IEntityStorageJoinOptions,
	type IEntityStorageMigrationConnector,
	type IMigrationOptions,
	MigrationHelper
} from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import type { JWTInput } from "google-auth-library";
import type { IFirestoreEntityStorageConnectorConfig } from "./models/IFirestoreEntityStorageConnectorConfig.js";
import type { IFirestoreEntityStorageConnectorConstructorOptions } from "./models/IFirestoreEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations using Firestore.
 */
export class FirestoreEntityStorageConnector<T = unknown>
	implements IEntityStorageMigrationConnector<T>, IHealthProviderComponent
{
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<FirestoreEntityStorageConnector>();

	/**
	 * Limit the number of entities when finding.
	 * @internal
	 */
	private static readonly _DEFAULT_LIMIT: number = 40;

	/**
	 * Batch chunk size for bulk write operations.
	 * @internal
	 */
	private static readonly _BATCH_CHUNK_SIZE: number = 500;

	/**
	 * Maximum base collection name length, leaving room in the 1500-byte id limit for the partition suffix.
	 * @internal
	 */
	private static readonly _MAX_IDENTIFIER_LENGTH: number = 1024;

	/**
	 * Separator used between context ID parts in Firestore collection names.
	 * Must not be "/" which Firestore interprets as a path separator.
	 * @internal
	 */
	private static readonly _PARTITION_SEPARATOR: string = ":";

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
	 * The primary key.
	 * @internal
	 */
	private readonly _primaryKey: IEntitySchemaProperty<T>;

	/**
	 * The name of the version property, if any.
	 * @internal
	 */
	private readonly _versionKey?: string;

	/**
	 * The configuration for the connector.
	 * @internal
	 */
	private readonly _config: IFirestoreEntityStorageConnectorConfig;

	/**
	 * Milliseconds to wait for optimistic-lock mutexes before throwing.
	 * @internal
	 */
	private readonly _mutexTimeoutMs?: number;

	/**
	 * The instance id for this connector.
	 * @internal
	 */
	private readonly _instanceId: string;

	/**
	 * The parsed credentials for constructing the Firestore client.
	 * @internal
	 */
	private readonly _credentials?: JWTInput;

	/**
	 * Create a new instance of FirestoreEntityStorageConnector.
	 * @param options The options for the connector.
	 */
	constructor(options: IFirestoreEntityStorageConnectorConstructorOptions) {
		Guards.object(FirestoreEntityStorageConnector.CLASS_NAME, nameof(options), options);
		Guards.stringValue(
			FirestoreEntityStorageConnector.CLASS_NAME,
			nameof(options.entitySchema),
			options.entitySchema
		);
		Guards.object<IFirestoreEntityStorageConnectorConfig>(
			FirestoreEntityStorageConnector.CLASS_NAME,
			nameof(options.config),
			options.config
		);
		Guards.stringValue(
			FirestoreEntityStorageConnector.CLASS_NAME,
			nameof(options.config.projectId),
			options.config.projectId
		);
		Guards.stringValue(
			FirestoreEntityStorageConnector.CLASS_NAME,
			nameof(options.config.collectionName),
			options.config.collectionName
		);

		let credentials: JWTInput | undefined;
		if (!Is.empty(options.config.credentials)) {
			Guards.stringBase64(
				FirestoreEntityStorageConnector.CLASS_NAME,
				nameof(options.config.credentials),
				options.config.credentials
			);
			credentials = ObjectHelper.fromBytes<JWTInput>(
				Converter.base64ToBytes(options.config.credentials)
			);
		}

		this._config = options.config;
		this._entitySchemaName = options.entitySchema;
		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._partitionContextIds = options.partitionContextIds;
		this._primaryKey = EntitySchemaHelper.getPrimaryKey<T>(this._entitySchema);
		this._versionKey = EntitySchemaHelper.findVersionProperty(this._entitySchema);
		this._mutexTimeoutMs = Coerce.integer(options.config.mutexTimeoutMs);
		this._credentials = credentials;
		this._instanceId = RandomHelper.generateUuidV7("compact");
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return FirestoreEntityStorageConnector.CLASS_NAME;
	}

	/**
	 * Stop the component.
	 * @param nodeLoggingComponentType The node logging component type.
	 */
	public async stop(nodeLoggingComponentType?: string): Promise<void> {
		await ConnectionHelper.closeClient<Firestore>(
			"firestoreClients",
			this.createClientId(),
			this._instanceId,
			this._mutexTimeoutMs,
			async client => client.terminate()
		);
	}

	/**
	 * Returns the health status of the component.
	 * @returns The health status of the component.
	 */
	public async health(): Promise<IHealth[]> {
		try {
			const client = await this.getClient();
			await client.listCollections();
			return [
				{
					source: FirestoreEntityStorageConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Ok,
					description: "healthDescription",
					data: { projectId: this._config.projectId, collectionName: this._config.collectionName }
				}
			];
		} catch {
			return [
				{
					source: FirestoreEntityStorageConnector.CLASS_NAME,
					category: HealthCategory.Connectivity,
					status: HealthStatus.Error,
					description: "healthDescription",
					message: "connectionFailed",
					data: { projectId: this._config.projectId, collectionName: this._config.collectionName }
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
	 * Bootstrap the component by creating and initializing any resources it needs.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the bootstrapping process was successful.
	 */
	public async bootstrap(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		try {
			const client = await this.getClient();
			await nodeLogging?.log({
				level: "info",
				source: FirestoreEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "firestoreCreating",
				data: {
					projectId: this._config.projectId,
					collectionName: this._config.collectionName
				}
			});

			// Firestore doesn't require explicit collection creation
			// Perform a small write operation to ensure connectivity
			const testDoc = client.collection(this._config.collectionName).doc("test");
			await testDoc.set({ test: true });
			await testDoc.delete();

			await nodeLogging?.log({
				level: "info",
				source: FirestoreEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "firestoreCreated",
				data: {
					projectId: this._config.projectId,
					collectionName: this._config.collectionName
				}
			});

			return true;
		} catch (err) {
			await nodeLogging?.log({
				level: "error",
				source: FirestoreEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "firestoreCreationFailed",
				error: BaseError.fromError(err),
				data: {
					projectId: this._config.projectId,
					collectionName: this._config.collectionName
				}
			});
			return false;
		}
	}

	/**
	 * Get an entity.
	 * @param id The id of the entity to get.
	 * @param secondaryIndex The optional secondary index to use.
	 * @param conditions The optional conditions to apply to the query.
	 * @returns The object if it can be found or undefined.
	 */
	public async get(
		id: string,
		secondaryIndex?: keyof T,
		conditions?: { property: keyof T; value: unknown }[]
	): Promise<T | undefined> {
		Guards.stringValue(FirestoreEntityStorageConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(
			contextIds,
			this._partitionContextIds,
			FirestoreEntityStorageConnector._PARTITION_SEPARATOR
		);

		try {
			const client = await this.getClient();
			const collection = client.collection(this.collectionName(partitionKey));

			if (!Is.arrayValue(conditions)) {
				const docRef = collection.doc(id);
				const doc = await docRef.get();

				if (doc.exists) {
					return EntityStorageHelper.unPrepareEntity<T>(doc.data() as T, []);
				}
			}

			// Use conditions to construct a query
			let query: Query = collection;

			if (secondaryIndex) {
				query = query.where(secondaryIndex as string, "==", id);
			} else {
				// If no secondaryIndex, include primary key in conditions
				query = query.where(this._primaryKey.property as string, "==", id);
			}

			if (Is.arrayValue(conditions)) {
				for (const condition of conditions) {
					query = query.where(condition.property as string, "==", condition.value);
				}
			}

			const querySnapshot = await query.limit(1).get();
			if (!querySnapshot.empty) {
				return EntityStorageHelper.unPrepareEntity<T>(querySnapshot.docs[0].data() as T, []);
			}
		} catch (err) {
			throw new GeneralError(
				FirestoreEntityStorageConnector.CLASS_NAME,
				"getEntityFailed",
				{ id },
				err
			);
		}
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @param conditions The optional conditions to apply to the update.
	 * @returns Nothing.
	 */
	public async set(entity: T, conditions?: { property: keyof T; value: unknown }[]): Promise<void> {
		Guards.object(FirestoreEntityStorageConnector.CLASS_NAME, nameof(entity), entity);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(
			contextIds,
			this._partitionContextIds,
			FirestoreEntityStorageConnector._PARTITION_SEPARATOR
		);

		const submittedVersion = Is.stringValue(this._versionKey)
			? ObjectHelper.propertyGet<number>(entity, this._versionKey)
			: undefined;
		const hasVersionCheck =
			!Is.empty(this._versionKey) && !Is.empty(submittedVersion) && submittedVersion > 0;

		const prepared = EntityStorageHelper.prepareEntity(entity, this._entitySchema, undefined, {
			nullBehavior: "nullify"
		});
		const id = prepared[this._primaryKey.property] as string;
		const optimisticMutexKey = Is.stringValue(this._versionKey)
			? this.buildOptimisticMutexKey(partitionKey, id)
			: undefined;

		let conflictError: ConflictError | undefined;

		if (Is.stringValue(optimisticMutexKey)) {
			await Mutex.lock(optimisticMutexKey, {
				throwOnTimeout: true,
				timeoutMs: this._mutexTimeoutMs
			});
		}

		try {
			const client = await this.getClient();
			const collection = client.collection(this.collectionName(partitionKey));

			const docRef = collection.doc(id);

			if (!Is.arrayValue(conditions) && !Is.stringValue(this._versionKey)) {
				await docRef.set(prepared);
			} else {
				await client.runTransaction(async transaction => {
					conflictError = undefined;
					const docSnapshot = await transaction.get(docRef);

					if (!docSnapshot.exists) {
						if (Is.stringValue(this._versionKey)) {
							ObjectHelper.propertySet(prepared, this._versionKey, 1);
						}
						transaction.set(docRef, prepared as object);
					} else {
						const data = docSnapshot.data() as T;

						if (hasVersionCheck) {
							const storedVersion = ObjectHelper.propertyGet<number>(data, this._versionKey) ?? 0;
							if (storedVersion !== submittedVersion) {
								conflictError = new ConflictError(
									FirestoreEntityStorageConnector.CLASS_NAME,
									"optimisticLockFailed",
									id
								);
								return;
							}
						}

						if (
							Is.arrayValue(conditions) &&
							!EntityConditions.check(data, {
								conditions: conditions.map(c => ({
									property: c.property as string,
									comparison: ComparisonOperator.Equals,
									value: c.value
								}))
							})
						) {
							if (Is.stringValue(this._versionKey)) {
								conflictError = new ConflictError(
									FirestoreEntityStorageConnector.CLASS_NAME,
									"conditionFailed",
									id
								);
							}
							return;
						}

						if (Is.stringValue(this._versionKey)) {
							const storedVersion = ObjectHelper.propertyGet<number>(data, this._versionKey) ?? 0;
							ObjectHelper.propertySet(prepared, this._versionKey, storedVersion + 1);
						}
						transaction.set(docRef, prepared as object);
					}
				});
			}
		} catch (err) {
			throw new GeneralError(
				FirestoreEntityStorageConnector.CLASS_NAME,
				"setEntityFailed",
				{ id: ObjectHelper.propertyGet<string>(entity, "id") },
				err
			);
		} finally {
			if (Is.stringValue(optimisticMutexKey)) {
				Mutex.unlock(optimisticMutexKey);
			}
		}

		if (conflictError) {
			throw conflictError;
		}
	}

	/**
	 * Set multiple entities in a batch.
	 * @param entities The entities to set.
	 * @returns Nothing.
	 */
	public async setBatch(entities: T[]): Promise<void> {
		Guards.arrayValue(FirestoreEntityStorageConnector.CLASS_NAME, nameof(entities), entities);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(
			contextIds,
			this._partitionContextIds,
			FirestoreEntityStorageConnector._PARTITION_SEPARATOR
		);

		const preparedEntities = entities.map(entity =>
			EntityStorageHelper.prepareEntity(entity, this._entitySchema, undefined, {
				nullBehavior: "nullify"
			})
		);

		try {
			const client = await this.getClient();
			const collection = client.collection(this.collectionName(partitionKey));
			const chunkSize = FirestoreEntityStorageConnector._BATCH_CHUNK_SIZE;
			for (let i = 0; i < preparedEntities.length; i += chunkSize) {
				const chunk = preparedEntities.slice(i, i + chunkSize);
				const batch = client.batch();
				for (const entity of chunk) {
					const id = entity[this._primaryKey.property] as string;
					const docRef = collection.doc(id);
					batch.set(docRef, entity as { [key: string]: unknown });
				}
				await batch.commit();
			}
		} catch (err) {
			throw new GeneralError(
				FirestoreEntityStorageConnector.CLASS_NAME,
				"setBatchFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Empty the storage by deleting all entities in the collection.
	 * @returns Nothing.
	 */
	public async empty(): Promise<void> {
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(
			contextIds,
			this._partitionContextIds,
			FirestoreEntityStorageConnector._PARTITION_SEPARATOR
		);

		try {
			const client = await this.getClient();
			const collection = client.collection(this.collectionName(partitionKey));
			const snapshot = await collection.get();
			const chunkSize = 500;
			for (let i = 0; i < snapshot.docs.length; i += chunkSize) {
				const chunk = snapshot.docs.slice(i, i + chunkSize);
				const batch = client.batch();
				for (const doc of chunk) {
					batch.delete(doc.ref);
				}
				await batch.commit();
			}
		} catch (err) {
			throw new GeneralError(
				FirestoreEntityStorageConnector.CLASS_NAME,
				"emptyFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Remove the entity.
	 * @param id The id of the entity to remove.
	 * @param conditions The optional conditions to apply to the delete.
	 * @returns Nothing.
	 */
	public async remove(
		id: string,
		conditions?: { property: keyof T; value: unknown }[]
	): Promise<void> {
		Guards.stringValue(FirestoreEntityStorageConnector.CLASS_NAME, nameof(id), id);
		EntityStorageHelper.validateConditions(this._entitySchema, conditions);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(
			contextIds,
			this._partitionContextIds,
			FirestoreEntityStorageConnector._PARTITION_SEPARATOR
		);
		const optimisticMutexKey = Is.stringValue(this._versionKey)
			? this.buildOptimisticMutexKey(partitionKey, id)
			: undefined;

		let conflictError: ConflictError | undefined;

		if (Is.stringValue(optimisticMutexKey)) {
			await Mutex.lock(optimisticMutexKey, {
				throwOnTimeout: true,
				timeoutMs: this._mutexTimeoutMs
			});
		}

		try {
			const client = await this.getClient();
			const collection = client.collection(this.collectionName(partitionKey));
			const docRef = collection.doc(id);

			if (!Is.arrayValue(conditions)) {
				await docRef.delete();
			} else {
				await client.runTransaction(async transaction => {
					conflictError = undefined;
					const docSnapshot = await transaction.get(docRef);

					if (docSnapshot.exists) {
						const data = docSnapshot.data() as T;
						if (
							EntityConditions.check(data, {
								conditions: conditions.map(c => ({
									property: c.property as string,
									comparison: ComparisonOperator.Equals,
									value: c.value
								}))
							})
						) {
							transaction.delete(docRef);
						} else if (Is.stringValue(this._versionKey)) {
							conflictError = new ConflictError(
								FirestoreEntityStorageConnector.CLASS_NAME,
								"conditionFailed",
								id
							);
						}
					}
				});
			}
		} catch (err) {
			throw new GeneralError(
				FirestoreEntityStorageConnector.CLASS_NAME,
				"removeEntityFailed",
				{ id },
				err
			);
		} finally {
			if (Is.stringValue(optimisticMutexKey)) {
				Mutex.unlock(optimisticMutexKey);
			}
		}

		if (conflictError) {
			throw conflictError;
		}
	}

	/**
	 * Remove multiple entities by their primary key IDs using a Firestore WriteBatch.
	 * @param ids The ids of the entities to remove.
	 * @returns Nothing.
	 */
	public async removeBatch(ids: string[]): Promise<void> {
		Guards.arrayValue(FirestoreEntityStorageConnector.CLASS_NAME, nameof(ids), ids);

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(
			contextIds,
			this._partitionContextIds,
			FirestoreEntityStorageConnector._PARTITION_SEPARATOR
		);

		try {
			const client = await this.getClient();
			const collection = client.collection(this.collectionName(partitionKey));
			const chunkSize = 500;
			for (let i = 0; i < ids.length; i += chunkSize) {
				const chunk = ids.slice(i, i + chunkSize);
				const batch = client.batch();
				for (const id of chunk) {
					const docRef = collection.doc(id);
					batch.delete(docRef);
				}
				await batch.commit();
			}
		} catch (err) {
			throw new GeneralError(
				FirestoreEntityStorageConnector.CLASS_NAME,
				"removeBatchFailed",
				undefined,
				err
			);
		}
	}

	/**
	 * Teardown the storage by deleting all documents across all partition collections.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the teardown process was successful.
	 */
	public async teardown(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);

		await nodeLogging?.log({
			level: "info",
			source: FirestoreEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "storeTearingDown"
		});

		try {
			await this.deleteAllPartitionCollections(this._config.collectionName);

			await nodeLogging?.log({
				level: "info",
				source: FirestoreEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "storeTornDown"
			});

			return true;
		} catch (err) {
			await nodeLogging?.log({
				level: "error",
				source: FirestoreEntityStorageConnector.CLASS_NAME,
				ts: Date.now(),
				message: "teardownFailed",
				error: BaseError.fromError(err)
			});
			return false;
		}
	}

	/**
	 * Get a unique list of all the context ids from the storage.
	 * @param loggingComponentType The optional component type to use for logging skipped partition ids.
	 * @returns The list of unique context ids.
	 */
	public async getPartitionContextIds(
		loggingComponentType?: string
	): Promise<IContextIds[] | undefined> {
		const partitionContextIds = this._partitionContextIds;
		if (!Is.arrayValue(partitionContextIds)) {
			return undefined;
		}
		try {
			const client = await this.getClient();
			const prefix = `${this._config.collectionName}_`;
			const collections = await client.listCollections();
			const result: IContextIds[] = [];
			const skipped: string[] = [];
			for (const col of collections) {
				if (col.id.startsWith(prefix)) {
					const partitionKey = col.id.slice(prefix.length);
					if (Is.stringValue(partitionKey)) {
						const split = EntityStorageHelper.tryShortSplit(
							partitionContextIds,
							partitionKey,
							FirestoreEntityStorageConnector._PARTITION_SEPARATOR
						);
						if (Is.undefined(split)) {
							skipped.push(partitionKey);
						} else {
							result.push(split);
						}
					}
				}
			}
			if (Is.arrayValue(skipped)) {
				const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(loggingComponentType);
				await nodeLogging?.log({
					level: "warn",
					source: FirestoreEntityStorageConnector.CLASS_NAME,
					ts: Date.now(),
					message: "partitionIdsSkipped",
					data: {
						expected: partitionContextIds.length,
						partitionIds: skipped.join(", ")
					}
				});
			}
			return result;
		} catch (err) {
			throw new GeneralError(
				FirestoreEntityStorageConnector.CLASS_NAME,
				"getPartitionContextIdsFailed",
				undefined,
				err
			);
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
	 * Create the target connector for performing the migration using a temporary collection name.
	 * @param newEntitySchema The name of the new entity schema to create the connector for.
	 * @returns Connector for performing the migration.
	 */
	public async createTargetConnector<U>(
		newEntitySchema: string
	): Promise<IEntityStorageConnector<U>> {
		const migrationCollectionName = MigrationHelper.generateTargetName(
			this._config.collectionName,
			FirestoreEntityStorageConnector._MAX_IDENTIFIER_LENGTH
		);
		return new FirestoreEntityStorageConnector<U>({
			entitySchema: newEntitySchema,
			config: { ...this._config, collectionName: migrationCollectionName },
			partitionContextIds: this._partitionContextIds
		});
	}

	/**
	 * Finalize the migration by tearing down the old collections and replacing them with the target collections.
	 * @param targetConnector The target connector to finalize the migration with.
	 * @param options The options to control how the migration is finalized.
	 * @param loggingComponentType The optional component type to use for logging.
	 * @returns The final connector pointing at the original collection name.
	 */
	public async finalizeMigration<U>(
		targetConnector: FirestoreEntityStorageConnector<U>,
		options?: IMigrationOptions,
		loggingComponentType?: string
	): Promise<FirestoreEntityStorageConnector<U>> {
		// Firestore has no collection-rename operation, so we create fresh collections under
		// the original name, copy all documents from the migration collections, then delete the
		// migration collections.

		// Teardown all existing source collections to free up the original collection name prefix.
		await this.teardown(loggingComponentType);

		// Create a new connector at the original collection name but with the new schema.
		const originalCollectionName = this._config.collectionName;
		const finalConnector = new FirestoreEntityStorageConnector<U>({
			entitySchema: targetConnector._entitySchemaName,
			config: { ...targetConnector._config, collectionName: originalCollectionName },
			partitionContextIds: this._partitionContextIds
		});

		if (await finalConnector.bootstrap(loggingComponentType)) {
			// Since there is no rename, we need to copy the data from the migration table to the new table
			const partitions = await targetConnector.getPartitionContextIds();
			const batchSize = options?.batchSize ?? FirestoreEntityStorageConnector._DEFAULT_LIMIT;
			await this.bulkCopy(targetConnector, finalConnector, partitions, batchSize);

			await targetConnector.teardown(loggingComponentType);

			return finalConnector;
		}
		throw new GeneralError(
			FirestoreEntityStorageConnector.CLASS_NAME,
			"finalizeMigrationFailedBootstrap",
			undefined
		);
	}

	/**
	 * Cleanup the migration if a migration fails or needs to be aborted.
	 * @param targetConnector The target connector to cleanup.
	 * @param options The options to control how the migration is cleaned up.
	 * @param loggingComponentType The optional component type to use for logging.
	 */
	public async cleanupMigration<U>(
		targetConnector: IEntityStorageConnector<U> | undefined,
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
	 * @param limit The suggested number of entities to return in each chunk.
	 * @returns The matching entities and a cursor for the next page.
	 */
	public async query(
		conditions?: EntityCondition<T>,
		sortProperties?: { property: keyof T; sortDirection: SortDirection }[],
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
		const queryDescription: string[] = [];

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(
			contextIds,
			this._partitionContextIds,
			FirestoreEntityStorageConnector._PARTITION_SEPARATOR
		);

		const finalLimit = limit ?? FirestoreEntityStorageConnector._DEFAULT_LIMIT;

		EntityStorageHelper.validateSortProperties(this._entitySchema, sortProperties);
		EntityStorageHelper.validateProperties(this._entitySchema, properties);
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);

		if (!Is.empty(limit)) {
			const validationFailures: IValidationFailure[] = [];
			Validation.integer(nameof(limit), limit, validationFailures, undefined, { minValue: 1 });
			Validation.asValidationError(
				FirestoreEntityStorageConnector.CLASS_NAME,
				"query",
				validationFailures
			);
		}

		try {
			const client = await this.getClient();
			const collection = client.collection(this.collectionName(partitionKey));

			// Firestore has no native substring search. When any condition needs in-memory
			// filtering (string Includes / NotIncludes), fetch all matching docs and filter
			// client-side, using an index-based cursor for pagination.
			if (!Is.empty(conditions) && this.needsPostFilter(conditions)) {
				queryDescription.push("InMemoryFilter");

				let baseQuery = collection as Query;

				if (Is.arrayValue(sortProperties)) {
					for (const { property, sortDirection } of sortProperties) {
						baseQuery = baseQuery.orderBy(
							property as string,
							sortDirection === SortDirection.Ascending ? "asc" : "desc"
						);
					}
				}

				const allSnapshot = await baseQuery.get();
				let allEntities = allSnapshot.docs.map((doc: DocumentSnapshot) =>
					EntityStorageHelper.unPrepareEntity<T>(doc.data() as T, [])
				);

				allEntities = allEntities.filter(e => EntityConditions.check(e as Partial<T>, conditions));

				let projected: Partial<T>[];
				if (Is.arrayValue(properties)) {
					projected = allEntities.map(e => {
						const out: Partial<T> = {};
						for (const prop of properties) {
							if (prop in (e as object)) {
								out[prop] = e[prop];
							}
						}
						return out;
					});
				} else {
					projected = allEntities;
				}

				const start = Is.stringValue(cursor) ? Number.parseInt(cursor, 10) : 0;
				const page = projected.slice(start, start + finalLimit);
				const nextCursor =
					start + finalLimit < projected.length ? String(start + finalLimit) : undefined;

				return { entities: page, cursor: nextCursor };
			}

			if (this.hasEmptyInCondition(conditions)) {
				return { entities: [], cursor: undefined };
			}

			// Prune empty-In leaves from OR branches: the Firestore SDK throws on
			// Filter.where(prop, "in", []) even inside an OR where other branches still match.
			// hasEmptyInCondition above already handles the all-false case, so pruning here
			// is safe - any removed leaf was a no-op branch.
			const effectiveConditions = !Is.empty(conditions)
				? (this.pruneEmptyInConditions(conditions) ?? undefined)
				: conditions;

			let query = collection as Query;

			if (!Is.empty(effectiveConditions)) {
				query = this.applyConditions(query, effectiveConditions);
				queryDescription.push(`Conditions: ${JSON.stringify(conditions)}`);
			}

			if (Is.arrayValue(sortProperties)) {
				for (const { property, sortDirection } of sortProperties) {
					query = query.orderBy(
						property as string,
						sortDirection === SortDirection.Ascending ? "asc" : "desc"
					);
				}
				queryDescription.push(`Sort: ${JSON.stringify(sortProperties)}`);
			}

			if (Is.stringValue(cursor)) {
				// Discard cursors from a different partition - startAfter() throws if the
				// snapshot belongs to a different collection than the current query.
				const cursorCollection = cursor.slice(0, cursor.lastIndexOf("/"));
				if (cursorCollection === this.collectionName(partitionKey)) {
					const cursorDoc = await client.doc(cursor).get();
					if (cursorDoc?.exists) {
						query = query.startAfter(cursorDoc);
					}
					queryDescription.push(`Cursor: ${cursor}`);
				}
			}

			query = query.limit(finalLimit + 1);
			queryDescription.push(`Limit: ${finalLimit}`);

			if (Is.arrayValue(properties)) {
				query = query.select(...(properties as string[]));
				queryDescription.push(`Properties: ${properties.join(", ")}`);
			}

			const querySnapshot = await query.get();
			const hasMore = querySnapshot.docs.length > finalLimit;
			const resultDocs = hasMore ? querySnapshot.docs.slice(0, finalLimit) : querySnapshot.docs;
			const entities = resultDocs.map((doc: DocumentSnapshot) =>
				EntityStorageHelper.unPrepareEntity<T>(doc.data() as T, [])
			);

			let nextCursor: string | undefined;
			if (hasMore) {
				nextCursor = resultDocs[resultDocs.length - 1].ref.path;
			}

			return {
				entities,
				cursor: nextCursor
			};
		} catch (err) {
			throw new GeneralError(
				FirestoreEntityStorageConnector.CLASS_NAME,
				"queryFailed",
				{ queryDescription: queryDescription.join("; ") },
				err
			);
		}
	}

	/**
	 * Find all the entities which match the conditions, attaching to each one the entities from a
	 * second storage connector whose join property matches. The join behaves like a left join by
	 * default, a primary entity with no matches is still returned with an empty joined list, unless
	 * joinRequired asks for an inner join and those entities are left out altogether.
	 * @param joinConnector The connector holding the entities to join to.
	 * @param joinOptions The properties to join on, the conditions, sort order, projection and
	 * paging for the primary entities, the optional grouping and group conditions, and the optional
	 * conditions, sort order and projection for the joined entities.
	 * @returns All the entities for the storage matching the conditions with their joined entities,
	 * and a cursor which can be used to request more entities.
	 */
	public async queryJoin<U>(
		joinConnector: IEntityStorageConnector<U>,
		joinOptions: IEntityStorageJoinOptions<T, U>
	): Promise<{ entities: (Partial<T> & { joined: Partial<U>[] })[]; cursor?: string }> {
		return EntityStorageCommon.queryJoin(this, joinConnector, joinOptions);
	}

	/**
	 * Count all the entities which match the conditions.
	 * @param conditions The optional conditions to match for the entities.
	 * @returns The total count of entities in the storage.
	 */
	public async count(conditions?: EntityCondition<T>): Promise<number> {
		EntityStorageHelper.validateConditionProperties(this._entitySchema, conditions);

		try {
			const client = await this.getClient();
			const contextIds = await ContextIdStore.getContextIds();
			const partitionKey = ContextIdHelper.combinedContextKey(
				contextIds,
				this._partitionContextIds,
				FirestoreEntityStorageConnector._PARTITION_SEPARATOR
			);

			const collection = client.collection(this.collectionName(partitionKey));

			if (this.hasEmptyInCondition(conditions)) {
				return 0;
			}

			if (!Is.empty(conditions) && this.needsPostFilter(conditions)) {
				const allSnapshot = await collection.get();
				const allEntities = allSnapshot.docs.map((doc: DocumentSnapshot) =>
					EntityStorageHelper.unPrepareEntity<T>(doc.data() as T, [])
				);
				return allEntities.filter(e => EntityConditions.check(e as Partial<T>, conditions)).length;
			}

			const effectiveConditions = !Is.empty(conditions)
				? (this.pruneEmptyInConditions(conditions) ?? undefined)
				: conditions;

			let query = collection as Query;
			if (!Is.empty(effectiveConditions)) {
				query = this.applyConditions(query, effectiveConditions);
			}

			const snapshot = await query.count().get();
			return snapshot.data().count;
		} catch (err) {
			throw new GeneralError(
				FirestoreEntityStorageConnector.CLASS_NAME,
				"countFailed",
				undefined,
				err
			);
		}
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
		sourceConnector: FirestoreEntityStorageConnector<U>,
		destConnector: FirestoreEntityStorageConnector<U>,
		partitions: IContextIds[] | undefined,
		batchSize: number
	): Promise<void> {
		if (partitions?.length === 0) {
			return;
		}
		// undefined → not partitioned: one pass with no partition key.
		// [{…}, …]  → partitioned with data: iterate over each partition.
		const partitionList = partitions ?? [{}];

		for (let i = 0; i < partitionList.length; i++) {
			// Values from getPartitionContextIds are already short-form, so we join them
			// directly rather than using combinedContextKey, which expects long-form input
			// and calls guardAll (throwing if a registered handler rejects short-form values).
			const partitionKey = Is.arrayValue(sourceConnector._partitionContextIds)
				? sourceConnector._partitionContextIds
						.map(k => partitionList[i][k])
						.join(FirestoreEntityStorageConnector._PARTITION_SEPARATOR)
				: undefined;

			const sourceCollection = (await sourceConnector.getClient()).collection(
				sourceConnector.collectionName(partitionKey)
			);
			const destCollection = (await destConnector.getClient()).collection(
				destConnector.collectionName(partitionKey)
			);

			let lastDoc: DocumentSnapshot | undefined;
			let hasMore = true;

			while (hasMore) {
				let pageQuery = sourceCollection.limit(batchSize);
				if (lastDoc) {
					pageQuery = pageQuery.startAfter(lastDoc);
				}
				const snapshot = await pageQuery.get();
				const docs = snapshot.docs;

				for (let j = 0; j < docs.length; j += batchSize) {
					const chunk = docs.slice(j, j + batchSize);
					const batch = (await destConnector.getClient()).batch();
					for (const doc of chunk) {
						batch.set(destCollection.doc(doc.id), doc.data());
					}
					await batch.commit();
				}

				lastDoc = docs[docs.length - 1];
				hasMore = docs.length === batchSize;
			}
		}
	}

	/**
	 * Delete all documents in every collection whose name starts with collectionName_.
	 * @param collectionName The base collection name prefix.
	 * @internal
	 */
	private async deleteAllPartitionCollections(collectionName: string): Promise<void> {
		const client = await this.getClient();
		const prefix = `${collectionName}_`;
		const collections = await client.listCollections();
		const chunkSize = 500;
		for (const col of collections) {
			if (col.id.startsWith(prefix)) {
				const snapshot = await col.get();
				for (let i = 0; i < snapshot.docs.length; i += chunkSize) {
					const chunk = snapshot.docs.slice(i, i + chunkSize);
					const batch = client.batch();
					for (const doc of chunk) {
						batch.delete(doc.ref);
					}
					await batch.commit();
				}
			}
		}
	}

	/**
	 * Returns true when the condition tree is guaranteed to match nothing due to empty
	 * In lists, respecting AND/OR boolean semantics (#141):
	 * - AND group: true if ANY child is always-false (false AND x = false)
	 * - OR  group: true if ALL children are always-false (false OR false = false)
	 * - Leaf:      true only for `In []`
	 * @param condition The condition tree to inspect.
	 * @returns True if a short-circuit to empty results is required.
	 * @internal
	 */
	private hasEmptyInCondition(condition?: EntityCondition<T>): boolean {
		if (Is.empty(condition)) {
			return false;
		}
		if ("conditions" in condition) {
			return condition.logicalOperator === LogicalOperator.Or
				? condition.conditions.every(c => this.hasEmptyInCondition(c))
				: condition.conditions.some(c => this.hasEmptyInCondition(c));
		}
		return (
			condition.comparison === ComparisonOperator.In &&
			Is.array(condition.value) &&
			condition.value.length === 0
		);
	}

	/**
	 * Returns a copy of the condition tree with all empty-In leaves removed.
	 * Used to keep `In []` out of native Firestore Filter calls (the SDK throws on
	 * `Filter.where(prop, "in", [])`) while preserving correct OR semantics (#141).
	 * Returns null when the entire subtree reduces to nothing (caller should treat
	 * as no conditions).
	 * @param condition The condition to prune.
	 * @returns The pruned condition, or null if the subtree was fully removed.
	 * @internal
	 */
	private pruneEmptyInConditions(condition: EntityCondition<T>): EntityCondition<T> | null {
		if (!("conditions" in condition)) {
			if (
				condition.comparison === ComparisonOperator.In &&
				Is.array(condition.value) &&
				condition.value.length === 0
			) {
				return null;
			}
			return condition;
		}
		// For AND groups: if any child has an empty In, the whole AND is dead.
		// Do not recurse - promoting the surviving siblings would turn a dead
		// branch into a live one when this AND sits inside an OR (#141).
		if (condition.logicalOperator !== LogicalOperator.Or && this.hasEmptyInCondition(condition)) {
			return null;
		}
		// For OR groups: prune dead branches individually so the Firestore SDK
		// never receives `In []`, while keeping live siblings.
		const pruned = condition.conditions
			.map(c => this.pruneEmptyInConditions(c))
			.filter((c): c is EntityCondition<T> => c !== null);
		if (pruned.length === 0) {
			return null;
		}
		if (pruned.length === 1) {
			return pruned[0];
		}
		return { ...condition, conditions: pruned };
	}

	/**
	 * Returns true when any leaf condition requires client-side filtering
	 * (Firestore has no native string-contains / not-contains operator).
	 * @param condition The condition tree to inspect.
	 * @returns True if post-filtering is required.
	 * @internal
	 */
	private needsPostFilter(condition?: EntityCondition<T>): boolean {
		if (Is.empty(condition)) {
			return false;
		}
		if ("conditions" in condition) {
			return condition.conditions.some(c => this.needsPostFilter(c));
		}
		const { comparison, value } = condition;
		if (comparison === ComparisonOperator.NotIncludes) {
			return true;
		}
		// Includes on a primitive (string/number) means substring search - not natively supported.
		// Includes on an object means array-contains, which Firestore does support.
		if (comparison === ComparisonOperator.Includes && (value === null || !Is.object(value))) {
			return true;
		}
		return false;
	}

	/**
	 * Apply conditions to a Firestore query using composite Filter objects so that
	 * OR groups are handled correctly.
	 * @param query The initial query.
	 * @param condition The condition to apply.
	 * @returns The updated query.
	 * @internal
	 */
	private applyConditions(query: Query, condition: EntityCondition<T>): Query {
		return query.where(this.buildFilter(condition));
	}

	/**
	 * Recursively convert an EntityCondition tree into a Firestore Filter.
	 * Only called for native conditions (needsPostFilter must be false).
	 * @param condition The condition to convert.
	 * @returns A Firestore Filter.
	 * @throws GeneralError if the comparison operator is not supported.
	 * @internal
	 */
	private buildFilter(condition: EntityCondition<T>): Filter {
		if ("conditions" in condition) {
			const filters = condition.conditions.map(c => this.buildFilter(c));
			return condition.logicalOperator === LogicalOperator.Or
				? Filter.or(...filters)
				: Filter.and(...filters);
		}
		const { property, comparison } = condition;
		// Firestore has no undefined type - null has the correct semantics:
		//   == null  matches documents where the field is null OR missing
		//   != null  matches documents where the field exists and is not null
		const value = condition.value === undefined ? null : condition.value;
		switch (comparison) {
			case ComparisonOperator.Equals:
				return Filter.where(property, "==", value);
			case ComparisonOperator.NotEquals:
				return Filter.where(property, "!=", value);
			case ComparisonOperator.GreaterThan:
				return Filter.where(property, ">", value);
			case ComparisonOperator.LessThan:
				return Filter.where(property, "<", value);
			case ComparisonOperator.GreaterThanOrEqual:
				return Filter.where(property, ">=", value);
			case ComparisonOperator.LessThanOrEqual:
				return Filter.where(property, "<=", value);
			case ComparisonOperator.In:
				return Filter.where(property, "in", value);
			case ComparisonOperator.StartsWith:
				if (!Is.string(value)) {
					throw new GeneralError(
						FirestoreEntityStorageConnector.CLASS_NAME,
						"unsupportedComparisonOperator",
						{ comparison }
					);
				}
				return Filter.and(
					Filter.where(property, ">=", value),
					Filter.where(property, "<=", `${value}\uF8FF`)
				);
			case ComparisonOperator.Includes:
				// Object value → array-contains (caller ensured needsPostFilter is false here)
				return Filter.where(property, "array-contains", value);
			case ComparisonOperator.NotIncludes:
			default:
				throw new GeneralError(
					FirestoreEntityStorageConnector.CLASS_NAME,
					"unsupportedComparisonOperator",
					{ comparison }
				);
		}
	}

	/**
	 * Get the collection name based on partition key.
	 * @param partitionKey The optional partition key to include in the collection name.
	 * @returns The collection name.
	 * @internal
	 */
	private collectionName(partitionKey?: string): string {
		return `${this._config.collectionName}_${partitionKey ?? "default"}`;
	}

	/**
	 * Get the shared Firestore client, opening it if needed.
	 * @returns The Firestore client.
	 * @internal
	 */
	private async getClient(): Promise<Firestore> {
		return ConnectionHelper.openClient<Firestore>(
			"firestoreClients",
			this.createClientId(),
			this._instanceId,
			this._mutexTimeoutMs,
			async () => {
				const firestoreOptions: Settings = {
					projectId: this._config.projectId,
					databaseId: this._config.databaseId,
					collectionName: this._config.collectionName,
					maxIdleChannels: this._config.settings?.maxIdleChannels,
					timeout: this._config.settings?.timeout,
					credentials: this._credentials
				};
				if (Is.stringValue(this._config.endpoint)) {
					firestoreOptions.host = this._config.endpoint;
					firestoreOptions.ssl = false;
				}
				return new Firestore(firestoreOptions);
			}
		);
	}

	/**
	 * Create the client id for the shared store key.
	 * @returns The client id string.
	 * @internal
	 */
	private createClientId(): string {
		return `${this._config.projectId}|${this._config.databaseId ?? ""}|${this._config.endpoint ?? ""}`;
	}

	/**
	 * Build a mutex key for optimistic-locking critical sections.
	 * @param partitionKey The resolved partition key.
	 * @param id The entity id.
	 * @returns The mutex key.
	 * @internal
	 */
	private buildOptimisticMutexKey(partitionKey: string | undefined, id: string): string {
		return `${FirestoreEntityStorageConnector.CLASS_NAME}:optimistic:${this._config.collectionName}:${partitionKey ?? "default"}:${id}`;
	}
}
