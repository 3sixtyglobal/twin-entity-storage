// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

const FUNCTION_LIKE_TYPES = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression',
	'TSMethodSignature',
	'TSFunctionType',
	'TSConstructSignatureDeclaration',
	'TSCallSignatureDeclaration'
]);

const PARAM_TYPES = new Set([
	'Identifier',
	'AssignmentPattern',
	'RestElement',
	'TSParameterProperty'
]);

/**
 * Returns true when a TSTypeAnnotation node is part of a function signature —
 * either a parameter type or a return type.
 * @param node The TSTypeAnnotation node.
 * @returns True if the annotation is part of a function signature.
 */
function isFunctionSignatureAnnotation(node) {
	const parent = node.parent;
	if (!parent) {
		return false;
	}
	if (FUNCTION_LIKE_TYPES.has(parent.type) && parent.returnType === node) {
		return true;
	}
	return PARAM_TYPES.has(parent.type) && parent.typeAnnotation === node;
}

/**
 * ESLint rule that forbids TSTypeLiteral (inline object types) nested more than one level deep
 * inside interface declarations.
 * One level is allowed: `foo: { bar: string }`.
 * Two or more levels are forbidden: `foo: { bar: { baz: string } }`.
 * Only checked inside interface bodies; type aliases, classes, and function signatures are ignored.
 */
const noDeepTypeNestingRule = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow inline object type literals nested more than one level deep inside interface declarations. Extract nested types into named types or interfaces instead.'
		},
		schema: [],
		messages: {
			tooDeep:
				'Inline object types must not be nested more than one level deep. Extract this type into a named interface or type alias.'
		}
	},
	create(context) {
		let interfaceDepth = 0;
		let depth = 0;
		let signatureDepth = 0;

		return {
			TSInterfaceBody() {
				interfaceDepth++;
			},
			'TSInterfaceBody:exit'() {
				interfaceDepth--;
			},
			TSTypeAnnotation(node) {
				if (isFunctionSignatureAnnotation(node)) {
					signatureDepth++;
				}
			},
			'TSTypeAnnotation:exit'(node) {
				if (isFunctionSignatureAnnotation(node)) {
					signatureDepth--;
				}
			},
			TSTypeLiteral(node) {
				if (interfaceDepth === 0 || signatureDepth > 0) {
					return;
				}
				depth++;
				if (depth > 2) {
					context.report({ node, messageId: 'tooDeep' });
				}
			},
			'TSTypeLiteral:exit'() {
				if (interfaceDepth === 0 || signatureDepth > 0) {
					return;
				}
				depth--;
			}
		};
	}
};

/**
 * ESLint plugin disallowing deeply nested inline object type literals.
 */
export const noDeepTypeNestingPlugin = {
	rules: {
		'no-deep-type-nesting': noDeepTypeNestingRule
	}
};
