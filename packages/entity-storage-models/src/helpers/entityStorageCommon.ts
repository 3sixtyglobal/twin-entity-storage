// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { Guards, Is, ObjectHelper } from "@twin.org/core";
import {
	ComparisonOperator,
	type EntityCondition,
	EntityConditions,
	EntitySchemaHelper,
	EntitySchemaPropertyType,
	EntitySorter,
	type IComparatorGroup,
	type IEntitySchema,
	type IEntitySort,
	LogicalOperator,
	SortDirection
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { EntityStorageHelper } from "./entityStorageHelper.js";
import type { IEntityStorageConnector } from "../models/IEntityStorageConnector.js";
import type { IEntityStorageJoinOptions } from "../models/IEntityStorageJoinOptions.js";

/**
 * Common entity storage operations which a connector can reuse when its own query language cannot
 * express them.
 */
export class EntityStorageCommon {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<EntityStorageCommon>();

	/**
	 * The number of entities a join returns when the caller does not supply a limit.
	 * @internal
	 */
	private static readonly _DEFAULT_JOIN_LIMIT: number = 40;

	/**
	 * The number of entities read in each page while gathering the entities attached to a page.
	 * @internal
	 */
	private static readonly _JOIN_READ_PAGE_SIZE: number = 1000;

	/**
	 * The number of values included in each In lookup, so a page of entities with a wide fan-out
	 * is still read in bounded requests.
	 * @internal
	 */
	private static readonly _JOIN_VALUE_CHUNK_SIZE: number = 500;

	/**
	 * Perform a join for a connector whose own query language cannot express one. Only the page of
	 * primary entities is read, using the storage's own paging, and the entities attached to that
	 * page are then looked up by value, so the work stays proportional to the page rather than to
	 * the size of the storage.
	 * @param connector The connector holding the primary entities.
	 * @param joinConnector The connector holding the entities to join to.
	 * @param joinOptions The join configuration.
	 * @returns The entities with their joined entities, and the next page cursor.
	 */
	public static async queryJoin<T, U>(
		connector: IEntityStorageConnector<T>,
		joinConnector: IEntityStorageConnector<U>,
		joinOptions: IEntityStorageJoinOptions<T, U>
	): Promise<{ entities: (Partial<T> & { joined: Partial<U>[] })[]; cursor?: string }> {
		Guards.object<IEntityStorageConnector<U>>(
			EntityStorageCommon.CLASS_NAME,
			nameof(joinConnector),
			joinConnector
		);

		const schema = connector.getSchema() as IEntitySchema<T>;
		const joinSchema = joinConnector.getSchema() as IEntitySchema<U>;

		EntityStorageHelper.validateJoinOptions(schema, joinSchema, joinOptions);

		const normalizedOptions = EntityStorageHelper.normalizeJoinOptions(joinOptions);
		const startCursor = EntityStorageHelper.decodeCursor<T, U, string>(
			normalizedOptions,
			joinOptions.cursor
		);

		const returnSize = joinOptions.limit ?? EntityStorageCommon._DEFAULT_JOIN_LIMIT;
		const groupProperty = joinOptions.groupProperty;
		const joinColumn = String(joinOptions.property);
		const joinedColumn = String(joinOptions.joinProperty);

		// Only what the caller asked for plus what the join itself needs is read back, and the
		// extras fall away when the projection is applied to the result.
		const primaryProjection = EntityStorageCommon.projection<T>(schema, joinOptions.properties, [
			joinOptions.property,
			...(Is.empty(groupProperty) ? [] : [groupProperty]),
			...(joinOptions.sortProperties ?? []).map(sortProperty => sortProperty.property)
		]);
		const joinedProjection = EntityStorageCommon.projection<U>(
			joinSchema,
			joinOptions.joinProperties,
			[joinOptions.joinProperty]
		);

		const page = await EntityStorageCommon.readPage(
			connector,
			joinConnector,
			joinOptions,
			primaryProjection,
			startCursor,
			returnSize
		);

		// A group gathers the joined entities of every entity it holds, so the other members of the
		// groups on the page are read as well, still bounded by the page.
		const members = Is.empty(groupProperty)
			? page.entities
			: await EntityStorageCommon.readByValues(
					connector,
					String(groupProperty),
					EntityStorageCommon.distinctValues(page.entities, String(groupProperty)),
					joinOptions.conditions,
					primaryProjection
				);

		const joined = await EntityStorageCommon.readByValues(
			joinConnector,
			joinedColumn,
			EntityStorageCommon.distinctValues(members, joinColumn),
			joinOptions.joinConditions,
			joinedProjection,
			joinOptions.joinSortProperties
		);

		const entities: (Partial<T> & { joined: Partial<U>[] })[] = [];
		for (const entity of page.entities) {
			const joinKeys = EntityStorageCommon.joinKeysFor(
				entity,
				members,
				joinColumn,
				Is.empty(groupProperty) ? undefined : String(groupProperty)
			);

			// Filtering the sorted list keeps the joined order stable, and reaches each joined
			// entity once however many entities of the group point at it.
			const matches = joined.filter(row => {
				const value = ObjectHelper.propertyGet(row, joinedColumn);
				return !Is.empty(value) && joinKeys.has(EntityStorageCommon.valueKey(value));
			});

			entities.push({
				...(Is.arrayValue(joinOptions.properties)
					? ObjectHelper.pick(entity, joinOptions.properties)
					: entity),
				joined: Is.arrayValue(joinOptions.joinProperties)
					? matches.map(match => ObjectHelper.pick(match, joinOptions.joinProperties ?? []))
					: matches.slice()
			});
		}

		return {
			entities,
			cursor: Is.stringValue(page.cursor)
				? EntityStorageHelper.encodeCursor(normalizedOptions, page.cursor)
				: undefined
		};
	}

	/**
	 * Read the page of primary entities the result stands on, using the storage's own paging. When
	 * grouping or requiring a join some entities fall away, so pages are consumed until enough
	 * survive and the page is then cut at the entity the limit falls on, asking the storage for the
	 * position which follows it so the cursor is always one the storage itself gave.
	 * @param connector The connector holding the primary entities.
	 * @param joinConnector The connector holding the entities to join to.
	 * @param joinOptions The join configuration.
	 * @param projection The properties to read back.
	 * @param startCursor The position to read from.
	 * @param returnSize The number of entities wanted.
	 * @returns The entities of the page and the position which follows them.
	 * @internal
	 */
	private static async readPage<T, U>(
		connector: IEntityStorageConnector<T>,
		joinConnector: IEntityStorageConnector<U>,
		joinOptions: IEntityStorageJoinOptions<T, U>,
		projection: (keyof T)[] | undefined,
		startCursor: string | undefined,
		returnSize: number
	): Promise<{ entities: Partial<T>[]; cursor?: string }> {
		const groupProperty = joinOptions.groupProperty;
		const narrows = !Is.empty(groupProperty) || (joinOptions.joinRequired ?? false);

		if (!narrows) {
			const page = await connector.query(
				joinOptions.conditions,
				joinOptions.sortProperties,
				projection,
				startCursor,
				returnSize
			);
			return { entities: page.entities, cursor: page.cursor };
		}

		const entities: Partial<T>[] = [];
		let pageStart = startCursor;
		const groupState = new Map<string, { representative?: string; satisfies?: boolean }>();

		while (entities.length < returnSize) {
			const page = await connector.query(
				joinOptions.conditions,
				joinOptions.sortProperties,
				projection,
				pageStart,
				EntityStorageCommon._JOIN_READ_PAGE_SIZE
			);

			if (!Is.arrayValue(page.entities)) {
				return { entities, cursor: undefined };
			}

			const keep = await EntityStorageCommon.narrowPage(
				connector,
				joinConnector,
				joinOptions,
				projection,
				page.entities,
				groupState
			);

			for (let i = 0; i < page.entities.length; i++) {
				if (keep[i]) {
					entities.push(page.entities[i]);

					if (entities.length === returnSize) {
						// The limit falls inside this page, so the storage is asked for the position
						// which follows that entity rather than the end of the whole page.
						const upTo = await connector.query(
							joinOptions.conditions,
							joinOptions.sortProperties,
							projection,
							pageStart,
							i + 1
						);
						return { entities, cursor: upTo.cursor };
					}
				}
			}

			if (!Is.stringValue(page.cursor)) {
				return { entities, cursor: undefined };
			}
			pageStart = page.cursor;
		}

		return { entities, cursor: pageStart };
	}

	/**
	 * Work out which entities of a page survive the grouping and the join requirement, keeping the
	 * decisions positional so the page can be cut at the right entity.
	 * @param connector The connector holding the primary entities.
	 * @param joinConnector The connector holding the entities to join to.
	 * @param joinOptions The join configuration.
	 * @param projection The properties to read back.
	 * @param candidates The entities read from the storage.
	 * @param groupState What is known about each group so far, carried across the pages of one call.
	 * @returns One flag for each entity, true when it survives.
	 * @internal
	 */
	private static async narrowPage<T, U>(
		connector: IEntityStorageConnector<T>,
		joinConnector: IEntityStorageConnector<U>,
		joinOptions: IEntityStorageJoinOptions<T, U>,
		projection: (keyof T)[] | undefined,
		candidates: Partial<T>[],
		groupState: Map<string, { representative?: string; satisfies?: boolean }>
	): Promise<boolean[]> {
		const keep = candidates.map(() => true);
		const groupProperty = joinOptions.groupProperty;

		if (!Is.empty(groupProperty)) {
			const standing = await EntityStorageCommon.keepGroupRepresentatives(
				connector,
				joinOptions,
				groupProperty,
				projection,
				candidates,
				groupState
			);
			for (let i = 0; i < candidates.length; i++) {
				keep[i] = keep[i] && standing[i];
			}
		}

		if (joinOptions.joinRequired ?? false) {
			const matched = await EntityStorageCommon.keepWithMatches(
				joinConnector,
				joinOptions,
				candidates
			);
			for (let i = 0; i < candidates.length; i++) {
				keep[i] = keep[i] && matched[i];
			}
		}

		return keep;
	}

	/**
	 * Keep only the entities which stand for their group, which is the first entity of the group in
	 * the sort order, and whose group holds an entity matching each group condition. The members of
	 * the groups on the page are read once and both answers come from them, so a later member of a
	 * group already accounted for is recognised without anything being held in the cursor.
	 * @param connector The connector holding the primary entities.
	 * @param joinOptions The join configuration.
	 * @param groupProperty The property the entities are grouped by.
	 * @param projection The properties to read back.
	 * @param candidates The entities read from the storage.
	 * @param groupState What is known about each group so far, carried across the pages of one call.
	 * @returns One flag for each entity, true when it stands for its group.
	 * @internal
	 */
	private static async keepGroupRepresentatives<T, U>(
		connector: IEntityStorageConnector<T>,
		joinOptions: IEntityStorageJoinOptions<T, U>,
		groupProperty: keyof T,
		projection: (keyof T)[] | undefined,
		candidates: Partial<T>[],
		groupState: Map<string, { representative?: string; satisfies?: boolean }>
	): Promise<boolean[]> {
		const schema = connector.getSchema() as IEntitySchema<T>;
		const groupColumn = String(groupProperty);
		const primaryKey = String(EntitySchemaHelper.getPrimaryKey<T>(schema).property);

		const unknownValues = EntityStorageCommon.distinctValues(candidates, groupColumn).filter(
			value => !groupState.has(EntityStorageCommon.valueKey(value))
		);

		if (unknownValues.length > 0) {
			// The members are ordered here rather than by the storage, because a storage which
			// cannot sort by the property being grouped on would refuse the request.
			const members = EntityStorageCommon.sortEntities(
				schema,
				await EntityStorageCommon.readByValues(
					connector,
					groupColumn,
					unknownValues,
					joinOptions.conditions,
					projection
				),
				joinOptions.sortProperties
			);

			for (const value of unknownValues) {
				groupState.set(EntityStorageCommon.valueKey(value), {});
			}

			for (const member of members) {
				const groupValue = ObjectHelper.propertyGet(member, groupColumn);
				const state = Is.empty(groupValue)
					? undefined
					: groupState.get(EntityStorageCommon.valueKey(groupValue));

				// The members are in the sort order, so the first one seen for a group is the one
				// the group stands on.
				if (!Is.undefined(state) && Is.undefined(state.representative)) {
					const memberId = ObjectHelper.propertyGet<string>(member, primaryKey);
					if (!Is.empty(memberId)) {
						state.representative = EntityStorageCommon.valueKey(memberId);
					}
				}
			}

			EntityStorageCommon.applyGroupConditions(joinOptions, groupColumn, members, groupState);
		}

		return candidates.map(candidate => {
			const groupValue = ObjectHelper.propertyGet(candidate, groupColumn);
			if (Is.empty(groupValue)) {
				return false;
			}

			const state = groupState.get(EntityStorageCommon.valueKey(groupValue));
			if (Is.undefined(state) || Is.empty(state.representative) || state.satisfies === false) {
				return false;
			}

			const candidateId = ObjectHelper.propertyGet(candidate, primaryKey);
			return state.representative === EntityStorageCommon.valueKey(candidateId);
		});
	}

	/**
	 * Record which groups hold an entity matching each of the group conditions.
	 * @param joinOptions The join configuration.
	 * @param groupColumn The property the entities are grouped by.
	 * @param members The entities of the groups being decided.
	 * @param groupState What is known about each group so far.
	 * @internal
	 */
	private static applyGroupConditions<T, U>(
		joinOptions: IEntityStorageJoinOptions<T, U>,
		groupColumn: string,
		members: Partial<T>[],
		groupState: Map<string, { representative?: string; satisfies?: boolean }>
	): void {
		if (!Is.arrayValue(joinOptions.groupConditions)) {
			return;
		}

		const met = new Map<string, number>();
		for (const groupCondition of joinOptions.groupConditions) {
			const normalised = EntityStorageHelper.normalizeConditionValues(groupCondition);
			const matched = new Set<string>();
			for (const member of members) {
				const groupValue = ObjectHelper.propertyGet(member, groupColumn);
				if (!Is.empty(groupValue) && EntityConditions.check(member, normalised)) {
					matched.add(EntityStorageCommon.valueKey(groupValue));
				}
			}
			for (const groupKey of matched) {
				met.set(groupKey, (met.get(groupKey) ?? 0) + 1);
			}
		}

		const required = joinOptions.groupConditions.length;
		for (const [groupKey, state] of groupState) {
			if (Is.undefined(state.satisfies)) {
				state.satisfies = (met.get(groupKey) ?? 0) === required;
			}
		}
	}

	/**
	 * Keep only the entities which have at least one joined entity, looking the whole page up in
	 * one request rather than one for each entity.
	 * @param joinConnector The connector holding the entities to join to.
	 * @param joinOptions The join configuration.
	 * @param candidates The entities read from the storage.
	 * @returns One flag for each entity, true when it has a joined entity.
	 * @internal
	 */
	private static async keepWithMatches<T, U>(
		joinConnector: IEntityStorageConnector<U>,
		joinOptions: IEntityStorageJoinOptions<T, U>,
		candidates: Partial<T>[]
	): Promise<boolean[]> {
		const joinColumn = String(joinOptions.property);
		const joinedColumn = String(joinOptions.joinProperty);

		const matched = await EntityStorageCommon.readByValues(
			joinConnector,
			joinedColumn,
			EntityStorageCommon.distinctValues(candidates, joinColumn),
			joinOptions.joinConditions,
			// Read whole entities rather than just the join property, because not every storage
			// accepts a projection which holds nothing but the column being matched.
			undefined
		);

		const matchedKeys = new Set<string>();
		for (const row of matched) {
			const value = ObjectHelper.propertyGet(row, joinedColumn);
			if (!Is.empty(value)) {
				matchedKeys.add(EntityStorageCommon.valueKey(value));
			}
		}

		return candidates.map(candidate => {
			const value = ObjectHelper.propertyGet(candidate, joinColumn);
			return !Is.empty(value) && matchedKeys.has(EntityStorageCommon.valueKey(value));
		});
	}

	/**
	 * Read every entity whose property holds one of the values, in chunks so a wide fan-out is
	 * still read in bounded requests.
	 * @param connector The connector to read from.
	 * @param property The property to match against the values.
	 * @param values The values to match.
	 * @param conditions The optional conditions the entities must also match.
	 * @param properties The properties to read back.
	 * @param sortProperties The optional sort order.
	 * @returns The matching entities.
	 * @internal
	 */
	private static async readByValues<E>(
		connector: IEntityStorageConnector<E>,
		property: string,
		values: unknown[],
		conditions: EntityCondition<E> | undefined,
		properties: (keyof E)[] | undefined,
		sortProperties?: { property: keyof E; sortDirection: SortDirection }[]
	): Promise<Partial<E>[]> {
		const entities: Partial<E>[] = [];

		// An In list only reads back as one for the primitive types, and not every storage accepts
		// an Or, so anything else is asked for one value at a time.
		const scalar = values.every(value => Is.string(value) || Is.number(value) || Is.boolean(value));
		const chunkSize = scalar ? EntityStorageCommon._JOIN_VALUE_CHUNK_SIZE : 1;

		for (let i = 0; i < values.length; i += chunkSize) {
			const chunk = values.slice(i, i + chunkSize);
			const chunkConditions = EntityStorageCommon.and<E>(
				conditions,
				scalar
					? { property, comparison: ComparisonOperator.In, value: chunk }
					: { property, comparison: ComparisonOperator.Equals, value: chunk[0] }
			);

			let cursor: string | undefined;
			do {
				const page = await connector.query(
					chunkConditions,
					sortProperties,
					properties,
					cursor,
					EntityStorageCommon._JOIN_READ_PAGE_SIZE
				);
				entities.push(...page.entities);
				cursor = Is.arrayValue(page.entities) ? page.cursor : undefined;
			} while (Is.stringValue(cursor));
		}

		return entities;
	}

	/**
	 * Work out which joined entities an entity reaches, which for a group is everything the whole
	 * group reaches.
	 * @param entity The entity standing for the result.
	 * @param members The entities of the groups on the page, or the page itself when not grouping.
	 * @param joinColumn The property holding the value to join from.
	 * @param groupColumn The property the entities are grouped by, absent when not grouping.
	 * @returns The keys of the joined entities to attach.
	 * @internal
	 */
	private static joinKeysFor<T>(
		entity: Partial<T>,
		members: Partial<T>[],
		joinColumn: string,
		groupColumn: string | undefined
	): Set<string> {
		const keys = new Set<string>();

		if (Is.empty(groupColumn)) {
			const value = ObjectHelper.propertyGet(entity, joinColumn);
			if (!Is.empty(value)) {
				keys.add(EntityStorageCommon.valueKey(value));
			}
			return keys;
		}

		const groupValue = ObjectHelper.propertyGet(entity, groupColumn);
		if (Is.empty(groupValue)) {
			return keys;
		}
		const groupKey = EntityStorageCommon.valueKey(groupValue);

		for (const member of members) {
			const memberGroup = ObjectHelper.propertyGet(member, groupColumn);
			if (!Is.empty(memberGroup) && EntityStorageCommon.valueKey(memberGroup) === groupKey) {
				const value = ObjectHelper.propertyGet(member, joinColumn);
				if (!Is.empty(value)) {
					keys.add(EntityStorageCommon.valueKey(value));
				}
			}
		}

		return keys;
	}

	/**
	 * Collect the distinct values a property holds across a list of entities.
	 * @param entities The entities to read from.
	 * @param property The property to read.
	 * @returns The distinct values.
	 * @internal
	 */
	private static distinctValues<E>(entities: Partial<E>[], property: string): unknown[] {
		const values: unknown[] = [];
		const seen = new Set<string>();

		for (const entity of entities) {
			const value = ObjectHelper.propertyGet(entity, property);
			if (!Is.empty(value)) {
				const key = EntityStorageCommon.valueKey(value);
				if (!seen.has(key)) {
					seen.add(key);
					values.push(value);
				}
			}
		}

		return values;
	}

	/**
	 * Work out which properties to read back. Nothing is narrowed when the caller wants everything,
	 * otherwise what they asked for is widened with what the join itself needs.
	 * @param schema The schema of the entities being read.
	 * @param properties The properties the caller asked for.
	 * @param required The properties the join needs whatever the caller asked for.
	 * @returns The properties to read, or undefined to read them all.
	 * @internal
	 */
	private static projection<E>(
		schema: IEntitySchema<E>,
		properties: (keyof E)[] | undefined,
		required: (keyof E)[]
	): (keyof E)[] | undefined {
		if (!Is.arrayValue(properties)) {
			return undefined;
		}

		const known = new Set((schema.properties ?? []).map(property => String(property.property)));
		const wanted: (keyof E)[] = [...properties];

		for (const property of [...required, EntitySchemaHelper.getPrimaryKey<E>(schema).property]) {
			if (
				known.has(String(property)) &&
				!wanted.some(existing => String(existing) === String(property))
			) {
				wanted.push(property);
			}
		}

		return wanted;
	}

	/**
	 * Put entities in the sort order the caller asked for, ending with the primary key so the order
	 * is total.
	 * @param schema The schema of the entities.
	 * @param entities The entities to order.
	 * @param sortProperties The optional sort order.
	 * @returns The ordered entities.
	 * @internal
	 */
	private static sortEntities<E>(
		schema: IEntitySchema<E>,
		entities: Partial<E>[],
		sortProperties: { property: keyof E; sortDirection: SortDirection }[] | undefined
	): Partial<E>[] {
		const sorters: IEntitySort<Partial<E>>[] = [];

		const typeOf = (property: keyof E): EntitySchemaPropertyType =>
			(schema.properties ?? []).find(p => p.property === property)?.type ??
			EntitySchemaPropertyType.String;

		for (const sortProperty of sortProperties ?? []) {
			sorters.push({
				property: sortProperty.property,
				sortDirection: sortProperty.sortDirection,
				type: typeOf(sortProperty.property)
			});
		}

		const primaryKey = EntitySchemaHelper.getPrimaryKey<E>(schema);
		if (!sorters.some(sorter => sorter.property === primaryKey.property)) {
			sorters.push({
				property: primaryKey.property,
				sortDirection: SortDirection.Ascending,
				type: primaryKey.type
			});
		}

		return EntitySorter.sort(entities.slice(), sorters);
	}

	/**
	 * Combine conditions which must all hold.
	 * @param conditions The conditions to combine, any of which can be absent.
	 * @returns The combined condition.
	 * @internal
	 */
	private static and<E>(
		...conditions: (EntityCondition<E> | undefined)[]
	): EntityCondition<E> | undefined {
		const present = conditions.filter(
			(condition): condition is EntityCondition<E> => !Is.empty(condition)
		);

		if (present.length === 0) {
			return undefined;
		}
		if (present.length === 1) {
			return present[0];
		}

		const group: IComparatorGroup<E> = {
			conditions: present,
			logicalOperator: LogicalOperator.And
		};
		return group;
	}

	/**
	 * Turn a value into a key which can be compared between the two sides of a join.
	 * @param value The value read from the storage.
	 * @returns The key for the value.
	 * @internal
	 */
	private static valueKey(value: unknown): string {
		return Is.string(value) ? value : JSON.stringify(value);
	}
}
