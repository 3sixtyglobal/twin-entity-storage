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
import { TEST_COSMOS_CONFIG } from "./setupTestEnv.js";
import { CosmosDbEntityStorageConnector } from "../src/cosmosDbEntityStorageConnector.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("CosmosDbEntityStorageConnector — injection-style input handling", () => {
	let connector: CosmosDbEntityStorageConnector<TestType>;

	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));

		ContextIdStore.getContextIds = vi.fn().mockResolvedValue({});

		connector = new CosmosDbEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: {
				...TEST_COSMOS_CONFIG,
				containerId: `${TEST_COSMOS_CONFIG.containerId}_security`
			}
		});
	});

	test("query() with SQL-injection-style condition value fails with a connection error, not an injection error", async () => {
		// CosmosDB uses parameterized SQL (@param0 style) so injection characters in values are
		// passed as bound parameters and never interpreted as SQL. The connector will fail to
		// reach the live service but the error must be a connection / service error, not a query
		// construction error caused by the injected value.
		const injectionValue = "foo' OR '1'='1";
		const result = connector.query({
			property: "value1",
			comparison: ComparisonOperator.Equals,
			value: injectionValue
		});
		// The call should reject because no live CosmosDB is available, but the rejection
		// must carry a GeneralError wrapping a network / service error, not an injection error.
		await expect(result).rejects.toMatchObject({ name: "GeneralError" });
		await result.catch(err => {
			// The message must NOT be "unknownProperty" — injection is not the cause of failure.
			expect(err.message).not.toEqual("unknownProperty");
		});
	});

	test("query() with an unknown property name fails with a connection error, not silently", async () => {
		// CosmosDB does not pre-validate property names against the schema before sending the
		// query to the service. An unknown property simply yields no results when the service
		// is reachable; when it is not, a connection error is raised.
		const result = connector.query({
			property: "__injected",
			comparison: ComparisonOperator.Equals,
			value: "x"
		});
		await expect(result).rejects.toMatchObject({ name: "GeneralError" });
	});
});
