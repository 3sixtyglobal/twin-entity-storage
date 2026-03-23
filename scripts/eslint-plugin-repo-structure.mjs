// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import fs from 'node:fs';
import path from 'node:path';
import { camelCase, kebabCase, pascalCase, snakeCase } from './common.mjs';

const STRIP_SUFFIXES = ['.spec', '.test'];
const VALIDATION_CACHE = new Set();
const INTERNAL_IGNORE_PATTERNS = ['.git/**'];
const IS_ESLINT_FIX_MODE =
	process.argv.includes('--fix') && !process.argv.includes('--fix-dry-run');

/**
 * Convert windows slashes to posix slashes.
 * @param value The path to normalize.
 * @returns The normalized path.
 */
function toPosix(value) {
	return value.replace(/\\/g, '/');
}

/**
 * Convert a glob pattern to regex.
 * Supports * and **.
 * @param pattern The glob pattern.
 * @returns The compiled regex.
 */
function globToRegExp(pattern) {
	const isFolder = pattern.endsWith('/');
	const normalizedPattern = isFolder ? pattern.slice(0, -1) : pattern;
	const startsWithGlobstar = normalizedPattern.startsWith('**');

	// Mark glob patterns BEFORE escaping to protect them
	let marked = normalizedPattern.replace(/\*\*/g, '::GLOBSTAR::').replace(/\*/g, '::SINGLE_STAR::');

	// Escape regex special characters
	marked = marked
		.replace(/\./g, '\\.')
		.replace(/\+/g, '\\+')
		.replace(/\?/g, '\\?')
		.replace(/{/g, '\\{')
		.replace(/}/g, '\\}')
		.replace(/\|/g, '\\|')
		.replace(/\^/g, '\\^')
		.replace(/\$/g, '\\$');

	// Now replace marked patterns with regex equivalents
	let regexPattern = marked.replace(/::GLOBSTAR::/g, '.*').replace(/::SINGLE_STAR::/g, '[^/]*');

	if (isFolder) {
		// For patterns starting with **/, adjust to match at any level including root
		if (startsWithGlobstar && regexPattern.startsWith('.*')) {
			// regexPattern is like ".*/src-data"
			// Change to: "(src-data|.*/src-data)" to match both root and nested
			const pathWithoutLeadingDotStar = regexPattern.slice(2); // Remove ".*/", keep rest like "/src-data"
			regexPattern = `(${pathWithoutLeadingDotStar.slice(1)}|${regexPattern})`;
		}
		// Match folder itself and everything inside
		return new RegExp(`^${regexPattern}(/.*)?$`);
	}

	return new RegExp(`^${regexPattern}$`);
}

/**
 * Replace the final path segment in a relative path.
 * @param relativePath The original relative path.
 * @param newName The new final segment name.
 * @returns The updated relative path.
 */
function replaceBaseName(relativePath, newName) {
	const slash = relativePath.lastIndexOf('/');
	if (slash < 0) {
		return newName;
	}

	return `${relativePath.slice(0, slash + 1)}${newName}`;
}

/**
 * Attempt a safe filesystem rename for a repo entry.
 * @param rootDir The repository root.
 * @param fromRelativePath Existing relative path.
 * @param toRelativePath New relative path.
 * @returns True if the rename happened.
 */
