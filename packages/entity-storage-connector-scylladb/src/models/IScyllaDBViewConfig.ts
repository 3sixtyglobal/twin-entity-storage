// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IScyllaDBTableConfig } from "./IScyllaDBTableConfig.js";

/**
 * Definition of ScyllaDB view configuration.
 */
export interface IScyllaDBViewConfig extends IScyllaDBTableConfig {
	/**
	 * The name of the view.
	 */
	viewName: string;
}
