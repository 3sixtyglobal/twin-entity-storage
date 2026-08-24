// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { SharedStore } from "@twin.org/core";
import { ConnectionHelper } from "../../src/helpers/connectionHelper.js";

const STORE_KEY = "connectionHelperTests";
const CLIENT_ID = "host|5432|user";
const INSTANCE_A = "instance-a";
const INSTANCE_B = "instance-b";

beforeEach(() => {
	SharedStore.set(STORE_KEY, {});
});

describe("ConnectionHelper.openClient", () => {
	test("calls create once and returns the client", async () => {
		const mockClient = { id: "c1" };
		const create = vi.fn().mockResolvedValue(mockClient);

		const result = await ConnectionHelper.openClient(
			STORE_KEY,
			CLIENT_ID,
			INSTANCE_A,
			undefined,
			create
		);

		expect(create).toHaveBeenCalledOnce();
		expect(result).toBe(mockClient);
	});

	test("does not call create again on repeated calls from the same instance", async () => {
		const create = vi.fn().mockResolvedValue({ id: "c1" });

		const first = await ConnectionHelper.openClient(
			STORE_KEY,
			CLIENT_ID,
			INSTANCE_A,
			undefined,
			create
		);
		const second = await ConnectionHelper.openClient(
			STORE_KEY,
			CLIENT_ID,
			INSTANCE_A,
			undefined,
			create
		);

		expect(create).toHaveBeenCalledOnce();
		expect(first).toBe(second);
	});

	test("shares one client across two different instances", async () => {
		const create = vi.fn().mockResolvedValue({ id: "c1" });

		const a = await ConnectionHelper.openClient(
			STORE_KEY,
			CLIENT_ID,
			INSTANCE_A,
			undefined,
			create
		);
		const b = await ConnectionHelper.openClient(
			STORE_KEY,
			CLIENT_ID,
			INSTANCE_B,
			undefined,
			create
		);

		expect(create).toHaveBeenCalledOnce();
		expect(a).toBe(b);
	});

	test("creates separate clients for different clientIds", async () => {
		const clientA = { id: "a" };
		const clientB = { id: "b" };
		const create = vi.fn().mockResolvedValueOnce(clientA).mockResolvedValueOnce(clientB);

		const a = await ConnectionHelper.openClient(
			STORE_KEY,
			"endpoint-a",
			INSTANCE_A,
			undefined,
			create
		);
		const b = await ConnectionHelper.openClient(
			STORE_KEY,
			"endpoint-b",
			INSTANCE_A,
			undefined,
			create
		);

		expect(create).toHaveBeenCalledTimes(2);
		expect(a).toBe(clientA);
		expect(b).toBe(clientB);
	});

	test("propagates error from create and leaves store empty", async () => {
		const create = vi.fn().mockRejectedValue(new Error("connection refused"));

		await expect(
			ConnectionHelper.openClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, create)
		).rejects.toThrow("connection refused");

		const store = SharedStore.get<{ [id: string]: unknown }>(STORE_KEY, () => ({}));
		expect(store[CLIENT_ID]).toBeUndefined();
	});
});

describe("ConnectionHelper.closeClient", () => {
	test("calls destroy with the client when the last reference is released", async () => {
		const mockClient = { id: "c1" };
		const create = vi.fn().mockResolvedValue(mockClient);
		const destroy = vi.fn().mockResolvedValue(undefined);

		await ConnectionHelper.openClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, create);
		await ConnectionHelper.closeClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, destroy);

		expect(destroy).toHaveBeenCalledOnce();
		expect(destroy).toHaveBeenCalledWith(mockClient);
	});

	test("does not call destroy while another instance holds a reference", async () => {
		const create = vi.fn().mockResolvedValue({ id: "c1" });
		const destroy = vi.fn().mockResolvedValue(undefined);

		await ConnectionHelper.openClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, create);
		await ConnectionHelper.openClient(STORE_KEY, CLIENT_ID, INSTANCE_B, undefined, create);
		await ConnectionHelper.closeClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, destroy);

		expect(destroy).not.toHaveBeenCalled();
	});

	test("calls destroy exactly once after both references are released", async () => {
		const mockClient = { id: "c1" };
		const create = vi.fn().mockResolvedValue(mockClient);
		const destroy = vi.fn().mockResolvedValue(undefined);

		await ConnectionHelper.openClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, create);
		await ConnectionHelper.openClient(STORE_KEY, CLIENT_ID, INSTANCE_B, undefined, create);
		await ConnectionHelper.closeClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, destroy);
		await ConnectionHelper.closeClient(STORE_KEY, CLIENT_ID, INSTANCE_B, undefined, destroy);

		expect(destroy).toHaveBeenCalledOnce();
		expect(destroy).toHaveBeenCalledWith(mockClient);
	});

	test("is a no-op when the instance never called openClient", async () => {
		const destroy = vi.fn().mockResolvedValue(undefined);

		await ConnectionHelper.closeClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, destroy);

		expect(destroy).not.toHaveBeenCalled();
	});

	test("removes the store entry after the last reference is closed", async () => {
		const create = vi.fn().mockResolvedValue({ id: "c1" });
		const destroy = vi.fn().mockResolvedValue(undefined);

		await ConnectionHelper.openClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, create);
		await ConnectionHelper.closeClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, destroy);

		const store = SharedStore.get<{ [id: string]: unknown }>(STORE_KEY, () => ({}));
		expect(store[CLIENT_ID]).toBeUndefined();
	});
});

describe("ConnectionHelper open/close lifecycle", () => {
	test("reopening after full close creates a fresh client", async () => {
		const firstClient = { id: "first" };
		const secondClient = { id: "second" };
		const create = vi.fn().mockResolvedValueOnce(firstClient).mockResolvedValueOnce(secondClient);
		const destroy = vi.fn().mockResolvedValue(undefined);

		await ConnectionHelper.openClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, create);
		await ConnectionHelper.closeClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, destroy);
		const result = await ConnectionHelper.openClient(
			STORE_KEY,
			CLIENT_ID,
			INSTANCE_A,
			undefined,
			create
		);

		expect(create).toHaveBeenCalledTimes(2);
		expect(result).toBe(secondClient);
	});

	test("closing an already-closed instance a second time is a no-op", async () => {
		const create = vi.fn().mockResolvedValue({ id: "c1" });
		const destroy = vi.fn().mockResolvedValue(undefined);

		await ConnectionHelper.openClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, create);
		await ConnectionHelper.closeClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, destroy);
		await ConnectionHelper.closeClient(STORE_KEY, CLIENT_ID, INSTANCE_A, undefined, destroy);

		expect(destroy).toHaveBeenCalledOnce();
	});
});
