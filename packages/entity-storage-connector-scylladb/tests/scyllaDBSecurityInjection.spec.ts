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
import { beforeAll, describe, expect, test } from "vitest";
import { TEST_SCYLLA_CONFIG } from "./setupTestEnv.js";
import { ScyllaDBTableConnector } from "../src/scyllaDBTableConnector.js";

@entity()
class SecurityTestEntity {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value1!: string;
}

describe("ScyllaDBTableConnector - CQL injection security", () => {
	beforeAll(() => {
		EntitySchemaFactory.register(nameof<SecurityTestEntity>(), () =>
			EntitySchemaHelper.getSchema(SecurityTestEntity)
		);
	});

	function createConnector(): ScyllaDBTableConnector<SecurityTestEntity> {
		return new ScyllaDBTableConnector<SecurityTestEntity>({
			entitySchema: nameof<SecurityTestEntity>(),
			config: {
				...TEST_SCYLLA_CONFIG,
				tableName: `${TEST_SCYLLA_CONFIG.tableName}_security`
			}
		});
	}

	test("query() with Equals on unknown property throws GeneralError with unknownProperty", async () => {
		const connector = createConnector();
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

	test("query() with Includes on unknown property throws GeneralError with unknownProperty", async () => {
		const connector = createConnector();
		await expect(
			connector.query({
				property: "__injected",
				comparison: ComparisonOperator.Includes,
				value: "x"
			})
		).rejects.toMatchObject({
			name: "GeneralError",
			message: "entityStorageHelper.unknownPropertyInConditionProperty"
		});
	});

	test("query() with Includes on known property with single-quote value does NOT throw unknownProperty", async () => {
		const connector = createConnector();
		// The value contains a single quote which would break a non-parameterized LIKE string.
		// After the fix the value is passed as a bound parameter, so the only failure here
		// should be a connection/driver error - not an "unknownProperty" validation error.
		await expect(
			connector.query({
				property: "value1",
				comparison: ComparisonOperator.Includes,
				value: "foo'bar"
			})
		).rejects.not.toMatchObject({
			message: "entityStorageHelper.unknownPropertyInConditionProperty"
		});
	});

	test("query() with Includes on known property with safe value does NOT throw unknownProperty", async () => {
		const connector = createConnector();
		// A plain value on a valid property should also only fail (if at all) due to
		// connection issues, not property-name validation.
		await expect(
			connector.query({
				property: "value1",
				comparison: ComparisonOperator.Includes,
				value: "safevalue"
			})
		).rejects.not.toMatchObject({
			message: "entityStorageHelper.unknownPropertyInConditionProperty"
		});
	});
});
