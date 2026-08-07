// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { HeaderTypes, HttpStatusCode, MimeTypes } from "@twin.org/web";

/**
 * Minimal 204 No-Content response accepted by BaseRestClient.
 * Use for operations that return void.
 * @returns A fake 204 response object.
 */
export function noContentResponse(): object {
	return {
		ok: true,
		status: HttpStatusCode.noContent,
		headers: new Headers()
	};
}

/**
 * Minimal 200 OK JSON response accepted by BaseRestClient.
 * @param jsonBody The value returned by response.json() - this becomes response.body in the client.
 * @returns A fake 200 JSON response object.
 */
export function jsonResponse(jsonBody: unknown): object {
	return {
		ok: true,
		status: HttpStatusCode.ok,
		headers: new Headers({ [HeaderTypes.ContentType]: MimeTypes.Json }),
		json: async () => jsonBody
	};
}

/**
 * Minimal 200 OK plain-text response accepted by BaseRestClient.
 * @param text The value returned by response.text() - this becomes response.body in the client.
 * @returns A fake 200 plain-text response object.
 */
export function textResponse(text: string): object {
	return {
		ok: true,
		status: HttpStatusCode.ok,
		headers: new Headers({ [HeaderTypes.ContentType]: MimeTypes.PlainText }),
		text: async () => text
	};
}

/**
 * Minimal 200 OK binary response accepted by BaseRestClient.
 * Body is stored as Uint8Array; an empty buffer causes body to be undefined.
 * @param data The bytes to return via response.arrayBuffer().
 * @returns A fake 200 binary response object.
 */
export function binaryResponse(data: Uint8Array): object {
	return {
		ok: true,
		status: HttpStatusCode.ok,
		headers: new Headers(),
		arrayBuffer: async () => data.buffer as ArrayBuffer
	};
}

/**
 * Minimal 201 Created response accepted by BaseRestClient.
 * The location is surfaced as response.headers[HeaderTypes.Location] in the client.
 * @param location The value to set in the Location header.
 * @returns A fake 201 Created response object.
 */
export function createdResponse(location: string): object {
	return {
		ok: true,
		status: HttpStatusCode.created,
		headers: new Headers({ [HeaderTypes.Location]: location }),
		arrayBuffer: async () => new ArrayBuffer(0)
	};
}

/**
 * Assigns the given mock as the global fetch implementation.
 * Call in beforeEach alongside any client construction.
 * @param mock The vi.fn() mock to install as globalThis.fetch.
 */
export function setupFetchMock(mock: object): void {
	globalThis.fetch = mock as typeof fetch;
}

/**
 * Resets the mock and removes it as the global fetch.
 * Call in afterEach to prevent state leaking between tests.
 * @param mock The same mock passed to setupFetchMock.
 * @param mock.mockReset Vitest method that clears call history and return values.
 */
export function teardownFetchMock(mock: { mockReset(): void }): void {
	mock.mockReset();
}
