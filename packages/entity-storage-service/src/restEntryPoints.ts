// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IRestRouteEntryPoint } from "@twin.org/api-models";
import { generateRestRoutesEntityStorage, tagsEntityStorage } from "./entityStorageRoutes.js";

/**
 * These are dummy entry points for the entity storage service.
 * In reality your application would create its own entry points based on the
 * entity storage schema objects it wants to store, using a custom defaultBaseRoute.
 */
export const restEntryPoints: IRestRouteEntryPoint[] = [
	{
		name: "entity-storage",
		defaultBaseRoute: "entity-storage",
		tags: tagsEntityStorage,
		generateRoutes: generateRestRoutesEntityStorage
	}
];
