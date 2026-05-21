// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

const TRACKED = [
	{ nodeType: 'TSInterfaceDeclaration', label: 'interface' },
	{ nodeType: 'TSTypeAliasDeclaration', label: 'type' },
	{ nodeType: 'ClassDeclaration', label: 'class' }
];

/**
 * ESLint rule that forbids more than one interface, type, or class declaration per file.
 */
const noMultipleDeclarationsRule = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow more than one interface, type alias, or class declaration per file.'
		},
		schema: [],
		messages: {
			multipleDeclarations:
				"Only one {{label}} declaration is allowed per file. Move '{{name}}' to its own file."
		}
	},
	create(context) {
		const seen = Object.fromEntries(TRACKED.map(({ nodeType }) => [nodeType, []]));

		const visitors = {};
		for (const { nodeType } of TRACKED) {
			visitors[nodeType] = node => seen[nodeType].push(node);
		}

		visitors['Program:exit'] = () => {
			for (const { nodeType, label } of TRACKED) {
				for (const node of seen[nodeType].slice(1)) {
					context.report({
						node,
						messageId: 'multipleDeclarations',
						data: { label, name: node.id.name }
					});
				}
			}
		};

		return visitors;
	}
};

/**
 * ESLint plugin exposing no-multiple-declarations rules.
 */
export const noMultipleDeclarationsPlugin = {
	rules: {
		'no-multiple-declarations': noMultipleDeclarationsRule
	}
};
