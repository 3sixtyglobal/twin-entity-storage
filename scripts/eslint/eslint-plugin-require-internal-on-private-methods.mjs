// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

const requireInternalOnPrivateMethodsRule = {
	meta: {
		type: 'suggestion',
		docs: { description: 'Require @internal JSDoc tag on private class methods and properties.' },
		schema: [],
		messages: {
			missingInternal: 'Private member "{{name}}" must include a @internal JSDoc tag.'
		}
	},
	create(context) {
		const sourceCode = context.sourceCode;
		function checkPrivateMember(node) {
			if (node.accessibility !== 'private') {
				return;
			}
			const comments = sourceCode.getCommentsBefore(node);
			const jsdoc = comments.find(c => c.type === 'Block' && c.value.startsWith('*'));
			if (!jsdoc || !/@internal\b/.test(jsdoc.value)) {
				context.report({
					node: node.key,
					messageId: 'missingInternal',
					data: { name: node.key.name ?? '[computed]' }
				});
			}
		}
		return {
			MethodDefinition: checkPrivateMember,
			PropertyDefinition: checkPrivateMember
		};
	}
};

export const requireInternalOnPrivatePlugin = {
	rules: { 'require-internal-on-private-methods': requireInternalOnPrivateMethodsRule }
};
