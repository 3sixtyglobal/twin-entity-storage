// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { EntityStorageRestClient } from "../src/entityStorageRestClient";

describe("EntityStorageRestClient", () => {
	test("Can create an instance", async () => {
		const client = new EntityStorageRestClient({ endpoint: "http://localhost:8080" });
		expect(client).toBeDefined();
	});
});
