// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { OptionDefaults } from 'typedoc';

const customSchemaTags = ['@json-ld', '@json-schema'];

export default {
	entryPoints: ['src/index.ts'],
	out: './docs/reference',
	hideGenerator: true,
	hideBreadcrumbs: true,
	hidePageHeader: true,
	excludeExternals: true,
	githubPages: false,
	disableSources: true,
	sort: ['source-order'],
	treatWarningsAsErrors: true,
	readme: 'none',
	entryFileName: 'index',
	plugin: ['typedoc-plugin-markdown'],
	blockTags: [...new Set([...OptionDefaults.blockTags, ...customSchemaTags])],
	excludeTags: customSchemaTags,
	useCustomAnchors: true
};
