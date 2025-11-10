// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IScyllaDBTableConfig } from "./IScyllaDBTableConfig.js";

/**
 * Definition of MySQL DB configuration.
 */
export interface IScyllaDBViewConfig extends IScyllaDBTableConfig {
	/**
	 * The name of view.
	 * @default To the camel case of the entity name with View appended.
	 */
	viewName?: string;
}
