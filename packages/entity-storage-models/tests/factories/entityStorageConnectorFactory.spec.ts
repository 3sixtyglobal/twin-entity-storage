// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { EntityStorageConnectorFactory } from "../../src/factories/entityStorageConnectorFactory.js";
import type { IEntityStorageConnector } from "../../src/models/IEntityStorageConnector.js";

describe("EntityStorageConnectorFactory", () => {
	test("can add an item to the factory", async () => {
		EntityStorageConnectorFactory.register(
			"my-entity-storage",
			() => ({}) as unknown as IEntityStorageConnector
		);
	});
});
