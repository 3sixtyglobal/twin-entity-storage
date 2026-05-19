// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	HttpParameterHelper,
	type INotFoundResponse,
	type IHttpRequestContext,
	type INoContentResponse,
	type IRestRoute,
	type ITag
} from "@twin.org/api-models";
import { Coerce, ComponentFactory, Guards, StringHelper } from "@twin.org/core";
import type {
	IEntityStorageComponent,
	IEntityStorageCountRequest,
	IEntityStorageCountResponse,
	IEntityStorageEmptyRequest,
	IEntityStorageGetRequest,
	IEntityStorageGetResponse,
	IEntityStorageListRequest,
	IEntityStorageListResponse,
	IEntityStorageRemoveBatchRequest,
	IEntityStorageRemoveRequest,
	IEntityStorageSetBatchRequest,
	IEntityStorageSetRequest
} from "@twin.org/entity-storage-models";
import { nameof } from "@twin.org/nameof";
import { HttpStatusCode } from "@twin.org/web";
import type { IEntityStorageRoutesExamples } from "./models/IEntityStorageRoutesExamples.js";

/**
 * The source used when communicating about these routes.
 */
const ROUTES_SOURCE = "entityStorageRoutes";

/**
 * The tag to associate with the routes.
 */
export const tagsEntityStorage: ITag[] = [
	{
		name: "EntityStorage",
		description: "Endpoints which are modelled to access an entity storage contract."
	}
];

/**
 * The REST routes for entity storage.
 * @param baseRouteName Prefix to prepend to the paths.
 * @param componentName The name of the component to use in the routes stored in the ComponentFactory.
 * @param options Additional options for the routes.
 * @param options.typeName Optional type name to use in the routes, defaults to Entity Storage.
 * @param options.tagName Optional name to use in OpenAPI spec for tag.
 * @param options.examples Optional examples to use in the routes.
 * @returns The generated routes.
 */
