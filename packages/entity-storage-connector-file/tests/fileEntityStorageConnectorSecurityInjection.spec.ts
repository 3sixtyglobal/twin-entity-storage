// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { rm } from "node:fs/promises";
import {
	ComparisonOperator,
	EntitySchemaFactory,
	EntitySchemaHelper,
	entity,
	property
} from "@twin.org/entity";
import { nameof } from "@twin.org/nameof";
import { FileEntityStorageConnector } from "../src/fileEntityStorageConnector.js";

const TEST_DIRECTORY = "./.tmp/test-security/";

@entity()
class TestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("FileEntityStorageConnector - injection-style input handling", () => {
	let connector: FileEntityStorageConnector<TestType>;

	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<TestType>(), () => EntitySchemaHelper.getSchema(TestType));

		connector = new FileEntityStorageConnector<TestType>({
			entitySchema: nameof<TestType>(),
			config: { directory: TEST_DIRECTORY }
		});
		await connector.bootstrap();

		// Seed one entity so the store is non-empty.
		await connector.set({ id: "item1", value1: "hello" });
	});

	afterAll(async () => {
		await rm(TEST_DIRECTORY, { recursive: true, force: true });
	});

	test("query() with a SQL-injection-style condition value returns empty results safely", async () => {
		// The file connector performs in-memory filtering via EntityConditions.check();
		// there is no SQL engine involved so injection characters are inert.
		const result = await connector.query({
			property: "value1",
			comparison: ComparisonOperator.Equals,
			value: "foo'; DROP TABLE--"
		});
		expect(result.entities).toHaveLength(0);
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

	test("set() and get() round-trip a value containing special characters correctly", async () => {
		const specialValue = "foo'; DROP TABLE-- <script>alert(1)</script>";
		await connector.set({ id: "item-special", value1: specialValue });
		const retrieved = await connector.get("item-special");
		expect(retrieved).toBeDefined();
		expect(retrieved?.value1).toEqual(specialValue);
	});
});
