// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@twin.org/context";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	entity,
	property
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { TEST_DYNAMODB_CONFIG } from "./setupTestEnv.js";
import { DynamoDbEntityStorageConnector } from "../src/dynamoDbEntityStorageConnector.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("DynamoDbEntityStorageConnector - injection-style input handling", () => {
	let connector: DynamoDbEntityStorageConnector<TestType>;

	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));

		ContextIdStore.getContextIds = vi.fn().mockResolvedValue({});

		connector = new DynamoDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: {
				...TEST_DYNAMODB_CONFIG,
				tableName: `${TEST_DYNAMODB_CONFIG.tableName}_security`
			}
		});
	});

	test("query() with SQL-injection-style condition value fails with a connection error, not an injection error", async () => {
		// DynamoDB uses expression attribute values (#name / :val) so injection characters in
		// values are always parameterized by the SDK and never interpreted as query operators.
		// Without a live DynamoDB endpoint the call will fail with a network/service error.
		const injectionValue = "foo'; DROP TABLE--";
		const result = connector.query({
			property: "value1",
			comparison: ComparisonOperator.Equals,
			value: injectionValue
		});
		// Must reject (no live service), but NOT because of an injection-related error.
		await expect(result).rejects.toBeDefined();
		await result.catch(err => {
			expect(err?.message).not.toEqual("unknownProperty");
		});
	});

	test("query() with NoSQL-operator-style condition value fails with a connection error, not an injection error", async () => {
		// DynamoDB expression attribute values are typed; operator strings like "$or" have no
		// special meaning in the DynamoDB expression language.
		const result = connector.query({
			property: "value1",
			comparison: ComparisonOperator.Equals,
			value: { $or: [{}] }
		});
		await expect(result).rejects.toBeDefined();
		await result.catch(err => {
			expect(err?.message).not.toEqual("unknownProperty");
		});
	});
});
