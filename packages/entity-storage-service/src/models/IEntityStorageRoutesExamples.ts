// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IRestRouteRequestExample, IRestRouteResponseExample } from "@3sixty/api-models";
import type {
	IEntityStorageCountRequest,
	IEntityStorageCountResponse,
	IEntityStorageGetRequest,
	IEntityStorageGetResponse,
	IEntityStorageListRequest,
	IEntityStorageListResponse,
	IEntityStorageRemoveRequest,
	IEntityStorageSetRequest
} from "@3sixty/entity-storage-models";

/**
 * Examples for the entity storage routes.
 */
export interface IEntityStorageRoutesExamples {
	/**
	 * Examples for the set route.
	 */
	set?: {
		requestExamples: IRestRouteRequestExample<IEntityStorageSetRequest>[];
	};

	/**
	 * Examples for the get route.
	 */
	get?: {
		requestExamples: IRestRouteRequestExample<IEntityStorageGetRequest>[];
		responseExamples: IRestRouteResponseExample<IEntityStorageGetResponse>[];
	};

	/**
	 * Examples for the remove route.
	 */
	remove?: {
		requestExamples: IRestRouteRequestExample<IEntityStorageRemoveRequest>[];
	};

	/**
	 * Examples for the list route.
	 */
	list?: {
		requestExamples: IRestRouteRequestExample<IEntityStorageListRequest>[];
		responseExamples: IRestRouteResponseExample<IEntityStorageListResponse>[];
	};

	/**
	 * Examples for the count route.
	 */
	count?: {
		requestExamples: IRestRouteRequestExample<IEntityStorageCountRequest>[];
		responseExamples: IRestRouteResponseExample<IEntityStorageCountResponse>[];
	};
}
