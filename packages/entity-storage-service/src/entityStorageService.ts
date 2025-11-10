// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { Guards, Is, NotFoundError } from "@twin.org/core";
import {
	ComparisonOperator,
	type EntityCondition,
	EntitySchemaHelper,
	LogicalOperator,
	SortDirection
} from "@twin.org/entity";
import {
	EntityStorageConnectorFactory,
	type IEntityStorageComponent,
	type IEntityStorageConnector
} from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";
import type { IEntityStorageServiceConstructorOptions } from "./models/IEntityStorageServiceConstructorOptions.js";

/**
 * Class for performing entity service operations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EntityStorageService<T = any> implements IEntityStorageComponent<T> {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<EntityStorageService>();

	/**
	 * The entity storage for items.
	 * @internal
	 */
	private readonly _entityStorage: IEntityStorageConnector<T>;

	/**
	 * Create a new instance of EntityStorageService.
	 * @param options The dependencies for the entity storage service.
	 */
	constructor(options: IEntityStorageServiceConstructorOptions) {
		Guards.string(
			EntityStorageService.CLASS_NAME,
			nameof(options.entityStorageType),
			options.entityStorageType
		);
		this._entityStorage = EntityStorageConnectorFactory.get<IEntityStorageConnector<T>>(
			options.entityStorageType
		);
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return EntityStorageService.CLASS_NAME;
	}

	/**
	 * Set an entity.
	 * @param entity The entity to set.
	 * @returns The id of the entity.
	 */
	public async set(entity: T): Promise<void> {
		Guards.object(EntityStorageService.CLASS_NAME, nameof(entity), entity);

		return this._entityStorage.set(entity, undefined);
	}

	/**
	 * Get an entity.
	 * @param id The id of the entity to get, or the index value if secondaryIndex is set.
	 * @param secondaryIndex Get the item using a secondary index.
	 * @returns The object if it can be found or undefined.
	 */
	public async get(id: string, secondaryIndex?: keyof T): Promise<T | undefined> {
		Guards.stringValue(EntityStorageService.CLASS_NAME, nameof(id), id);

		return this.internalGet(id, secondaryIndex);
	}

	/**
	 * Remove the entity.
	 * @param id The id of the entity to remove.
	 * @returns Nothing.
	 */
	public async remove(id: string): Promise<void> {
		Guards.stringValue(EntityStorageService.CLASS_NAME, nameof(id), id);

		await this._entityStorage.remove(id);
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
		const result = await this._entityStorage.query(
			conditions,
			Is.stringValue(orderBy)
				? [{ property: orderBy, sortDirection: orderByDirection ?? SortDirection.Ascending }]
				: undefined,
			properties,
			cursor,
			limit
		);

		return result;
	}

	/**
	 * Get an entity.
	 * @param id The id of the entity to get, or the index value if secondaryIndex is set.
	 * @param secondaryIndex Get the item using a secondary index.
	 * @returns The object if it can be found or throws.
	 * @internal
	 */
	private async internalGet(id: string, secondaryIndex?: keyof T): Promise<T> {
		const conditions: EntityCondition<T>[] = [];

		if (Is.stringValue(secondaryIndex)) {
			conditions.push({
				property: secondaryIndex,
				comparison: ComparisonOperator.Equals,
				value: id
			});
		}

		let entity: T | undefined;
		if (conditions.length === 0) {
			entity = await this._entityStorage.get(id, secondaryIndex);
		} else {
			if (!Is.stringValue(secondaryIndex)) {
				const schema = this._entityStorage.getSchema();
				const primaryKey = EntitySchemaHelper.getPrimaryKey(schema);

				conditions.unshift({
					property: primaryKey.property,
					comparison: ComparisonOperator.Equals,
					value: id
				});
			}

			const results = await this._entityStorage.query(
				{
					conditions,
					logicalOperator: LogicalOperator.And
				},
				undefined,
				undefined,
				undefined,
				1
			);

			entity = results.entities[0] as T;
		}

		if (Is.empty(entity)) {
			throw new NotFoundError(EntityStorageService.CLASS_NAME, "entityNotFound", id);
		}

		return entity;
	}
}