function tryRenameEntry(rootDir, fromRelativePath, toRelativePath) {
	const fromAbsolutePath = path.join(rootDir, fromRelativePath);
	const toAbsolutePath = path.join(rootDir, toRelativePath);
	const fromAbsolutePathLower = fromAbsolutePath.toLowerCase();
	const toAbsolutePathLower = toAbsolutePath.toLowerCase();

	if (fromAbsolutePath === toAbsolutePath) {
		return false;
	}

	if (!fs.existsSync(fromAbsolutePath)) {
		return false;
	}

	if (fromAbsolutePathLower === toAbsolutePathLower) {
		const tempName = `.__repo-structure-rename-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
		const tempAbsolutePath = path.join(path.dirname(toAbsolutePath), tempName);
		fs.renameSync(fromAbsolutePath, tempAbsolutePath);
		fs.renameSync(tempAbsolutePath, toAbsolutePath);
		return true;
	}

	if (fs.existsSync(toAbsolutePath)) {
		return false;
	}

	fs.renameSync(fromAbsolutePath, toAbsolutePath);
	return true;
}

/**
 * Expand a .gitignore entry into the glob patterns needed by this plugin.
 * This is intentionally small and only covers the pattern shapes used in this repository.
 * @param pattern The raw .gitignore pattern.
 * @returns The expanded patterns.
 */
function expandGitignorePattern(pattern) {
	const normalized = toPosix(pattern.trim()).replace(/\/+$|\/$/g, '');

	if (!normalized) {
		return [];
	}

	if (normalized.includes('*')) {
		return normalized.endsWith('/**') ? [normalized] : [normalized, `${normalized}/**`];
	}

	if (normalized.includes('/')) {
		return [normalized, `${normalized}/**`];
	}

	return [normalized, `**/${normalized}`, `${normalized}/**`, `**/${normalized}/**`];
}

/**
 * Load ignore patterns from the repository .gitignore.
 * @param rootDir The repository root.
 * @returns The ignore patterns.
 */
function loadGitignorePatterns(rootDir) {
	const gitignorePath = path.join(rootDir, '.gitignore');

	let content = '';
	try {
		content = fs.readFileSync(gitignorePath, 'utf8');
	} catch {
		return INTERNAL_IGNORE_PATTERNS;
	}

	const patterns = content
		.split(/\r?\n/u)
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'))
		.flatMap(line => expandGitignorePattern(line));

	return [...INTERNAL_IGNORE_PATTERNS, ...patterns];
}

/**
 * Check whether a rule name pattern matches a path segment.
 * @param pattern The rule name pattern.
 * @param segment The current path segment.
 * @returns True if the segment matches.
 */
function segmentMatches(pattern, segment) {
	if (pattern === '*') {
		return true;
	}

	return globToRegExp(pattern).test(segment);
}

/**
 * Choose the best matching child rule for a path segment.
 * Exact names are preferred over glob patterns, and explicit kinds are preferred over implicit kinds.
 * @param node The current structure node.
 * @param segment The path segment to match.
 * @param expectedKind The expected kind, file or folder.
 * @returns The best matching rule or null.
 */
function selectChildRule(node, segment, expectedKind) {
	const children = node.children ?? [];

	let best = null;
	let bestScore = -1;

	for (const child of children) {
		const kind = child.kind ?? 'any';
		if (kind === 'any' || kind === expectedKind) {
			if (segmentMatches(child.name, segment)) {
				let score = 0;
				if (child.name === segment) {
					score += 3;
				} else if (child.name === '*') {
					score += 1;
				} else {
					score += 2;
				}

				if (kind === expectedKind) {
					score += 1;
				}

				if (score > bestScore) {
					best = child;
					bestScore = score;
				}
			}
		}
	}

	return best;
}

/**
 * Build an effective rule by overlaying defaults with any explicit child match.
 * @param defaultRule The inherited default rule.
 * @param childRule The explicit child rule.
 * @param expectedKind The current entry kind.
 * @returns The merged effective rule.
 */
function mergeRule(defaultRule, childRule, expectedKind) {
	if (!defaultRule && !childRule) {
		return null;
	}

	return {
		...(defaultRule ?? {}),
		...(childRule ?? {}),
		kind: expectedKind
	};
}

/**
 * Resolve the applicable naming rule for a file or folder path.
 * @param structure The root structure node.
 * @param relativePath The entry path relative to repo root.
 * @param kind The entry kind.
 * @returns The effective rule or null.
 */
function resolveRule(structure, relativePath, kind) {
	const segments = relativePath.split('/').filter(Boolean);
	let node = structure;
	let rule = null;

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		const isLast = i === segments.length - 1;
		const expectedKind = isLast ? kind : 'folder';

		const defaults = node.defaults?.[expectedKind] ?? null;
		const child = selectChildRule(node, segment, expectedKind);
		rule = mergeRule(defaults, child, expectedKind);

		if (!rule) {
			return null;
		}

		if (!isLast) {
			const nextNode = child ?? {};
			node = {
				children: nextNode.children ?? [],
				defaults: nextNode.defaults ?? node.defaults
			};
		}
	}

	return rule;
}

/**
 * Remove the supported test-related suffixes from a file base name.
 * @param baseName The file base name without its extension.
 * @returns The base name without supported suffixes.
 */
function stripKnownSuffixes(baseName) {
	let current = baseName;
	for (const suffix of STRIP_SUFFIXES) {
		if (current.endsWith(suffix)) {
			current = current.slice(0, -suffix.length);
		}
	}
	return current;
}

/**
 * Build the expected file name for a TypeScript source file.
 * @param rawBaseName The file name without its extension.
 * @param extension The original file extension.
 * @returns The expected file name, including its extension.
 */
function buildExpectedTypeScriptFileName(rawBaseName, extension) {
	let suffix = '';
	let base = rawBaseName;

	for (const candidate of STRIP_SUFFIXES) {
		if (base.endsWith(candidate)) {
			base = base.slice(0, -candidate.length);
			suffix = `${candidate}${suffix}`;
		}
	}

	const normalizedBase = base.startsWith('I')
		? `I${pascalCase(base.slice(1), false) || 'Name'}`
		: camelCase(base, false);

	return `${normalizedBase}${suffix}${extension}`;
}

/**
 * Apply a configured naming convention to a string.
 * @param caseName The configured case name.
 * @param input The value to transform.
 * @returns The transformed value.
 */
function applyCase(caseName, input) {
	switch (caseName) {
		case 'camel':
			return camelCase(input, false);
		case 'pascal':
			return pascalCase(input, false);
		case 'kebab':
			return kebabCase(input, false);
		case 'snake':
			return snakeCase(input, false);
		default:
			return input;
	}
}

/**
 * Validate a file or folder name against a simple case convention.
 * @param caseName The configured case name.
 * @param value The name to validate.
 * @returns The validation result.
 */
function validateSimpleCase(caseName, value) {
	if (value.startsWith('.')) {
		return { valid: true, expected: value };
	}

	const expected = applyCase(caseName, value);
	return {
		valid: expected === value,
		expected
	};
}

/**
 * Validate a TypeScript file name against the repository naming convention.
 * @param fileName The file name to validate.
 * @returns The validation result.
 */
function validateTypeScriptCase(fileName) {
	if (!/\.(ts|tsx)$/.test(fileName) || fileName.endsWith('.d.ts')) {
		return { valid: true, expected: fileName };
	}

	const extensionIndex = fileName.lastIndexOf('.');
	const base = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
	const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : '';
	const expected = buildExpectedTypeScriptFileName(base, extension);

	const validInterface = /^I[A-Z][\dA-Za-z]*$/.test(stripKnownSuffixes(base));
	const validCamel = /^[a-z][\dA-Za-z]*$/.test(stripKnownSuffixes(base));
	const valid = stripKnownSuffixes(base).startsWith('I') ? validInterface : validCamel;

	return { valid, expected };
}

/**
 * Recursively collect all file and folder entries beneath a directory.
 * @param rootDir The repository root directory.
 * @param relativeDir The current directory relative to the repository root.
 * @returns The collected entries.
 */
function collectEntries(rootDir, ignorePatterns, relativeDir = '') {
	const current = path.join(rootDir, relativeDir);
	const dirEntries = fs.readdirSync(current, { withFileTypes: true });
	const entries = [];

	for (const dirEntry of dirEntries) {
		const relativePath = toPosix(path.posix.join(relativeDir, dirEntry.name));
		if (!isIgnored(relativePath, ignorePatterns)) {
			entries.push({
				path: relativePath,
				name: dirEntry.name,
				kind: dirEntry.isDirectory() ? 'folder' : 'file'
			});

			if (dirEntry.isDirectory()) {
				entries.push(...collectEntries(rootDir, ignorePatterns, relativePath));
			}
		}
	}

	return entries;
}

/**
 * Determine whether a repository entry should be skipped.
 * @param relativePath The entry path relative to the repository root.
 * @param ignorePatterns The configured ignore patterns.
 * @returns True if the entry should be ignored.
 */
function isIgnored(relativePath, ignorePatterns) {
	return ignorePatterns.some(pattern => globToRegExp(pattern).test(relativePath));
}

/**
 * Validate a file or folder name against its resolved rule.
 * @param rule The resolved naming rule.
 * @param name The file or folder name.
 * @param kind The entry kind.
 * @returns The validation result.
 */
function validateName(rule, name, kind) {
	if (!rule) {
		return {
			valid: false,
			expected: name,
			error: `No ${kind} rule matches this path.`
		};
	}

	if (rule.allow?.includes(name)) {
		return { valid: true, expected: name };
	}

	if (rule.allowPatterns?.some(pattern => globToRegExp(pattern).test(name))) {
		return { valid: true, expected: name };
	}

	if (kind === 'file' && rule.case === 'typescript') {
		return validateTypeScriptCase(name);
	}

	const targetName = rule.splitDots
		? name
				.split('.')
				.map(part => applyCase(rule.case, part))
				.join('.')
		: name;
	const result = validateSimpleCase(rule.case, name);

	if (rule.splitDots) {
		return {
			valid: targetName === name,
			expected: targetName
		};
	}

	return result;
}

/**
 * ESLint rule implementation for validating repository file and folder naming.
 */
const validateRepoStructureRule = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Validate all file and folder naming in the repository using repo-structure.json.'
		},
		schema: [],
		messages: {
			missingConfig: "Missing repo-structure.json at '{{path}}'.",
			invalidName: "{{kind}} '{{path}}' does not match '{{caseName}}' case. Use '{{expected}}'.",
			missingRule: "{{kind}} '{{path}}' has no matching naming rule in repo-structure.json.",
			missingStructure: "repo-structure.json is missing a top-level 'structure' object."
		}
	},
	create(context) {
		return {
			Program(node) {
				const rootDir = process.cwd();
				if (VALIDATION_CACHE.has(rootDir)) {
					return;
				}
				VALIDATION_CACHE.add(rootDir);

				const configPath = path.join(rootDir, 'repo-structure.json');

				let rawConfig;
				try {
					rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
				} catch {
					context.report({
						loc: { line: 1, column: 0 },
						messageId: 'missingConfig',
						data: { path: toPosix(configPath) }
					});
					return;
				}

				const structure = rawConfig.structure;

				if (!structure || typeof structure !== 'object') {
					context.report({
						loc: { line: 1, column: 0 },
						messageId: 'missingStructure'
					});
					return;
				}

				const gitignorePatterns = loadGitignorePatterns(rootDir);
				const structurePatterns = rawConfig.ignorePatterns || [];
				const ignore = [...gitignorePatterns, ...structurePatterns];

				const entries = collectEntries(rootDir, ignore);

				// Collect all violations to report them in the repo-structure.json file
				const violations = [];

				for (const entry of entries) {
					if (!isIgnored(entry.path, ignore)) {
						const rule = resolveRule(structure, entry.path, entry.kind);
						const result = validateName(rule, entry.name, entry.kind);

						if (!rule) {
							violations.push({
								messageId: 'missingRule',
								data: {
									kind: entry.kind,
									path: entry.path
								}
							});
						} else if (!result.valid) {
							const expectedPath = replaceBaseName(entry.path, result.expected);
							const renamed =
								IS_ESLINT_FIX_MODE && tryRenameEntry(rootDir, entry.path, expectedPath);

							if (!renamed) {
								violations.push({
									messageId: 'invalidName',
									data: {
										kind: entry.kind,
										path: entry.path,
										caseName: rule.case,
										expected: entry.kind === 'file' ? expectedPath : result.expected
									}
								});
							}
						}
					}
				}

				// Report all violations in repo-structure.json file
				for (let i = 0; i < violations.length; i++) {
					const violation = violations[i];
					context.report({
						loc: { line: 1, column: i },
						...violation
					});
				}
			}
		};
	}
};

/**
 * ESLint plugin exposing the repository structure validation rule.
 */
export const repoStructurePlugin = {
	rules: {
		'validate-repo-structure': validateRepoStructureRule
	}
};
