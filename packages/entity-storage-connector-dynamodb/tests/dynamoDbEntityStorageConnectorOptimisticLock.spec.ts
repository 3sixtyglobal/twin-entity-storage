// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { ContextIdStore } from "@3sixty/context";
import { RandomHelper, StringHelper } from "@3sixty/core";
import { EntitySchemaFactory, EntitySchemaHelper, entity, property } from "@3sixty/entity";
import type { IEntityStorageConnector } from "@3sixty/entity-storage-models";
import { nameof } from "@3sixty/nameof";
import { TEST_DYNAMODB_CONFIG } from "./setupTestEnv.js";
import { DynamoDbEntityStorageConnector } from "../src/dynamoDbEntityStorageConnector.js";

// These tests are duplicated across all connectors. If you modify anything here make sure to
// apply the same change to all other connectors to keep them in sync.
// The createVersionedConnector and createUnversionedConnector factories are the only code that should differ between files.

@entity()
class VersionedEntity {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value!: string;

	@property({ type: "integer", isVersion: true, optional: true })
	public version?: number;
}

@entity()
class UnversionedEntity {
	@property({ type: "string", isPrimary: true })
	public id!: string;

	@property({ type: "string" })
	public value!: string;
}

describe("DynamoDbEntityStorageConnector Optimistic Locking", () => {
	let currentConnector: IEntityStorageConnector | undefined;

	beforeAll(async () => {
		EntitySchemaFactory.register(nameof<VersionedEntity>(), () =>
			EntitySchemaHelper.getSchema(VersionedEntity)
		);
		EntitySchemaFactory.register(nameof<UnversionedEntity>(), () =>
			EntitySchemaHelper.getSchema(UnversionedEntity)
		);

		ContextIdStore.getContextIds = vi
			.fn()
			.mockImplementation(async () => ({ node: "node", tenant: "tenant", user: "user" }));
	});

	afterEach(async () => {
		try {
			await currentConnector?.teardown?.();
		} catch {}
		try {
			await currentConnector?.stop?.();
		} catch {}
		currentConnector = undefined;
	});

	async function createVersionedConnector(): Promise<IEntityStorageConnector<VersionedEntity>> {
		currentConnector = new DynamoDbEntityStorageConnector<VersionedEntity>({
			entitySchema: nameof<VersionedEntity>(),
			config: {
				...TEST_DYNAMODB_CONFIG,
				tableName: `${TEST_DYNAMODB_CONFIG.tableName}_v_${RandomHelper.generateUuidV7("compact")}`
			}
		});
		await currentConnector?.bootstrap?.();
		return currentConnector as IEntityStorageConnector<VersionedEntity>;
	}

	async function createUnversionedConnector(): Promise<IEntityStorageConnector<UnversionedEntity>> {
		currentConnector = new DynamoDbEntityStorageConnector<UnversionedEntity>({
			entitySchema: nameof<UnversionedEntity>(),
			config: {
				...TEST_DYNAMODB_CONFIG,
				tableName: `${TEST_DYNAMODB_CONFIG.tableName}_u_${RandomHelper.generateUuidV7("compact")}`
			}
		});
		await currentConnector?.bootstrap?.();
		return currentConnector as IEntityStorageConnector<UnversionedEntity>;
	}

	describe("version initialization", () => {
		test("initializes version to 1 when field is omitted on first write", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "hello" });
			const result = await connector.get("1");
			expect(result?.version).toEqual(1);
		});

		test("initializes version to 1 when field is 0 on first write", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "hello", version: 0 });
			const result = await connector.get("1");
			expect(result?.version).toEqual(1);
		});
	});

	describe("version increment on update", () => {
		test("increments version on each successful update", async () => {
			const connector = await createVersionedConnector();

			await connector.set({ id: "1", value: "v1" });
			const after1 = await connector.get("1");
			expect(after1?.version).toEqual(1);

			await connector.set({ id: "1", value: "v2", version: after1?.version });
			const after2 = await connector.get("1");
			expect(after2?.version).toEqual(2);

			await connector.set({ id: "1", value: "v3", version: after2?.version });
			const after3 = await connector.get("1");
			expect(after3?.version).toEqual(3);
		});

		test("updated value is reflected alongside incremented version", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "original" });
			const v1 = await connector.get("1");
			await connector.set({ id: "1", value: "updated", version: v1?.version });
			const v2 = await connector.get("1");
			expect(v2?.value).toEqual("updated");
			expect(v2?.version).toEqual(2);
		});

		test("does not reset version to 1 on an unversioned write to an existing entity", async () => {
			const connector = await createVersionedConnector();

			await connector.set({ id: "1", value: "v1" });
			const after1 = await connector.get("1");
			await connector.set({ id: "1", value: "v2", version: after1?.version });
			const after2 = await connector.get("1");
			await connector.set({ id: "1", value: "v3", version: after2?.version });
			const after3 = await connector.get("1");
			expect(after3?.version).toEqual(3);

			await connector.set({ id: "1", value: "v4" });
			const after4 = await connector.get("1");
			expect(after4?.version).toEqual(4);
			expect(after4?.value).toEqual("v4");
		});
	});

	describe("conflict detection on set", () => {
		test("throws ConflictError when setting with a stale version", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "original" });
			await expect(
				connector.set({ id: "1", value: "stale-write", version: 99 })
			).rejects.toMatchObject({
				name: "ConflictError",
				message: `${StringHelper.camelCase(connector.className())}.optimisticLockFailed`
			});
		});

		test("throws ConflictError when two writers race using the same snapshot", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "original" });
			const snapshot = await connector.get("1");

			await connector.set({ id: "1", value: "winner", version: snapshot?.version });

			await expect(
				connector.set({ id: "1", value: "loser", version: snapshot?.version })
			).rejects.toMatchObject({
				name: "ConflictError",
				message: `${StringHelper.camelCase(connector.className())}.optimisticLockFailed`
			});
		});

		test("the losing write does not overwrite the winning write", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "original" });
			const snapshot = await connector.get("1");

			await connector.set({ id: "1", value: "winner", version: snapshot?.version });

			try {
				await connector.set({ id: "1", value: "loser", version: snapshot?.version });
			} catch {}

			const result = await connector.get("1");
			expect(result?.value).toEqual("winner");
			expect(result?.version).toEqual(2);
		});

		test("throws ConflictError when set conditions do not match the stored state", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "original" });
			await expect(
				connector.set({ id: "1", value: "updated" }, [{ property: "value", value: "wrong" }])
			).rejects.toMatchObject({
				name: "ConflictError",
				message: `${StringHelper.camelCase(connector.className())}.conditionFailed`
			});
		});

		test("concurrent writes with the same snapshot: exactly one succeeds", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "original" });
			const snapshot = await connector.get("1");

			const results = await Promise.allSettled([
				connector.set({ id: "1", value: "writer-a", version: snapshot?.version }),
				connector.set({ id: "1", value: "writer-b", version: snapshot?.version }),
				connector.set({ id: "1", value: "writer-c", version: snapshot?.version })
			]);

			expect(results.filter(r => r.status === "fulfilled").length).toBe(1);
			expect(results.filter(r => r.status === "rejected").length).toBe(2);

			const result = await connector.get("1");
			expect(result?.version).toBe(2);
		});

		test("succeeds and updates when set conditions match the stored state", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "original" });
			await connector.set({ id: "1", value: "updated" }, [
				{ property: "value", value: "original" }
			]);
			const result = await connector.get("1");
			expect(result?.value).toEqual("updated");
		});

		test("creates entity when conditions are provided but entity does not exist", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "new" }, [{ property: "value", value: "anything" }]);
			const result = await connector.get("1");
			expect(result?.id).toEqual("1");
			expect(result?.value).toEqual("new");
			expect(result?.version).toEqual(1);
		});
	});

	describe("conflict detection on remove", () => {
		test("throws ConflictError when remove conditions do not match the stored state", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "original" });
			await expect(
				connector.remove("1", [{ property: "value", value: "wrong" }])
			).rejects.toMatchObject({
				name: "ConflictError",
				message: `${StringHelper.camelCase(connector.className())}.conditionFailed`
			});
		});

		test("throws ConflictError when removing with a stale version condition", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "original" });
			await expect(
				connector.remove("1", [{ property: "version", value: 99 }])
			).rejects.toMatchObject({
				name: "ConflictError",
				message: `${StringHelper.camelCase(connector.className())}.conditionFailed`
			});
			const result = await connector.get("1");
			expect(result?.id).toEqual("1");
		});

		test("entity is preserved after a failed conditional remove", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "original" });
			try {
				await connector.remove("1", [{ property: "value", value: "wrong" }]);
			} catch {}
			const result = await connector.get("1");
			expect(result?.id).toEqual("1");
		});

		test("removes entity when conditions match the stored state", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "original" });
			await connector.remove("1", [{ property: "value", value: "original" }]);
			const result = await connector.get("1");
			expect(result).toBeUndefined();
		});

		test("removes entity when no conditions are provided", async () => {
			const connector = await createVersionedConnector();
			await connector.set({ id: "1", value: "original" });
			await connector.remove("1");
			const result = await connector.get("1");
			expect(result).toBeUndefined();
		});

		test("does nothing without throwing when conditions are provided for a non-existent entity", async () => {
			const connector = await createVersionedConnector();
			await connector.remove("nonexistent", [{ property: "value", value: "anything" }]);
			const result = await connector.get("nonexistent");
			expect(result).toBeUndefined();
		});
	});

	describe("entities without isVersion field are unaffected", () => {
		test("set and get work normally with no version tracking", async () => {
			const connector = await createUnversionedConnector();
			await connector.set({ id: "1", value: "hello" });
			const result = await connector.get("1");
			expect(result?.id).toEqual("1");
			expect(result?.value).toEqual("hello");
		});

		test("overwrites without conflict when no version property in schema", async () => {
			const connector = await createUnversionedConnector();
			await connector.set({ id: "1", value: "first" });
			await connector.set({ id: "1", value: "second" });
			const result = await connector.get("1");
			expect(result?.value).toEqual("second");
		});

		test("conditional remove is a silent no-op on mismatch", async () => {
			const connector = await createUnversionedConnector();
			await connector.set({ id: "1", value: "original" });
			await connector.remove("1", [{ property: "value", value: "wrong" }]);
			const result = await connector.get("1");
			expect(result?.id).toEqual("1");
		});
	});
});
