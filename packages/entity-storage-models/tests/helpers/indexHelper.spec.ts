// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { type IEntitySchemaProperty, SortDirection } from "@3sixty/entity";
import { IndexHelper } from "../../src/helpers/indexHelper.js";

/**
 * Build the index group entry for a property and direction.
 * @param property The property name.
 * @param direction The sort direction within the index.
 * @returns The index group entry.
 */
function indexProperty(
	property: string,
	direction: SortDirection
): { property: IEntitySchemaProperty<{ [key: string]: unknown }>; direction: SortDirection } {
	return { property: { property, type: "string" }, direction };
}

describe("IndexHelper.generateName", () => {
	test("output length is within the 63-character limit using the default", () => {
		const name = IndexHelper.generateName("some_table", "someColumn");
		expect(name.length).toBeLessThanOrEqual(IndexHelper.DEFAULT_MAX_IDENTIFIER_LENGTH);
		expect(IndexHelper.DEFAULT_MAX_IDENTIFIER_LENGTH).toBe(63);
	});

	test("respects a custom maxIdentifierLength", () => {
		const name = IndexHelper.generateName("some_table", "someColumn", 64);
		expect(name.length).toBeLessThanOrEqual(64);
	});

	test("output always starts with idx_", () => {
		const name = IndexHelper.generateName("t", "c");
		expect(name.startsWith("idx_")).toBe(true);
	});

	test("is deterministic same inputs always produce the same name", () => {
		const a = IndexHelper.generateName("my_table", "my_column");
		const b = IndexHelper.generateName("my_table", "my_column");
		expect(a).toBe(b);
	});

	test("different inputs produce different names", () => {
		const a = IndexHelper.generateName("my_table", "col_a");
		const b = IndexHelper.generateName("my_table", "col_b");
		expect(a).not.toBe(b);
	});

	test("long table prefix + long table name + long column stays within limits", () => {
		const name = IndexHelper.generateName(
			"aaaaaaaaaaaaaaaaaa-auditable-item-graph-vertex",
			"dateCreated"
		);
		expect(name.length).toBeLessThanOrEqual(63);
		expect(name.length).toBeLessThanOrEqual(64);
	});

	test("extremely long inputs still produce a bounded name", () => {
		const table = "a".repeat(200);
		const column = "b".repeat(200);
		const name = IndexHelper.generateName(table, column);
		expect(name.length).toBeLessThanOrEqual(63);
	});
});

describe("IndexHelper.generateLegacyName", () => {
	test("produces the pre-hash idx_table_column name", () => {
		expect(IndexHelper.generateLegacyName("my_table", "my_column")).toBe("idx_my_table_my_column");
	});

	test("truncates to maxIdentifierLength when supplied", () => {
		const table = "a".repeat(80);
		const name = IndexHelper.generateLegacyName(table, "dateCreated", 63);
		expect(name).toBe(`idx_${table}_dateCreated`.slice(0, 63));
		expect(name.length).toBe(63);
	});

	test("does not truncate when maxIdentifierLength is omitted", () => {
		const table = "a".repeat(80);
		expect(IndexHelper.generateLegacyName(table, "dateCreated")).toBe(`idx_${table}_dateCreated`);
	});
});

describe("IndexHelper.generateCompositeName", () => {
	test("output length is within the 63-character limit using the default", () => {
		const name = IndexHelper.generateCompositeName("some_table", [
			indexProperty("category", SortDirection.Ascending),
			indexProperty("status", SortDirection.Descending)
		]);
		expect(name.length).toBeLessThanOrEqual(IndexHelper.DEFAULT_MAX_IDENTIFIER_LENGTH);
	});

	test("respects a custom maxIdentifierLength", () => {
		const name = IndexHelper.generateCompositeName(
			"some_table",
			[indexProperty("category", SortDirection.Ascending)],
			30
		);
		expect(name.length).toBeLessThanOrEqual(30);
	});

	test("output always starts with idx_", () => {
		const name = IndexHelper.generateCompositeName("t", [
			indexProperty("c", SortDirection.Ascending)
		]);
		expect(name.startsWith("idx_")).toBe(true);
	});

	test("is deterministic same inputs always produce the same name", () => {
		const columns = [
			indexProperty("category", SortDirection.Ascending),
			indexProperty("status", SortDirection.Descending)
		];
		expect(IndexHelper.generateCompositeName("my_table", columns)).toBe(
			IndexHelper.generateCompositeName("my_table", columns)
		);
	});

	test("the same columns in a different order produce different names", () => {
		const a = IndexHelper.generateCompositeName("my_table", [
			indexProperty("category", SortDirection.Ascending),
			indexProperty("status", SortDirection.Ascending)
		]);
		const b = IndexHelper.generateCompositeName("my_table", [
			indexProperty("status", SortDirection.Ascending),
			indexProperty("category", SortDirection.Ascending)
		]);
		expect(a).not.toBe(b);
	});

	test("the same columns with different directions produce different names", () => {
		const a = IndexHelper.generateCompositeName("my_table", [
			indexProperty("category", SortDirection.Ascending),
			indexProperty("status", SortDirection.Ascending)
		]);
		const b = IndexHelper.generateCompositeName("my_table", [
			indexProperty("category", SortDirection.Ascending),
			indexProperty("status", SortDirection.Descending)
		]);
		expect(a).not.toBe(b);
	});

	test("the same columns on different tables produce different names", () => {
		const columns = [
			indexProperty("category", SortDirection.Ascending),
			indexProperty("status", SortDirection.Ascending)
		];
		expect(IndexHelper.generateCompositeName("table_a", columns)).not.toBe(
			IndexHelper.generateCompositeName("table_b", columns)
		);
	});

	test("the group name has no bearing on the generated name", () => {
		// Two groups which index the same columns the same way resolve to the same index.
		const columns = [
			indexProperty("category", SortDirection.Ascending),
			indexProperty("status", SortDirection.Descending)
		];
		expect(IndexHelper.generateCompositeName("my_table", columns)).toBe(
			IndexHelper.generateCompositeName("my_table", [
				indexProperty("category", SortDirection.Ascending),
				indexProperty("status", SortDirection.Descending)
			])
		);
	});

	test("never collides with the single-column name built from the same column list", () => {
		const composite = IndexHelper.generateCompositeName("my_table", [
			indexProperty("category", SortDirection.Ascending)
		]);
		const single = IndexHelper.generateName("my_table", "category_asc");
		expect(composite).not.toBe(single);
	});

	test("extremely long inputs still produce a bounded name", () => {
		const name = IndexHelper.generateCompositeName("a".repeat(200), [
			indexProperty("b".repeat(200), SortDirection.Ascending),
			indexProperty("c".repeat(200), SortDirection.Descending)
		]);
		expect(name.length).toBeLessThanOrEqual(63);
	});
});
