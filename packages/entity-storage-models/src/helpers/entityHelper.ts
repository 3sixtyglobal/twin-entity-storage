// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { Is, ObjectHelper } from "@twin.org/core";
import {
	ComparisonOperator,
	type EntityCondition,
	EntitySchemaHelper,
	type IEntitySchema
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";

/**
 * Helper class for performing schema migrations between two connectors.
 */
export class EntityHelper {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<EntityHelper>();

	/**
	 * Prepare the entity by handling undefined and null values and validating it against the schema.
	 * @param entity The entity to handle undefined and null values for.
	 * @param schema The schema to validate the entity against.
	 * @param additionalProperties Optional list of additional properties to set on the entity.
	 * @returns The entity with undefined and null values handled.
	 */
	public static prepareEntity<T>(
		entity: T,
		schema: IEntitySchema<T>,
		additionalProperties?: { property: string; value: unknown }[]
	): T {
		const entityForValidation = ObjectHelper.clone(entity);
		EntitySchemaHelper.validateEntity(entityForValidation, schema);

		if (Is.arrayValue(schema.properties)) {
			for (const property of schema.properties) {
				if (property.optional ?? false) {
					const propValue = entityForValidation[property.property];
					if (propValue === undefined) {
						ObjectHelper.propertySet(entityForValidation, property.property as string, null);
					}
				}
			}
		}

		if (Is.arrayValue(additionalProperties)) {
			for (const additionalProperty of additionalProperties) {
				ObjectHelper.propertySet(
					entityForValidation,
					additionalProperty.property,
					additionalProperty.value
				);
			}
		}

		return entityForValidation;
	}

	/**
	 * Un-prepare the entity by removing null values.
	 * @param entity The entity to handle undefined and null values for.
	 * @param removeProperties Optional list of properties to remove from the entity.
	 * @returns The entity with undefined and null values handled.
	 */
	public static unPrepareEntity<T>(entity: Partial<T> | undefined, removeProperties?: string[]): T {
		const nonNullEntity = ObjectHelper.removeEmptyProperties(entity, { removeNull: true });

		if (Is.arrayValue(removeProperties)) {
			for (const property of removeProperties) {
				ObjectHelper.propertyDelete(nonNullEntity, property);
			}
		}

		return nonNullEntity as T;
	}

	/**
	 * Deep-clone condition tree and map `undefined` to `null` on Equals/NotEquals leaves
	 * so in-memory evaluation matches stored-null semantics (optional absent props are stored as null).
	 * @param condition The user-supplied condition (not mutated).
	 * @returns A clone safe to pass to check.
	 */
	public static normalizeConditionValues<T>(condition: EntityCondition<T>): EntityCondition<T> {
		if ("conditions" in condition) {
			return {
				...condition,
				conditions: condition.conditions.map(c => EntityHelper.normalizeConditionValues(c))
			};
		}

		const leaf = condition;
		if (
			(leaf.comparison === ComparisonOperator.Equals ||
				leaf.comparison === ComparisonOperator.NotEquals) &&
			leaf.value === undefined
		) {
			return { ...leaf, value: null };
		}
		return { ...leaf };
	}
}
