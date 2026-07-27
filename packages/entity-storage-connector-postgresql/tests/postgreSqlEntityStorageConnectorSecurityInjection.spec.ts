// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	entity,
	property
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { TEST_POSTGRESQL_CONFIG } from "./setupTestEnv.js";
import { PostgreSqlEntityStorageConnector } from "../src/postgreSqlEntityStorageConnector.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("PostgreSqlEntityStorageConnector — SQL injection guard", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));
	});

	test("query() throws GeneralError for a condition property not in schema", async () => {
		const connector = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_POSTGRESQL_CONFIG
		});

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

	test("query() throws GeneralError when root of dot-notation property is not in schema", async () => {
		const connector = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_POSTGRESQL_CONFIG
		});

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

	test("query() throws GeneralError when dot-notation is used on a non-object property", async () => {
		const connector = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_POSTGRESQL_CONFIG
		});

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

	test("get() throws GeneralError for simple conditions containing an unknown property", async () => {
		const connector = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_POSTGRESQL_CONFIG
		});

		await expect(
			connector.get("some-id", undefined, [
				{ property: "__injected" as keyof TestType, value: "x" }
			])
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditions"
		});
	});

	test("remove() throws GeneralError for simple conditions containing an unknown property", async () => {
		const connector = new PostgreSqlEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: TEST_POSTGRESQL_CONFIG
		});

		await expect(
			connector.remove("some-id", [{ property: "__injected" as keyof TestType, value: "x" }])
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditions"
		});
	});
});