export function generateRestRoutesEntityStorage(
	baseRouteName: string,
	componentName: string,
	options?: {
		typeName?: string;
		tagName?: string;
		examples?: IEntityStorageRoutesExamples;
	}
): IRestRoute[] {
	const typeName = options?.typeName ?? "Entity Storage";
	const lowerName = typeName.toLowerCase();
	const camelTypeName = StringHelper.camelCase(typeName);

	const setRoute: IRestRoute<IEntityStorageSetRequest, INoContentResponse> = {
		operationId: `${camelTypeName}Set`,
		summary: `Set an entry in ${lowerName}.`,
		tag: options?.tagName ?? tagsEntityStorage[0].name,
		method: "POST",
		path: `${baseRouteName}/`,
		handler: async (httpRequestContext, request) =>
			entityStorageSet(httpRequestContext, componentName, request),
		requestType: {
			type: nameof<IEntityStorageSetRequest>(),
			examples: options?.examples?.set?.requestExamples ?? [
				{
					id: `${camelTypeName}SetRequestExample`,
					request: {
						body: {
							id: "12345",
							name: "My Item"
						}
					}
				}
			]
		},
		responseType: [
			{
				type: nameof<INoContentResponse>()
			}
		]
	};

	const setBatchRoute: IRestRoute<IEntityStorageSetBatchRequest, INoContentResponse> = {
		operationId: `${camelTypeName}SetBatch`,
		summary: `Set multiple entries in ${lowerName}.`,
		tag: options?.tagName ?? tagsEntityStorage[0].name,
		method: "POST",
		path: `${baseRouteName}/batch`,
		handler: async (httpRequestContext, request) =>
			entityStorageSetBatch(httpRequestContext, componentName, request),
		requestType: {
			type: nameof<IEntityStorageSetBatchRequest>(),
			examples: [
				{
					id: `${camelTypeName}SetBatchRequestExample`,
					request: {
						body: [
							{ id: "12345", name: "My Item" },
							{ id: "67890", name: "My Other Item" }
						]
					}
				}
			]
		},
		responseType: [
			{
				type: nameof<INoContentResponse>()
			}
		]
	};

	const getRoute: IRestRoute<IEntityStorageGetRequest, IEntityStorageGetResponse> = {
		operationId: `${camelTypeName}Get`,
		summary: `Get an entry from ${lowerName}.`,
		tag: options?.tagName ?? tagsEntityStorage[0].name,
		method: "GET",
		path: `${baseRouteName}/:id`,
		handler: async (httpRequestContext, request) =>
			entityStorageGet(httpRequestContext, componentName, request),
		requestType: {
			type: nameof<IEntityStorageGetRequest>(),
			examples: options?.examples?.get?.requestExamples ?? [
				{
					id: `${camelTypeName}GetRequestExample`,
					request: {
						pathParams: {
							id: "12345"
						}
					}
				}
			]
		},
		responseType: [
			{
				type: nameof<IEntityStorageGetResponse>(),
				examples: options?.examples?.get?.responseExamples ?? [
					{
						id: `${camelTypeName}GetResponseExample`,
						response: {
							body: {
								id: "12345",
								name: "My Item"
							}
						}
					}
				]
			},
			{
				type: nameof<INotFoundResponse>()
			}
		]
	};

	const removeRoute: IRestRoute<IEntityStorageRemoveRequest, INoContentResponse> = {
		operationId: `${camelTypeName}Remove`,
		summary: `Remove an entry from ${lowerName}.`,
		tag: options?.tagName ?? tagsEntityStorage[0].name,
		method: "DELETE",
		path: `${baseRouteName}/:id`,
		handler: async (httpRequestContext, request) =>
			entityStorageRemove(httpRequestContext, componentName, request),
		requestType: {
			type: nameof<IEntityStorageRemoveRequest>(),
			examples: options?.examples?.remove?.requestExamples ?? [
				{
					id: `${camelTypeName}RemoveRequestExample`,
					request: {
						pathParams: {
							id: "12345"
						}
					}
				}
			]
		},
		responseType: [
			{
				type: nameof<INoContentResponse>()
			},
			{
				type: nameof<INotFoundResponse>()
			}
		]
	};

	const listRoute: IRestRoute<IEntityStorageListRequest, IEntityStorageListResponse> = {
		operationId: `${camelTypeName}List`,
		summary: `Query entries from ${lowerName}.`,
		tag: options?.tagName ?? tagsEntityStorage[0].name,
		method: "GET",
		path: `${baseRouteName}/`,
		handler: async (httpRequestContext, request) =>
			entityStorageList(httpRequestContext, componentName, request),
		requestType: {
			type: nameof<IEntityStorageListRequest>(),
			examples: options?.examples?.list?.requestExamples ?? [
				{
					id: `${camelTypeName}ListRequestExample`,
					request: {}
				}
			]
		},
		responseType: [
			{
				type: nameof<IEntityStorageListResponse>(),
				examples: options?.examples?.list?.responseExamples ?? [
					{
						id: `${camelTypeName}ListResponseExample`,
						response: {
							body: {
								entities: [{ id: "12345", name: "My Item" }]
							}
						}
					}
				]
			}
		]
	};

	const countRoute: IRestRoute<IEntityStorageCountRequest, IEntityStorageCountResponse> = {
		operationId: `${camelTypeName}Count`,
		summary: `Count entries in ${lowerName}.`,
		tag: options?.tagName ?? tagsEntityStorage[0].name,
		method: "GET",
		path: `${baseRouteName}/count`,
		handler: async (httpRequestContext, request) =>
			entityStorageCount(httpRequestContext, componentName, request),
		requestType: {
			type: nameof<IEntityStorageCountRequest>(),
			examples: options?.examples?.count?.requestExamples ?? [
				{
					id: `${camelTypeName}CountRequestExample`,
					request: {}
				}
			]
		},
		responseType: [
			{
				type: nameof<IEntityStorageCountResponse>(),
				examples: options?.examples?.count?.responseExamples ?? [
					{
						id: `${camelTypeName}CountResponseExample`,
						response: {
							body: {
								count: 1
							}
						}
					}
				]
			}
		]
	};

	const emptyRoute: IRestRoute<IEntityStorageEmptyRequest, INoContentResponse> = {
		operationId: `${camelTypeName}Empty`,
		summary: `Remove all entries from ${lowerName}.`,
		tag: options?.tagName ?? tagsEntityStorage[0].name,
		method: "DELETE",
		path: `${baseRouteName}/`,
		handler: async (httpRequestContext, request) =>
			entityStorageEmpty(httpRequestContext, componentName, request),
		requestType: {
			type: nameof<IEntityStorageEmptyRequest>(),
			examples: [
				{
					id: `${camelTypeName}EmptyRequestExample`,
					request: {}
				}
			]
		},
		responseType: [
			{
				type: nameof<INoContentResponse>()
			}
		]
	};

	const removeBatchRoute: IRestRoute<IEntityStorageRemoveBatchRequest, INoContentResponse> = {
		operationId: `${camelTypeName}RemoveBatch`,
		summary: `Remove multiple entries from ${lowerName} by id.`,
		tag: options?.tagName ?? tagsEntityStorage[0].name,
		method: "DELETE",
		path: `${baseRouteName}/batch`,
		handler: async (httpRequestContext, request) =>
			entityStorageRemoveBatch(httpRequestContext, componentName, request),
		requestType: {
			type: nameof<IEntityStorageRemoveBatchRequest>(),
			examples: [
				{
					id: `${camelTypeName}RemoveBatchRequestExample`,
					request: {
						body: ["12345", "67890"]
					}
				}
			]
		},
		responseType: [
			{
				type: nameof<INoContentResponse>()
			}
		]
	};

	return [
		setRoute,
		setBatchRoute,
		getRoute,
		removeRoute,
		removeBatchRoute,
		emptyRoute,
		listRoute,
		countRoute
	];
}

