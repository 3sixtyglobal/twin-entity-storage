// Copyright 2026 IOTA Stiftung.
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
import { TEST_SCYLLA_CONFIG } from "./setupTestEnv.js";
import { ScyllaDBTableConnector } from "../src/scyllaDBTableConnector.js";

const TOTAL_ITEMS = 50;
const MATCHING_ITEMS = 10;
const PAGE_SIZE = 5;

@entity()
class ResidualTestType {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public marker!: string;
}

let connector: ScyllaDBTableConnector<ResidualTestType>;

/**
 * The ids which do not carry the skipped marker, all sorted after the ones which do.
 * @returns The ids expected to survive the client side filter.
 */
function matchingIds(): string[] {
	const ids: string[] = [];
	for (let i = TOTAL_ITEMS - MATCHING_ITEMS; i < TOTAL_ITEMS; i++) {
		ids.push(`item-${String(i).padStart(2, "0")}`);
	}
	return ids;
}

describe("ScyllaDBTableConnector residual conditions", () => {
	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<ResidualTestType>(), () =>
			EntitySchemaHelper.getSchema(ResidualTestType)
		);

		ContextIdStore.getContextIds = vi
			.fn()
			.mockReturnValue({ node: "node", tenant: "tenant", user: "user" });

		connector = new ScyllaDBTableConnector<ResidualTestType>({
			entitySchema: nameof<ResidualTestType>(),
			config: { ...TEST_SCYLLA_CONFIG, tableName: `${TEST_SCYLLA_CONFIG.tableName}_residual` }
		});
		await connector.bootstrap();

		const items: ResidualTestType[] = [];
		for (let i = 0; i < TOTAL_ITEMS; i++) {
			items.push({
				id: `item-${String(i).padStart(2, "0")}`,
				marker: i < TOTAL_ITEMS - MATCHING_ITEMS ? "skip" : "keep"
			});
		}
		await connector.setBatch(items);
	});

	afterAll(async () => {
		try {
			await connector.teardown();
		} catch {}
		try {
			await connector.stop();
		} catch {}
	});

	test("pages a NotEquals filter correctly", async () => {
		const pageSizes: number[] = [];
		const seen: string[] = [];
		let cursor: string | undefined;

		do {
			const page = await connector.query(
				{ property: "marker", value: "skip", comparison: ComparisonOperator.NotEquals },
				undefined,
				undefined,
				cursor,
				PAGE_SIZE
			);
			pageSizes.push(page.entities.length);
			for (const entityItem of page.entities) {
				seen.push(entityItem.id as string);
			}
			cursor = page.cursor;
		} while (cursor !== undefined);

		expect(pageSizes).not.toContain(0);
		expect([...seen].sort()).toEqual(matchingIds());
		expect(new Set(seen).size).toEqual(seen.length);
	});

	test("counts a NotEquals filter correctly", async () => {
		const total = await connector.count({
			property: "marker",
			value: "skip",
			comparison: ComparisonOperator.NotEquals
		});

		expect(total).toEqual(MATCHING_ITEMS);
	});
});
