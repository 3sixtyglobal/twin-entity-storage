// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	type DocumentSnapshot,
	Firestore,
	type Query,
	type Settings
} from "@google-cloud/firestore";
import { ContextIdHelper, ContextIdStore } from "@twin.org/context";
import {
	BaseError,
	ComponentFactory,
	Converter,
	GeneralError,
	Guards,
	HealthStatus,
	type IHealth,
	Is,
	ObjectHelper
} from "@twin.org/core";
import {
	ComparisonOperator,
	type EntityCondition,
	EntityConditions,
	EntitySchemaFactory,
	EntitySchemaHelper,
	type IEntitySchema,
	type IEntitySchemaProperty,
	SortDirection
} from "@twin.org/entity";
import type { IEntityStorageConnector } from "@twin.org/entity-storage-models";
import type { ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import type { JWTInput } from "google-auth-library";
import type { IFirestoreEntityStorageConnectorConfig } from "./models/IFirestoreEntityStorageConnectorConfig.js";
import type { IFirestoreEntityStorageConnectorConstructorOptions } from "./models/IFirestoreEntityStorageConnectorConstructorOptions.js";

/**
 * Class for performing entity storage operations using Firestore.
 */
export class FirestoreEntityStorageConnector<T = unknown> implements IEntityStorageConnector<T> {
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
	 * The configuration for the connector.
	 * @internal
	 */
	private readonly _config: IFirestoreEntityStorageConnectorConfig;

	/**
	 * The Firestore client.
	 * @internal
	 */
	private readonly _firestoreClient: Firestore;

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
		this._entitySchema = EntitySchemaFactory.get(options.entitySchema);
		this._partitionContextIds = options.partitionContextIds;
		this._primaryKey = EntitySchemaHelper.getPrimaryKey<T>(this._entitySchema);

		const firestoreOptions: Settings = {
			projectId: this._config.projectId,
			databaseId: this._config.databaseId,
			collectionName: this._config.collectionName,
			maxIdleChannels: this._config.settings?.maxIdleChannels,
			timeout: this._config.settings?.timeout,
			credentials
		};

		if (Is.stringValue(this._config.endpoint)) {
			firestoreOptions.host = this._config.endpoint;
			firestoreOptions.ssl = false;
		}

		this._firestoreClient = new Firestore(firestoreOptions);
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return FirestoreEntityStorageConnector.CLASS_NAME;
	}

	/**
	 * Returns the health status of the component.
	 * @returns The health status of the component.
	 */
	public async health(): Promise<IHealth[]> {
		try {
			await this._firestoreClient.listCollections();
			return [
				{
					source: FirestoreEntityStorageConnector.CLASS_NAME,
					status: HealthStatus.Ok,
					description: "healthDescription",
					data: { projectId: this._config.projectId, collectionName: this._config.collectionName }
				}
			];
		} catch {
			return [
				{
					source: FirestoreEntityStorageConnector.CLASS_NAME,
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
			const testDoc = this._firestoreClient.collection(this._config.collectionName).doc("test");
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

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const collection = this._firestoreClient.collection(this.collectionName(partitionKey));

			if (!Is.arrayValue(conditions)) {
				const docRef = collection.doc(id);
				const doc = await docRef.get();

				if (doc.exists) {
					return doc.data() as T;
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
				const entity = querySnapshot.docs[0].data() as T;
				return entity;
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

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		EntitySchemaHelper.validateEntity(entity, this.getSchema());

		try {
			const id = entity[this._primaryKey.property] as string;

			const collection = this._firestoreClient.collection(this.collectionName(partitionKey));

			const docRef = collection.doc(id);

			if (!Is.arrayValue(conditions)) {
				await docRef.set(entity);
			} else {
				await this._firestoreClient.runTransaction(async transaction => {
					const docSnapshot = await transaction.get(docRef);

					if (!docSnapshot.exists) {
						transaction.set(docRef, entity);
					} else {
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
							transaction.set(docRef, entity);
						}
					}
				});
			}
		} catch (err) {
			throw new GeneralError(
				FirestoreEntityStorageConnector.CLASS_NAME,
				"setEntityFailed",
				{ id: entity.id },
				err
			);
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
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		for (const entity of entities) {
			EntitySchemaHelper.validateEntity(entity, this.getSchema());
		}

		try {
			const collection = this._firestoreClient.collection(this.collectionName(partitionKey));
			const chunkSize = 500;
			for (let i = 0; i < entities.length; i += chunkSize) {
				const chunk = entities.slice(i, i + chunkSize);
				const batch = this._firestoreClient.batch();
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
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const collection = this._firestoreClient.collection(this.collectionName(partitionKey));
			const snapshot = await collection.get();
			const chunkSize = 500;
			for (let i = 0; i < snapshot.docs.length; i += chunkSize) {
				const chunk = snapshot.docs.slice(i, i + chunkSize);
				const batch = this._firestoreClient.batch();
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

		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const collection = this._firestoreClient.collection(this.collectionName(partitionKey));
			const docRef = collection.doc(id);

			if (!Is.arrayValue(conditions)) {
				await docRef.delete();
			} else {
				await this._firestoreClient.runTransaction(async transaction => {
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
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const collection = this._firestoreClient.collection(this.collectionName(partitionKey));
			const chunkSize = 500;
			for (let i = 0; i < ids.length; i += chunkSize) {
				const chunk = ids.slice(i, i + chunkSize);
				const batch = this._firestoreClient.batch();
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
	 * Teardown the storage by deleting all documents in the partition collection.
	 * @param nodeLoggingComponentType The node logging component type.
	 * @returns True if the teardown process was successful.
	 */
	public async teardown(nodeLoggingComponentType?: string): Promise<boolean> {
		const nodeLogging = ComponentFactory.getIfExists<ILoggingComponent>(nodeLoggingComponentType);
		const contextIds = await ContextIdStore.getContextIds();
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		await nodeLogging?.log({
			level: "info",
			source: FirestoreEntityStorageConnector.CLASS_NAME,
			ts: Date.now(),
			message: "storeTearingDown"
		});

		try {
			const collection = this._firestoreClient.collection(this.collectionName(partitionKey));
			const snapshot = await collection.get();
			const chunkSize = 500;
			for (let i = 0; i < snapshot.docs.length; i += chunkSize) {
				const chunk = snapshot.docs.slice(i, i + chunkSize);
				const batch = this._firestoreClient.batch();
				for (const doc of chunk) {
					batch.delete(doc.ref);
				}
				await batch.commit();
			}

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
		const partitionKey = ContextIdHelper.combinedContextKey(contextIds, this._partitionContextIds);

		try {
			const collection = this._firestoreClient.collection(this.collectionName(partitionKey));
			let query = collection as Query;

			if (!Is.empty(conditions)) {
				query = this.applyConditions(query, conditions);
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
				const cursorDoc = await this._firestoreClient.doc(cursor).get();
				if (cursorDoc?.exists) {
					query = query.startAfter(cursorDoc);
				}
				queryDescription.push(`Cursor: ${cursor}`);
			}

			const finalLimit = limit ?? FirestoreEntityStorageConnector._DEFAULT_LIMIT;
			query = query.limit(finalLimit);
			queryDescription.push(`Limit: ${finalLimit}`);

			if (properties) {
				query = query.select(...(properties as string[]));
				queryDescription.push(`Properties: ${properties.join(", ")}`);
			}

			const querySnapshot = await query.get();
			const entities = querySnapshot.docs.map((doc: DocumentSnapshot) => doc.data() as T);

			let nextCursor: string | undefined;
			if (entities.length === finalLimit) {
				nextCursor = querySnapshot.docs[querySnapshot.docs.length - 1].ref.path;
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
	 * Count all the entities which match the conditions.
	 * @returns The total count of entities in the storage.
	 */
	public async count(): Promise<number> {
		try {
			const contextIds = await ContextIdStore.getContextIds();
			const partitionKey = ContextIdHelper.combinedContextKey(
				contextIds,
				this._partitionContextIds
			);

			const collection = this._firestoreClient.collection(this.collectionName(partitionKey));
			const snapshot = await collection.count().get();
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
	 * Apply conditions to a Firestore query.
	 * @param query The initial query.
	 * @param condition The condition to apply.
	 * @returns The updated query.
	 * @internal
	 */
	private applyConditions(query: Query, condition: EntityCondition<T>): Query {
		if ("conditions" in condition) {
			// It's a group of conditions
			for (const c of condition.conditions) {
				query = this.applyConditions(query, c);
			}
			return query;
		}
		// It's a single condition
		const { property, comparison } = condition;
		// Firestore has no undefined type — the SDK throws on undefined values.
		// For Equals/NotEquals, null already has the correct semantics:
		//   == null  matches documents where the field is null OR missing
		//   != null  matches documents where the field exists and is not null
		const value = condition.value === undefined ? null : condition.value;
		switch (comparison) {
			case ComparisonOperator.Equals:
				return query.where(property, "==", value);
			case ComparisonOperator.NotEquals:
				return query.where(property, "!=", value);
			case ComparisonOperator.GreaterThan:
				return query.where(property, ">", value);
			case ComparisonOperator.LessThan:
				return query.where(property, "<", value);
			case ComparisonOperator.GreaterThanOrEqual:
				return query.where(property, ">=", value);
			case ComparisonOperator.LessThanOrEqual:
				return query.where(property, "<=", value);
			case ComparisonOperator.In:
				return query.where(property, "in", value as unknown[]);
			case ComparisonOperator.Includes:
				return query.where(property, "array-contains", value);
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
	 * @returns The collection name.
	 * @internal
	 */
	private collectionName(partitionKey?: string): string {
		return `${this._config.collectionName}_${partitionKey ?? "default"}`;
	}
}