/**
 * Set the entry in entity storage.
 * @param httpRequestContext The request context for the API.
 * @param componentName The name of the component to use in the routes.
 * @param request The request.
 * @returns The response object with additional http response properties.
 */
export async function entityStorageSet(
	httpRequestContext: IHttpRequestContext,
	componentName: string,
	request: IEntityStorageSetRequest
): Promise<INoContentResponse> {
	Guards.object<IEntityStorageSetRequest>(ROUTES_SOURCE, nameof(request), request);

	const component = ComponentFactory.get<IEntityStorageComponent>(componentName);
	await component.set(
		request.body,
		HttpParameterHelper.objectFromString(request.query?.conditions)
	);
	return {
		statusCode: HttpStatusCode.noContent
	};
}

/**
 * Set multiple entries in entity storage.
 * @param httpRequestContext The request context for the API.
 * @param componentName The name of the component to use in the routes.
 * @param request The request.
 * @returns The response object with additional http response properties.
 */
export async function entityStorageSetBatch(
	httpRequestContext: IHttpRequestContext,
	componentName: string,
	request: IEntityStorageSetBatchRequest
): Promise<INoContentResponse> {
	Guards.object<IEntityStorageSetBatchRequest>(ROUTES_SOURCE, nameof(request), request);
	Guards.arrayValue(ROUTES_SOURCE, nameof(request.body), request.body);

	const component = ComponentFactory.get<IEntityStorageComponent>(componentName);
	await component.setBatch(request.body);
	return {
		statusCode: HttpStatusCode.noContent
	};
}

/**
 * Remove all entries from entity storage.
 * @param httpRequestContext The request context for the API.
 * @param componentName The name of the component to use in the routes.
 * @param request The request.
 * @returns The response object with additional http response properties.
 */
export async function entityStorageEmpty(
	httpRequestContext: IHttpRequestContext,
	componentName: string,
	request: IEntityStorageEmptyRequest
): Promise<INoContentResponse> {
	const component = ComponentFactory.get<IEntityStorageComponent>(componentName);
	await component.empty();
	return { statusCode: HttpStatusCode.noContent };
}

/**
 * Get the entry from entity storage.
 * @param httpRequestContext The request context for the API.
 * @param componentName The name of the component to use in the routes.
 * @param request The request.
 * @returns The response object with additional http response properties.
 */
