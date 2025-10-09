// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { BaseRestClient } from "@twin.org/api-core";
import {
	HttpParameterHelper,
	type IBaseRestClientConfig,
	type INoContentResponse
} from "@twin.org/api-models";
import { Coerce, Guards } from "@twin.org/core";
import type { EntityCondition, SortDirection } from "@twin.org/entity";
import type {
	IEntityStorageComponent,
	IEntityStorageGetRequest,
	IEntityStorageGetResponse,
	IEntityStorageListRequest,
	IEntityStorageListResponse,
	IEntityStorageRemoveRequest,
	IEntityStorageSetRequest
} from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";

/**
 * Client for performing entity storage through to REST endpoints.
 */
export class EntityStorageRestClient<T>
	extends BaseRestClient
	implements IEntityStorageComponent<T>
{
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<EntityStorageRestClient<unknown>>();

	/**
	 * Create a new instance of EntityStorageClient.
	 * @param config The configuration for the client.
	 */
	constructor(config: IBaseRestClientConfig) {
		super(nameof<EntityStorageRestClient<T>>(), config, "entity-storage");
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @returns The id of the entity.
	 */
	public async set(entity: T): Promise<void> {
		Guards.object(EntityStorageRestClient.CLASS_NAME, nameof(entity), entity);

		await this.fetch<IEntityStorageSetRequest, INoContentResponse>("/", "POST", {
			body: entity
		});
	}

	/**
	 * Get an entity.
	 * @param id The id of the entity to get, or the index value if secondaryIndex is set.
	 * @param secondaryIndex Get the item using a secondary index.
	 * @returns The object if it can be found or undefined.
	 */
	public async get(id: string, secondaryIndex?: keyof T): Promise<T | undefined> {
		Guards.stringValue(EntityStorageRestClient.CLASS_NAME, nameof(id), id);

		const response = await this.fetch<IEntityStorageGetRequest, IEntityStorageGetResponse>(
			"/:id",
			"GET",
			{
				pathParams: {
					id
				},
				query: {
					secondaryIndex: secondaryIndex as string
				}
			}
		);

		return response.body as T;
	}

	/**
	 * Remove the entity.
	 * @param id The id of the entity to remove.
	 * @returns Nothing.
	 */
	public async remove(id: string): Promise<void> {
		Guards.stringValue(EntityStorageRestClient.CLASS_NAME, nameof(id), id);

		await this.fetch<IEntityStorageRemoveRequest, INoContentResponse>("/:id", "DELETE", {
			pathParams: {
				id
			}
		});
	}

	/**
	 * Query all the entities which match the conditions.
	 * @param conditions The conditions to match for the entities.
	 * @param orderBy The order for the results.
	 * @param orderByDirection The direction for the order, defaults to ascending.
	 * @param properties The optional properties to return, defaults to all.
	 * @param cursor The cursor to request the next chunk of entities.
	 * @param limit The suggested number of entities to return in each chunk, in some scenarios can return a different amount.
	 * @returns All the entities for the storage matching the conditions,
	 * and a cursor which can be used to request more entities.
	 */
	public async query(
		conditions?: EntityCondition<T>,
		orderBy?: keyof T,
		orderByDirection?: SortDirection,
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
		const result = await this.fetch<IEntityStorageListRequest, IEntityStorageListResponse>(
			"/",
			"GET",
			{
				query: {
					conditions: HttpParameterHelper.objectToString(conditions),
					orderBy: orderBy as string,
					orderByDirection,
					properties: HttpParameterHelper.arrayToString(properties),
					limit: Coerce.string(limit),
					cursor
				}
			}
		);

		return {
			entities: result.body.entities as Partial<T>[],
			cursor: result.body.cursor
		};
	}
}
