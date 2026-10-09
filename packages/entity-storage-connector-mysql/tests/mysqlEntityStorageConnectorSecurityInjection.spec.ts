// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	entity,
	property
} from "@3sixty/entity";
import { nameof } from "@3sixty/nameof";
import { TEST_MYSQL_CONFIG } from "./setupTestEnv.js";
import { MySqlEntityStorageConnector } from "../src/mysqlEntityStorageConnector.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("MySqlEntityStorageConnector - SQL injection guard", () => {
	let connector: MySqlEntityStorageConnector<TestType>;

	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));

		// No bootstrap - validation throws before any pool.query() call.
		connector = new MySqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_MYSQL_CONFIG
		});
	});

	// ── query() ─────────────────────────────────────────────────────────────

	test("query() rejects a condition property that is not in the schema", async () => {
		await expect(
			connector.query({
				property: "__injected",
				comparison: ComparisonOperator.Equals,
				value: "x"
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditionProperty"
		});
	});

	test("query() rejects a dot-notation condition whose root is not in the schema", async () => {
		await expect(
			connector.query({
				property: "__inject.field",
				comparison: ComparisonOperator.Equals,
				value: "x"
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditionProperty"
		});
	});

	test("query() rejects dot-notation on a non-object property", async () => {
		await expect(
			connector.query({
				property: "value1.subField",
				comparison: ComparisonOperator.Equals,
				value: "x"
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.invalidConditionPropertyPath"
		});
	});

	// ── get() ────────────────────────────────────────────────────────────────

	test("get() rejects a conditions array containing an unknown property", async () => {
		await expect(
			connector.get("some-id", undefined, [
				{ property: "__injected" as keyof TestType, value: "x" }
			])
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditions"
		});
	});

	// ── remove() ─────────────────────────────────────────────────────────────

	test("remove() rejects a conditions array containing an unknown property", async () => {
		await expect(
			connector.remove("some-id", [{ property: "__injected" as keyof TestType, value: "x" }])
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditions"
		});
	});
});
