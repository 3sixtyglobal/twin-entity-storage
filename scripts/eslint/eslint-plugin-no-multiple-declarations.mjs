// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

const PRIMARY = [
	{ nodeType: 'TSInterfaceDeclaration', label: 'interface' },
	{ nodeType: 'TSTypeAliasDeclaration', label: 'type' },
	{ nodeType: 'ClassDeclaration', label: 'class' }
];

/**
 * ESLint rule that forbids more than one interface, type, or class declaration per file,
 * and forbids top-level function declarations when any interface, type, or class is present.
 */
const noMultipleDeclarationsRule = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow more than one interface, type alias, or class per file; disallow top-level functions alongside them.'
		},
		schema: [],
		messages: {
			multipleDeclarations:
				"Only one {{label}} declaration is allowed per file. Move '{{name}}' to its own file.",
			noFunctionWithPrimary:
				"Function '{{name}}' is not allowed in a file that contains an interface, type, or class declaration."
		}
	},
	create(context) {
		const primary = [];
		const functions = [];

		const visitors = {};
		for (const { nodeType, label } of PRIMARY) {
			visitors[nodeType] = node => primary.push({ node, label });
		}

		visitors['FunctionDeclaration'] = node => functions.push(node);

		visitors['Program:exit'] = () => {
			for (const { node, label } of primary.slice(1)) {
				context.report({
					node,
					messageId: 'multipleDeclarations',
					data: { label, name: node.id.name }
				});
			}

			if (primary.length > 0) {
				for (const node of functions) {
					context.report({
						node,
						messageId: 'noFunctionWithPrimary',
						data: { name: node.id.name }
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
