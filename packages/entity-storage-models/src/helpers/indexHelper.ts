// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { Converter, Is } from "@twin.org/core";
import { Blake2b } from "@twin.org/crypto";
import { type IEntitySchemaProperty, SortDirection } from "@twin.org/entity";

/**
 * Helper for generating bounded database index names.
 */
export class IndexHelper {
	/**
	 * Default maximum identifier length.
	 */
	public static readonly DEFAULT_MAX_IDENTIFIER_LENGTH: number = 63;

	/**
	 * Fixed prefix applied to every generated index name.
	 * @internal
	 */
	private static readonly _PREFIX: string = "idx_";

	/**
	 * Generate a deterministic, length-bounded index name from the table and column names.
	 * The name is derived from a blake2b-256 hash of the combined input so it always fits
	 * within the given identifier length limit regardless of table prefix or column name length.
	 * Index names are scoped per table in both MySQL and PostgreSQL, so hash collisions
	 * across different tables are not a concern.
	 * @param tableName The fully-qualified table name, including any deployment prefix.
	 * @param columnName The column being indexed.
	 * @param maxIdentifierLength The maximum identifier length allowed by the target database.
	 * @returns A deterministic index name no longer than maxIdentifierLength characters.
	 */
	public static generateName(
		tableName: string,
		columnName: string,
		maxIdentifierLength: number = IndexHelper.DEFAULT_MAX_IDENTIFIER_LENGTH
	): string {
		const input = `${tableName}_${columnName}`;
		const hash = Blake2b.sum256(Converter.utf8ToBytes(input));
		const hex = Converter.bytesToHex(hash);
		const maxHashChars = maxIdentifierLength - IndexHelper._PREFIX.length;
		return `${IndexHelper._PREFIX}${hex.slice(0, maxHashChars)}`;
	}

	/**
	 * Generate a deterministic, length-bounded index name for a composite index group.
	 * The name is derived from the group's property names and sort directions in index order,
	 * so two groups which index the same columns the same way resolve to the same name. The
	 * column list is marked with a separator which cannot appear in an entity property name, so
	 * a composite index name can never collide with a single-column index name.
	 * @param tableName The fully-qualified table name, including any deployment prefix.
	 * @param indexProperties The properties of the index group, ordered by their index position.
	 * @param maxIdentifierLength The maximum identifier length allowed by the target database.
	 * @returns A deterministic index name no longer than maxIdentifierLength characters.
	 */
	public static generateCompositeName<T>(
		tableName: string,
		indexProperties: { property: IEntitySchemaProperty<T>; direction: SortDirection }[],
		maxIdentifierLength: number = IndexHelper.DEFAULT_MAX_IDENTIFIER_LENGTH
	): string {
		const columnNames = indexProperties
			.map(
				indexProperty =>
					`${String(indexProperty.property.property)}_${indexProperty.direction ?? SortDirection.Ascending}`
			)
			.join("_");
		return IndexHelper.generateName(tableName, `#${columnNames}`, maxIdentifierLength);
	}

	/**
	 * Generate the unbounded index name used before names were hashed, so connectors can recognise their own legacy indexes.
	 * TODO: remove together with the connectors' legacy index handling.
	 * @param tableName The fully-qualified table name, including any deployment prefix.
	 * @param columnName The column being indexed.
	 * @param maxIdentifierLength Optional length the database silently truncated identifiers to.
	 * @returns The legacy index name, truncated to maxIdentifierLength when supplied.
	 */
	public static generateLegacyName(
		tableName: string,
		columnName: string,
		maxIdentifierLength?: number
	): string {
		const name = `${IndexHelper._PREFIX}${tableName}_${columnName}`;
		return Is.integer(maxIdentifierLength) ? name.slice(0, maxIdentifierLength) : name;
	}
}
