// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { Mutex, SharedStore } from "@3sixty/core";

/**
 * Helper for managing shared database client instances via SharedStore.
 * Provides a consistent acquire/release lifecycle so that one client is
 * shared across all connector instances that target the same endpoint.
 */
export class ConnectionHelper {
	/**
	 * Acquire a reference to the shared client for the given endpoint, creating
	 * it if no client exists yet. A mutex guards the read-modify-write on the
	 * SharedStore entry so concurrent callers do not race.
	 * @param storeKey The SharedStore collection key, e.g. "mongoDbClients".
	 * @param clientId The endpoint-specific cache key.
	 * @param instanceId The unique ID of the calling connector instance.
	 * @param mutexTimeoutMs Optional timeout for the mutex lock in milliseconds.
	 * @param create Factory that constructs and connects a new client.
	 * @returns The shared client.
	 */
	public static async openClient<TClient>(
		storeKey: string,
		clientId: string,
		instanceId: string,
		mutexTimeoutMs: number | undefined,
		create: () => Promise<TClient>
	): Promise<TClient> {
		const store = SharedStore.get<{ [id: string]: { client: TClient; references: string[] } }>(
			storeKey,
			() => ({})
		);
		if (!store[clientId]?.references.includes(instanceId)) {
			try {
				await Mutex.lock(`${storeKey}:${clientId}`, {
					throwOnTimeout: true,
					timeoutMs: mutexTimeoutMs
				});
				const sc = SharedStore.get<{
					[id: string]: { client: TClient; references: string[] };
				}>(storeKey, () => ({}));
				if (!sc[clientId]) {
					sc[clientId] = { client: await create(), references: [] };
					SharedStore.set(storeKey, sc);
				}
				if (!sc[clientId].references.includes(instanceId)) {
					sc[clientId].references.push(instanceId);
					SharedStore.set(storeKey, sc);
				}
			} finally {
				Mutex.unlock(`${storeKey}:${clientId}`);
			}
		}
		return SharedStore.get<{ [id: string]: { client: TClient; references: string[] } }>(
			storeKey,
			() => ({})
		)[clientId].client;
	}

	/**
	 * Release this instance's reference to the shared client. When the last
	 * reference is removed the destroy callback is called to tear down the
	 * underlying connection.
	 * @param storeKey The SharedStore collection key.
	 * @param clientId The endpoint-specific cache key.
	 * @param instanceId The unique ID of the calling connector instance.
	 * @param mutexTimeoutMs Optional timeout for the mutex lock in milliseconds.
	 * @param destroy Destructor that tears down the client when no references remain.
	 */
	public static async closeClient<TClient>(
		storeKey: string,
		clientId: string,
		instanceId: string,
		mutexTimeoutMs: number | undefined,
		destroy: (client: TClient) => Promise<void>
	): Promise<void> {
		const store = SharedStore.get<{ [id: string]: { client: TClient; references: string[] } }>(
			storeKey,
			() => ({})
		);
		if (store[clientId]?.references.includes(instanceId)) {
			try {
				await Mutex.lock(`${storeKey}:${clientId}`, {
					throwOnTimeout: true,
					timeoutMs: mutexTimeoutMs
				});
				const sc = SharedStore.get<{
					[id: string]: { client: TClient; references: string[] };
				}>(storeKey, () => ({}));
				if (sc[clientId]) {
					sc[clientId].references = sc[clientId].references.filter(id => id !== instanceId);
					if (sc[clientId].references.length === 0) {
						await destroy(sc[clientId].client);
						delete sc[clientId];
					}
					SharedStore.set(storeKey, sc);
				}
			} finally {
				Mutex.unlock(`${storeKey}:${clientId}`);
			}
		}
	}
}
