// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { SchemaMigrationFactory } from "../../src/factories/schemaMigrationFactory.js";
import type { ISchemaMigration } from "../../src/models/ISchemaMigration.js";

describe("SchemaMigrationFactory", () => {
	const stepKey = "SchemaMigrationFactoryTestEntity_0_1";

	const step: ISchemaMigration<{ [key: string]: unknown }> = {
		renames: [{ from: "oldField", to: "newField" }]
	};

	afterEach(() => {
		try {
			SchemaMigrationFactory.unregister(stepKey);
		} catch {
			// Already absent - ignore.
		}
	});

	test("throws for an unregistered key", () => {
		expect(() => SchemaMigrationFactory.get(stepKey)).toThrow();
	});

	test("returns undefined via getIfExists for an unregistered key", () => {
		expect(SchemaMigrationFactory.getIfExists(stepKey)).toBeUndefined();
	});

	test("returns the registered step for a known key", () => {
		SchemaMigrationFactory.register(stepKey, () => step);
		const result = SchemaMigrationFactory.get(stepKey);
		expect(result.renames).toHaveLength(1);
		expect(result.renames?.[0].from).toBe("oldField");
	});

	test("overwrites a step when the same key is registered again", () => {
		const updated: ISchemaMigration<{ [key: string]: unknown }> = {};
		SchemaMigrationFactory.register(stepKey, () => step);
		SchemaMigrationFactory.register(stepKey, () => updated);
		const result = SchemaMigrationFactory.get(stepKey);
		expect(result.renames).toBeUndefined();
	});

	test("can register separate step overrides for different version increments", () => {
		const key2 = "SchemaMigrationFactoryTestEntity_1_2";
		const step2: ISchemaMigration<{ [key: string]: unknown }> = {};
		try {
			SchemaMigrationFactory.register(stepKey, () => step);
			SchemaMigrationFactory.register(key2, () => step2);

			expect(SchemaMigrationFactory.get(stepKey).renames).toHaveLength(1);
			expect(SchemaMigrationFactory.get(key2).renames).toBeUndefined();
		} finally {
			try {
				SchemaMigrationFactory.unregister(key2);
			} catch {
				/* ignore */
			}
		}
	});
});
