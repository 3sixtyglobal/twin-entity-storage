// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { GuardError } from "@twin.org/core";
import { ComparisonOperator } from "@twin.org/entity";
import { HttpMethod } from "@twin.org/web";
import { EntityStorageRestClient } from "../src/entityStorageRestClient.js";
import {
	jsonResponse,
	noContentResponse,
	setupFetchMock,
	teardownFetchMock
} from "./helpers/restClientTestHelpers.js";

// OpenAPI spec: ../../entity-storage-service/docs/open-api/spec.json
const ENDPOINT = "http://localhost:8080";
const PREFIX = "entity-storage";

interface ITestEntity {
	id: string;
	name: string;
	value: number;
}

const TEST_ENTITY: ITestEntity = {
	id: "entity-1",
	name: "Test Entity",
	value: 42
};

const TEST_ENTITIES: ITestEntity[] = [
	{ id: "entity-1", name: "Test Entity 1", value: 10 },
	{ id: "entity-2", name: "Test Entity 2", value: 20 }
];

describe("EntityStorageRestClient", () => {
	let client: EntityStorageRestClient<ITestEntity>;
	const fetchMock = vi.fn();

	beforeEach(() => {
		setupFetchMock(fetchMock);
		client = new EntityStorageRestClient<ITestEntity>({ endpoint: ENDPOINT });
	});

	afterEach(() => {
		teardownFetchMock(fetchMock);
	});

	describe("set", () => {
		test("throws guard error when entity is undefined", async () => {
			await expect(client.set(undefined as unknown as ITestEntity)).rejects.toMatchObject({
				name: GuardError.CLASS_NAME,
				message: "guard.objectUndefined"
			});
		});

		test("sends POST to correct URL", async () => {
			fetchMock.mockResolvedValueOnce(noContentResponse());

			await client.set(TEST_ENTITY);

			const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${ENDPOINT}/${PREFIX}`);
			expect(options.method).toBe(HttpMethod.POST);
		});

		test("sends entity in request body", async () => {
			fetchMock.mockResolvedValueOnce(noContentResponse());

			await client.set(TEST_ENTITY);

			const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
			const body = JSON.parse(options.body as string) as ITestEntity;
			expect(body.id).toBe(TEST_ENTITY.id);
			expect(body.name).toBe(TEST_ENTITY.name);
			expect(body.value).toBe(TEST_ENTITY.value);
		});

		test("includes conditions as query parameter when provided", async () => {
			fetchMock.mockResolvedValueOnce(noContentResponse());

			await client.set(TEST_ENTITY, [{ property: "name", value: "Test Entity" }]);

			const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("conditions=");
		});
	});

	describe("setBatch", () => {
		test("throws guard error when entities array is empty", async () => {
			await expect(client.setBatch([])).rejects.toMatchObject({
				name: GuardError.CLASS_NAME,
				message: "guard.arrayValue"
			});
		});

		test("sends POST to batch URL", async () => {
			fetchMock.mockResolvedValueOnce(noContentResponse());

			await client.setBatch(TEST_ENTITIES);

			const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${ENDPOINT}/${PREFIX}/batch`);
			expect(options.method).toBe(HttpMethod.POST);
		});

		test("sends entities array in request body", async () => {
			fetchMock.mockResolvedValueOnce(noContentResponse());

			await client.setBatch(TEST_ENTITIES);

			const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
			const body = JSON.parse(options.body as string) as ITestEntity[];
			expect(body).toHaveLength(2);
			expect(body[0].id).toBe("entity-1");
			expect(body[1].id).toBe("entity-2");
		});
	});

	describe("get", () => {
		test("throws guard error when id is empty string", async () => {
			await expect(client.get("")).rejects.toMatchObject({
				name: GuardError.CLASS_NAME,
				message: "guard.stringEmpty"
			});
		});

		test("sends GET to correct URL with entity id in path", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(TEST_ENTITY));

			await client.get("entity-1");

			const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${ENDPOINT}/${PREFIX}/entity-1`);
			expect(options.method).toBe(HttpMethod.GET);
		});

		test("returns the entity from response body", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(TEST_ENTITY));

			const result = await client.get("entity-1");

			expect(result).toEqual(TEST_ENTITY);
		});

		test("includes secondaryIndex as query parameter when provided", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(TEST_ENTITY));

			await client.get("test-name", "name");

			const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("secondaryIndex=name");
		});

		test("includes conditions as query parameter when provided", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse(TEST_ENTITY));

			await client.get("entity-1", undefined, [{ property: "name", value: "Test Entity" }]);

			const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("conditions=");
		});
	});

	describe("remove", () => {
		test("throws guard error when id is empty string", async () => {
			await expect(client.remove("")).rejects.toMatchObject({
				name: GuardError.CLASS_NAME,
				message: "guard.stringEmpty"
			});
		});

		test("sends DELETE to correct URL with entity id in path", async () => {
			fetchMock.mockResolvedValueOnce(noContentResponse());

			await client.remove("entity-1");

			const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${ENDPOINT}/${PREFIX}/entity-1`);
			expect(options.method).toBe(HttpMethod.DELETE);
		});

		test("includes conditions as query parameter when provided", async () => {
			fetchMock.mockResolvedValueOnce(noContentResponse());

			await client.remove("entity-1", [{ property: "name", value: "Test Entity" }]);

			const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("conditions=");
		});
	});

	describe("removeBatch", () => {
		test("throws guard error when ids array is empty", async () => {
			await expect(client.removeBatch([])).rejects.toMatchObject({
				name: GuardError.CLASS_NAME,
				message: "guard.arrayValue"
			});
		});

		test("sends DELETE to batch URL", async () => {
			fetchMock.mockResolvedValueOnce(noContentResponse());

			await client.removeBatch(["entity-1", "entity-2"]);

			const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${ENDPOINT}/${PREFIX}/batch`);
			expect(options.method).toBe(HttpMethod.DELETE);
		});

		test("calls DELETE on the batch endpoint", async () => {
			fetchMock.mockResolvedValueOnce(noContentResponse());

			await client.removeBatch(["entity-1", "entity-2"]);

			const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${ENDPOINT}/${PREFIX}/batch`);
			expect(options.method).toBe(HttpMethod.DELETE);
		});
	});

	describe("empty", () => {
		test("sends DELETE to the base URL", async () => {
			fetchMock.mockResolvedValueOnce(noContentResponse());

			await client.empty();

			const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${ENDPOINT}/${PREFIX}`);
			expect(options.method).toBe(HttpMethod.DELETE);
		});
	});

	describe("count", () => {
		test("sends GET to count URL", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ count: 5 }));

			await client.count();

			const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${ENDPOINT}/${PREFIX}/count`);
			expect(options.method).toBe(HttpMethod.GET);
		});

		test("returns the count from response body", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ count: 5 }));

			const result = await client.count();

			expect(result).toBe(5);
		});

		test("includes conditions as query parameter when provided", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ count: 3 }));

			await client.count({ property: "value", comparison: ComparisonOperator.Equals, value: 42 });

			const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("conditions=");
		});
	});

	describe("query", () => {
		test("sends GET to the base URL", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ entities: TEST_ENTITIES, cursor: undefined }));

			await client.query();

			const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(`${ENDPOINT}/${PREFIX}`);
			expect(options.method).toBe(HttpMethod.GET);
		});

		test("returns entities from response body", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ entities: TEST_ENTITIES }));

			const result = await client.query();

			expect(result.entities).toEqual(TEST_ENTITIES);
		});

		test("returns undefined cursor when not present in response", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ entities: TEST_ENTITIES }));

			const result = await client.query();

			expect(result.cursor).toBeUndefined();
		});

		test("returns cursor when present in response", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ entities: TEST_ENTITIES, cursor: "page2" }));

			const result = await client.query();

			expect(result.cursor).toBe("page2");
		});

		test("includes orderBy as query parameter when provided", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ entities: [] }));

			await client.query(undefined, "name");

			const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("orderBy=name");
		});

		test("includes orderByDirection as query parameter when provided", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ entities: [] }));

			await client.query(undefined, "name", "desc");

			const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("orderByDirection=desc");
		});

		test("includes limit as query parameter when provided", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ entities: [] }));

			await client.query(undefined, undefined, undefined, undefined, undefined, 10);

			const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("limit=10");
		});

		test("includes cursor as query parameter when provided", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ entities: [] }));

			await client.query(undefined, undefined, undefined, undefined, "page2");

			const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("cursor=page2");
		});

		test("includes conditions as query parameter when provided", async () => {
			fetchMock.mockResolvedValueOnce(jsonResponse({ entities: [] }));

			await client.query({ property: "value", comparison: ComparisonOperator.Equals, value: 42 });

			const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("conditions=");
		});
	});
});
