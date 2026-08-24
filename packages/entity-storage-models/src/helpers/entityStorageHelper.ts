// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdHelper, type IContextIds } from "@twin.org/context";
import { GeneralError, Guards, Is, ObjectHelper } from "@twin.org/core";
import {
	ComparisonOperator,
	type EntityCondition,
	EntitySchemaHelper,
	EntitySchemaPropertyType,
	type IEntitySchema,
	type SortDirection
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";

/**
 * Helper class for performing schema migrations between two connectors.
 */
export class EntityStorageHelper {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<EntityStorageHelper>();

	/**
	 * Maximum allowed length for each dot-notation path segment.
	 * @internal
	 */
	private static readonly _MAX_PATH_SEGMENT_LENGTH: number = 128;

	/**
	 * Regex matching characters/sequences disallowed in a dot-notation path segment:
	 * SQL metacharacters (single-quote, double-quote, semicolon, hash, backslash),
	 * comment sequences (double-dash, slash-star, star-slash) and ASCII control characters.
	 * @internal
	 */
	private static readonly _INVALID_PATH_SEGMENT: RegExp = /['";#\\]|--|\/\*|\*\/|[\x00-\x1F\x7F]/;

	/**
	 * Split a stored partition id into context ids when its depth matches the configured partition keys.
	 * @param partitionContextIds The configured partition context id keys.
	 * @param partitionId The stored partition id.
	 * @param separator The separator used between the partition id parts.
	 * @returns The context ids, or undefined when the partition id depth does not match.
	 */
	public static tryShortSplit(
		partitionContextIds: string[],
		partitionId: string,
		separator: string = "/"
	): IContextIds | undefined {
		Guards.arrayValue<string>(
			EntityStorageHelper.CLASS_NAME,
			nameof(partitionContextIds),
			partitionContextIds
		);
		Guards.stringValue(EntityStorageHelper.CLASS_NAME, nameof(partitionId), partitionId);

		if (partitionId.split(separator).length !== partitionContextIds.length) {
			return undefined;
		}

		return ContextIdHelper.shortSplit(partitionContextIds, partitionId, separator);
	}

	/**
	 * Prepare the entity by handling undefined and null values and validating it against the schema.
	 * @param entity The entity to handle undefined and null values for.
	 * @param schema The schema to validate the entity against.
	 * @param additionalProperties Optional list of additional properties to set on the entity.
	 * @param options Options controlling how null/undefined optional properties are stored.
	 * @param options.nullBehavior "omit" strips null/undefined optional properties before writing
	 * (NoSQL - avoids index-key type errors). "nullify" converts undefined to null (SQL - the default).
	 * @returns The entity with undefined and null values handled.
	 */
	public static prepareEntity<T>(
		entity: T,
		schema: IEntitySchema<T>,
		additionalProperties?: { property: string; value: unknown }[],
		options?: { nullBehavior?: "omit" | "nullify" }
	): T {
		const entityForValidation = ObjectHelper.clone(entity);
		EntitySchemaHelper.validateEntity(entityForValidation, schema);

		if (Is.arrayValue(schema.properties)) {
			for (const property of schema.properties) {
				if (property.optional ?? false) {
					const propValue = entityForValidation[property.property];
					if (options?.nullBehavior === "omit") {
						if (propValue === undefined || propValue === null) {
							ObjectHelper.propertyDelete(entityForValidation, property.property as string);
						}
					} else if (propValue === undefined) {
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
	 * Validate that every sort property in the list is indexed in the schema (isPrimary, isSecondary,
	 * or has a default sortDirection), throwing sortNotIndexed for the first violation found.
	 * @param schema The entity schema to validate against.
	 * @param sortProperties The sort properties to check.
	 * @throws GeneralError If a sort property is not indexed in the schema.
	 */
	public static validateSortProperties<T>(
		schema: IEntitySchema<T>,
		sortProperties?: { property: keyof T; sortDirection: SortDirection }[]
	): void {
		if (Is.arrayValue(sortProperties)) {
			for (const sortProperty of sortProperties) {
				const propertySchema = (schema.properties ?? []).find(
					p => p.property === sortProperty.property
				);
				if (
					Is.undefined(propertySchema) ||
					(!propertySchema.isPrimary &&
						!propertySchema.isSecondary &&
						Is.empty(propertySchema.sortDirection))
				) {
					throw new GeneralError(EntityStorageHelper.CLASS_NAME, "sortNotIndexed", {
						property: sortProperty.property
					});
				}
			}
		}
	}

	/**
	 * Validate that every property in the list exists in the schema, throwing propertyNotInSchema
	 * for the first property that is not found.
	 * @param schema The entity schema to validate against.
	 * @param properties The properties to check.
	 * @throws GeneralError If a property does not exist in the schema.
	 */
	public static validateProperties<T>(schema: IEntitySchema<T>, properties?: (keyof T)[]): void {
		if (Is.arrayValue(properties)) {
			for (const property of properties) {
				const propertySchema = (schema.properties ?? []).find(p => p.property === property);
				if (Is.undefined(propertySchema)) {
					throw new GeneralError(EntityStorageHelper.CLASS_NAME, "propertyNotInSchema", {
						property
					});
				}
			}
		}
	}

	/**
	 * Validate that every leaf property in an EntityCondition tree is a recognised schema property.
	 * The root part of a dot-notation path must exist in the schema and be of type object or array.
	 * @param schema The entity schema to validate against.
	 * @param condition The condition tree to validate, may be undefined.
	 * @throws GeneralError with message key "unknownPropertyInConditionProperty" if the root property is not in the schema.
	 * @throws GeneralError with message key "invalidConditionPropertyPath" if dot-notation is used on a non-object/array property.
	 */
	public static validateConditionProperties<T>(
		schema: IEntitySchema<T>,
		condition: EntityCondition<T> | undefined
	): void {
		if (Is.empty(condition)) {
			return;
		}
		if ("conditions" in condition) {
			for (const child of condition.conditions) {
				EntityStorageHelper.validateConditionProperties(schema, child);
			}
			return;
		}

		const propertyStr = String(condition.property);
		const parts = propertyStr.split(".");
		const rootPropName = parts[0];

		const rootSchema = (schema.properties ?? []).find(p => String(p.property) === rootPropName);

		if (Is.undefined(rootSchema)) {
			throw new GeneralError(EntityStorageHelper.CLASS_NAME, "unknownPropertyInConditionProperty", {
				property: condition.property
			});
		}

		if (parts.length > 1) {
			if (
				rootSchema.type !== EntitySchemaPropertyType.Object &&
				rootSchema.type !== EntitySchemaPropertyType.Array
			) {
				throw new GeneralError(EntityStorageHelper.CLASS_NAME, "invalidConditionPropertyPath", {
					property: condition.property
				});
			}
			for (const part of parts.slice(1)) {
				if (
					part.length > EntityStorageHelper._MAX_PATH_SEGMENT_LENGTH ||
					EntityStorageHelper._INVALID_PATH_SEGMENT.test(part)
				) {
					throw new GeneralError(EntityStorageHelper.CLASS_NAME, "invalidConditionPropertyPath", {
						property: condition.property
					});
				}
			}
		}
	}

	/**
	 * Validate that every property in a conditions array is a recognised schema property.
	 * @param schema The entity schema to validate against.
	 * @param conditions The conditions array to validate, may be undefined.
	 * @throws GeneralError with message key "unknownPropertyInConditions" if validation fails.
	 */
	public static validateConditions<T>(
		schema: IEntitySchema<T>,
		conditions: { property: keyof T; value: unknown }[] | undefined
	): void {
		if (!Is.arrayValue(conditions)) {
			return;
		}
		for (const condition of conditions) {
			const isInSchema = (schema.properties ?? []).some(p => p.property === condition.property);

			if (!isInSchema) {
				throw new GeneralError(EntityStorageHelper.CLASS_NAME, "unknownPropertyInConditions", {
					property: condition.property
				});
			}
		}
	}

	/**
	 * Deep-clone condition tree and normalise null/undefined to undefined on Equals/NotEquals leaves
	 * so in-memory evaluation matches stored-absent semantics (optional absent props are omitted/undefined).
	 * @param condition The user-supplied condition (not mutated).
	 * @returns A clone safe to pass to check.
	 */
	public static normalizeConditionValues<T>(condition: EntityCondition<T>): EntityCondition<T> {
		if ("conditions" in condition) {
			return {
				...condition,
				conditions: condition.conditions.map(c => EntityStorageHelper.normalizeConditionValues(c))
			};
		}

		const leaf = condition;
		if (
			(leaf.comparison === ComparisonOperator.Equals ||
				leaf.comparison === ComparisonOperator.NotEquals) &&
			(leaf.value === undefined || leaf.value === null)
		) {
			return { ...leaf, value: undefined };
		}
		return { ...leaf };
	}
}
