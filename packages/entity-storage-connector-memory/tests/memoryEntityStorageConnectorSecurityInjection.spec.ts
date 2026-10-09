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
import { MemoryEntityStorageConnector } from "../src/memoryEntityStorageConnector.js";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("MemoryEntityStorageConnector - injection-style input handling", () => {
	let connector: MemoryEntityStorageConnector<TestType>;

	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));

		connector = new MemoryEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { storageKey: "test-security-memory" }
		});
		await connector.bootstrap();

		// Seed one entity so the store is non-empty.
		await connector.set({ id: "item1", value1: "hello" });
	});

	test("query() rejects an unrecognised condition property", async () => {
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

	test("query() with a SQL-injection-style value returns empty results safely", async () => {
		// The memory connector stores values in JS objects; SQL metacharacters have no effect.
		const result = await connector.query({
			property: "value1",
			comparison: ComparisonOperator.Equals,
			value: "foo'; DROP TABLE--"
		});
		expect(result.entities).toHaveLength(0);
	});

	test("set() and get() round-trip a value containing special characters correctly", async () => {
		const specialValue = "foo'; DROP TABLE-- <script>alert(1)</script>";
		await connector.set({ id: "item-special", value1: specialValue });
		const retrieved = await connector.get("item-special");
		expect(retrieved).toBeDefined();
		expect(retrieved?.value1).toEqual(specialValue);
	});
});
