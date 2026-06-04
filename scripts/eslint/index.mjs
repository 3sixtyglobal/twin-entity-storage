// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { noDeepTypeNestingPlugin } from './eslint-plugin-no-deep-type-nesting.mjs';
import { noMultipleDeclarationsPlugin } from './eslint-plugin-no-multiple-declarations.mjs';
import { repoStructurePlugin } from './eslint-plugin-repo-structure.mjs';
import { requireInternalOnPrivatePlugin } from './eslint-plugin-require-internal-on-private-methods.mjs';

export const twinOrgPlugin = {
	rules: {
		...repoStructurePlugin.rules,
		...noMultipleDeclarationsPlugin.rules,
		...requireInternalOnPrivatePlugin.rules,
		...noDeepTypeNestingPlugin.rules
	}
};
