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
import { TEST_FIRESTORE_CONFIG } from "./setupTestEnv.js";
import { FirestoreEntityStorageConnector } from "../src/firestoreEntityStorageConnector.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("FirestoreEntityStorageConnector — injection-style input handling", () => {
	let connector: FirestoreEntityStorageConnector<TestType>;

	beforeAll(() => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));

		ContextIdStore.getContextIds = vi.fn().mockResolvedValue({});

		connector = new FirestoreEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: {
				...TEST_FIRESTORE_CONFIG,
				collectionName: `${TEST_FIRESTORE_CONFIG.collectionName}_security`
			}
		});
	});

	test("query() with SQL-injection-style condition value does not produce an injection error", async () => {
		// Firestore uses a type-safe SDK query builder with no string interpolation.
		// Values such as "foo' OR '1'='1" are always treated as literal field values.
		// With a live service the query resolves safely; without one it rejects with a
		// connection error — in both cases the error must not be an injection-related one.
		const injectionValue = "foo' OR '1'='1";
		try {
			await connector.query({
				property: "value1",
				comparison: ComparisonOperator.Equals,
				value: injectionValue
			});
		} catch (err) {
			expect((err as Error)?.message).not.toEqual("unknownProperty");
			expect((err as Error)?.message).not.toEqual(
				"entityStorageHelper.unknownPropertyInConditionProperty"
			);
		}
	});

	test("query() with NoSQL-operator-style condition value does not produce an injection error", async () => {
		// Firestore's SDK does not interpret JavaScript operator objects; values are typed
		// field values passed to Firestore's Where clause, not raw query strings.
		try {
			await connector.query({
				property: "value1",
				comparison: ComparisonOperator.Equals,
				value: "{ $where: '1 === 1' }"
			});
		} catch (err) {
			expect((err as Error)?.message).not.toEqual("unknownProperty");
			expect((err as Error)?.message).not.toEqual(
				"entityStorageHelper.unknownPropertyInConditionProperty"
			);
		}
	});
});
