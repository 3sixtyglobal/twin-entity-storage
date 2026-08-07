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
import { TEST_MONGODB_CONFIG } from "./setupTestEnv.js";
import { MongoDbEntityStorageConnector } from "../src/mongoDbEntityStorageConnector.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("MongoDbEntityStorageConnector - NoSQL injection prevention", () => {
	let connector: MongoDbEntityStorageConnector<TestType>;

	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));

		connector = new MongoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: {
				...TEST_MONGODB_CONFIG,
				collection: `${TEST_MONGODB_CONFIG.collection}_security`
			}
		});
	});

	test("query() rejects a condition with an unknown property", async () => {
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

	test("query() rejects a condition whose property name starts with $ (operator injection)", async () => {
		await expect(
			connector.query({
				property: "$where",
				comparison: ComparisonOperator.Equals,
				value: "1 === 1"
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditionProperty"
		});
	});

	test("query() rejects a dot-notation condition where the root property is unknown", async () => {
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

	test("get() rejects simple conditions containing an unknown property", async () => {
		await expect(
			connector.get("some-id", undefined, [
				{ property: "__injected" as keyof TestType, value: "x" }
			])
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditions"
		});
	});

	test("remove() rejects simple conditions containing an unknown property", async () => {
		await expect(
			connector.remove("some-id", [{ property: "__injected" as keyof TestType, value: "x" }])
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditions"
		});
	});
});