export async function entityStorageGet(
	httpRequestContext: IHttpRequestContext,
	componentName: string,
	request: IEntityStorageGetRequest
): Promise<IEntityStorageGetResponse> {
	Guards.object<IEntityStorageGetRequest>(ROUTES_SOURCE, nameof(request), request);
	Guards.object<IEntityStorageGetRequest["pathParams"]>(
		ROUTES_SOURCE,
		nameof(request.pathParams),
		request.pathParams
	);
	Guards.stringValue(ROUTES_SOURCE, nameof(request.pathParams.id), request.pathParams.id);

	const component = ComponentFactory.get<IEntityStorageComponent>(componentName);
	const item = await component.get(
		request.pathParams.id,
		request.query?.secondaryIndex as keyof unknown,
		HttpParameterHelper.objectFromString(request.query?.conditions)
	);
	return {
		body: item
	};
}

/**
 * Remove the entry from entity storage.
 * @param httpRequestContext The request context for the API.
 * @param componentName The name of the component to use in the routes.
 * @param request The request.
 * @returns The response object with additional http response properties.
 */
export async function entityStorageRemove(
	httpRequestContext: IHttpRequestContext,
	componentName: string,
	request: IEntityStorageRemoveRequest
): Promise<INoContentResponse> {
	Guards.object<IEntityStorageRemoveRequest>(ROUTES_SOURCE, nameof(request), request);
	Guards.object<IEntityStorageRemoveRequest["pathParams"]>(
		ROUTES_SOURCE,
		nameof(request.pathParams),
		request.pathParams
	);
	Guards.stringValue(ROUTES_SOURCE, nameof(request.pathParams.id), request.pathParams.id);

	const component = ComponentFactory.get<IEntityStorageComponent>(componentName);
	await component.remove(
		request.pathParams.id,
		HttpParameterHelper.objectFromString(request.query?.conditions)
	);
	return {
		statusCode: HttpStatusCode.noContent
	};
}

/**
 * Query the entries from entity storage.
 * @param httpRequestContext The request context for the API.
 * @param componentName The name of the component to use in the routes.
 * @param request The request.
 * @returns The response object with additional http response properties.
 */
export async function entityStorageList(
	httpRequestContext: IHttpRequestContext,
	componentName: string,
	request: IEntityStorageListRequest
): Promise<IEntityStorageListResponse> {
	Guards.object<IEntityStorageListRequest>(ROUTES_SOURCE, nameof(request), request);

	const component = ComponentFactory.get<IEntityStorageComponent>(componentName);
	const result = await component.query(
		HttpParameterHelper.objectFromString(request.query?.conditions),
		request.query?.orderBy as keyof unknown,
		request.query?.orderByDirection,
		HttpParameterHelper.objectFromString(request.query?.properties),
		request.query?.cursor,
		Coerce.number(request.query?.limit)
	);
	return {
		body: result
	};
}

/**
 * Count the entries in entity storage.
 * @param httpRequestContext The request context for the API.
 * @param componentName The name of the component to use in the routes.
 * @param request The request.
 * @returns The response object with additional http response properties.
 */
export async function entityStorageCount(
	httpRequestContext: IHttpRequestContext,
	componentName: string,
	request: IEntityStorageCountRequest
): Promise<IEntityStorageCountResponse> {
	const component = ComponentFactory.get<IEntityStorageComponent>(componentName);
	const count = await component.count(
		HttpParameterHelper.objectFromString(request.query?.conditions)
	);
	return {
		body: { count }
	};
}

/**
 * Remove multiple entries from entity storage by id.
 * @param httpRequestContext The request context for the API.
 * @param componentName The name of the component to use in the routes.
 * @param request The request.
 * @returns The response object with additional http response properties.
 */
export async function entityStorageRemoveBatch(
	httpRequestContext: IHttpRequestContext,
	componentName: string,
	request: IEntityStorageRemoveBatchRequest
): Promise<INoContentResponse> {
	Guards.object<IEntityStorageRemoveBatchRequest>(ROUTES_SOURCE, nameof(request), request);
	Guards.arrayValue(ROUTES_SOURCE, nameof(request.body), request.body);

	const component = ComponentFactory.get<IEntityStorageComponent>(componentName);
	await component.removeBatch(request.body);
	return {
		statusCode: HttpStatusCode.noContent
	};
}
