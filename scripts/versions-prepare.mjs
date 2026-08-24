// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
/**
 * This script is used to update the package versions when promoting
 * the next branch to production, or updating the next version after release.
 *
 * It handles two main scenarios:
 * 1. Production: Updates all packages from prerelease versions to stable versions
 * 2. Next: Updates all packages to the next prerelease version for development
 *
 * The script also manages internal dependencies between @twin.org packages,
 * ensuring they reference the correct versions of each other.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execAsync, loadJson, loadNextPrereleaseManifest, saveJson } from './common.mjs';

const MANIFEST_PRODUCTION_FILENAME = 'release/release-please-manifest.prod.json';
const MANIFEST_PRERELEASE_FILENAME = 'release/release-please-manifest.prerelease.json';
const CONFIG_PRERELEASE_FILENAME = 'release/release-please-config.prerelease.json';

/**
 * Apply a semver bump to a stable version string.
 * @param {string} version A stable semver string e.g. "1.2.4".
 * @param {'promote'|'patch'|'minor'|'major'} bumpType The bump to apply.
 * @returns {string} The bumped version.
 */
function applyBump(version, bumpType) {
	const [major, minor, patch] = version.split('.').map(Number);
	if (bumpType === 'major') {
		return `${major + 1}.0.0`;
	}
	if (bumpType === 'minor') {
		return `${major}.${minor + 1}.0`;
	}
	if (bumpType === 'patch') {
		return `${major}.${minor}.${patch + 1}`;
	}
	return `${major}.${minor}.${patch}`; // 'promote' — strip only, no bump
}

/**
 * Execute the process.
 */
async function run() {
	process.stdout.write('Versions Prepare\n');
	process.stdout.write('================\n');
	process.stdout.write('\n');
	process.stdout.write(`Platform: ${process.platform}\n`);
	process.stdout.write('\n');

	if (process.argv.length <= 2) {
		throw new Error('No command specified, use either production <patch|minor|major> or next');
	}

	const command = process.argv[2];
	if (command !== 'production' && command !== 'next') {
		throw new Error('Invalid command specified, use either production <patch|minor|major> or next');
	}

	process.stdout.write(`Command: ${command}\n\n`);

	const isProduction = command === 'production';

	// Determine prodVersion and nextVersion based on the command:
	// - production promote: read from the prerelease manifest and strip the pre-release
	//                       suffix — e.g. "1.2.4-next.5" → "1.2.4"
	// - production patch/minor/major: bump the CURRENT PRODUCTION version — the prerelease
	//                       manifest copy on main only refreshes when next is merged in,
	//                       which a hotfix skips, so it cannot be the bump base
	// - next: read from the production manifest and compute the next prerelease version
	let prodVersion;
	let nextVersion;

	if (isProduction) {
		const semverType = process.argv[3];
		if (!semverType || !['promote', 'patch', 'minor', 'major', 'custom'].includes(semverType)) {
			throw new Error(
				'semver_type must be promote, patch, minor, major, or custom for the production command'
			);
		}

		if (semverType === 'custom') {
			const customVersionArg = process.argv[4];
			if (!customVersionArg || !/^\d+\.\d+\.\d+$/.test(customVersionArg)) {
				throw new Error(
					'custom semver_type requires a valid version argument in X.Y.Z format, e.g. 1.2.3'
				);
			}

			const [cMaj, cMin, cPat] = customVersionArg.split('.').map(Number);

			if (cMaj > 999 || cMin > 999 || cPat > 999) {
				throw new Error(
					`customVersion ${customVersionArg} has a component exceeding 999 — this is likely a typo.`
				);
			}

			// Read the current production manifest to validate the custom version is safe.
			const releaseManifestProdCheck = await loadJson(MANIFEST_PRODUCTION_FILENAME);
			const currentProdVersion = Object.entries(releaseManifestProdCheck)[0][1];
			const [pMaj, pMin, pPat] = currentProdVersion.split('.').map(Number);

			// Read next's REAL line from origin: the local copy is stale after hotfixes.
			const releaseManifestPreCheck = await loadNextPrereleaseManifest(
				MANIFEST_PRERELEASE_FILENAME
			);
			const currentDevVersion = Object.entries(releaseManifestPreCheck)[0][1].split('-')[0];
			const [rMaj, rMin, rPat] = currentDevVersion.split('.').map(Number);

			function semverGt(a, b) {
				if (a[0] !== b[0]) {
					return a[0] > b[0];
				}
				if (a[1] !== b[1]) {
					return a[1] > b[1];
				}
				return a[2] > b[2];
			}

			const cv = [cMaj, cMin, cPat];

			if (!semverGt(cv, [pMaj, pMin, pPat])) {
				throw new Error(
					`customVersion ${customVersionArg} must be strictly greater than the published production version ${currentProdVersion}. npm packages cannot be un-published.`
				);
			}

			if (cMaj - pMaj > 1) {
				throw new Error(
					`customVersion ${customVersionArg} would jump the major version by ${cMaj - pMaj} from the current ${currentProdVersion}. Maximum allowed increment is 1 — if this is intentional, update the production manifest manually before running this workflow.`
				);
			}

			if (semverGt([rMaj, rMin, rPat], cv)) {
				throw new Error(
					`customVersion ${customVersionArg} is below the current development version ${currentDevVersion}. This would create a version conflict with the next branch.`
				);
			}

			prodVersion = customVersionArg;
			process.stdout.write(`Custom Version: ${prodVersion}\n`);
			process.stdout.write(`Current Prod:   ${currentProdVersion}\n`);
			process.stdout.write(`Current Dev:    ${currentDevVersion}\n\n`);
		} else if (semverType === 'promote') {
			process.stdout.write(`Loading release-please manifest: ${MANIFEST_PRERELEASE_FILENAME}\n\n`);
			const releaseManifestPrerelease = await loadJson(MANIFEST_PRERELEASE_FILENAME);
			const prereleaseVersion = Object.entries(releaseManifestPrerelease)[0][1];
			// Strip pre-release suffix: e.g. "1.2.4-next.5" -> "1.2.4"
			const strippedVersion = prereleaseVersion.split('-')[0];
			prodVersion = applyBump(strippedVersion, semverType);

			process.stdout.write(`Prerelease Version: ${prereleaseVersion}\n`);
			process.stdout.write(`Stripped Version:   ${strippedVersion}\n`);
			process.stdout.write(`Semver Bump:        ${semverType}\n`);
			process.stdout.write(`Production Version: ${prodVersion}\n\n`);
		} else {
			// patch/minor/major bump the CURRENT PRODUCTION version. Computing these
			// from main's copy of the prerelease manifest breaks hotfixes: that copy
			// only refreshes when next is merged in, which a hotfix skips, so a
			// second consecutive hotfix would recompute an already-released version.
			process.stdout.write(`Loading release-please manifest: ${MANIFEST_PRODUCTION_FILENAME}\n\n`);
			const releaseManifestProdBase = await loadJson(MANIFEST_PRODUCTION_FILENAME);
			const currentProdBase = Object.entries(releaseManifestProdBase)[0][1];
			prodVersion = applyBump(currentProdBase, semverType);

			process.stdout.write(`Production Base:    ${currentProdBase}\n`);
			process.stdout.write(`Semver Bump:        ${semverType}\n`);
			process.stdout.write(`Production Version: ${prodVersion}\n\n`);
		}

		// Update the prod manifest to prodVersion so release-prepare can read it back
		// and stamp Release-As: {prodVersion} on the force commit, which tells
		// release-please to use exactly this version regardless of commit analysis.
		process.stdout.write(`Updating release-please manifest: ${MANIFEST_PRODUCTION_FILENAME}\n\n`);
		const releaseManifestProd = await loadJson(MANIFEST_PRODUCTION_FILENAME);
		for (const key of Object.keys(releaseManifestProd)) {
			releaseManifestProd[key] = prodVersion;
		}
		await saveJson(MANIFEST_PRODUCTION_FILENAME, releaseManifestProd);
		process.stdout.write(`Prod Manifest updated to: ${prodVersion}\n\n`);
	} else {
		const nextSemverType = process.argv[3];

		if (nextSemverType === 'custom') {
			const customBase = process.argv[4];
			if (!customBase || !/^\d+\.\d+\.\d+$/.test(customBase)) {
				throw new Error(
					'custom next version requires a valid base version in X.Y.Z format, e.g. 0.1.0'
				);
			}
			nextVersion = `${customBase}-next.0`;
			prodVersion = customBase;
			process.stdout.write(`Custom Next Version: ${nextVersion}\n\n`);
		} else {
			process.stdout.write(`Loading release-please manifest: ${MANIFEST_PRODUCTION_FILENAME}\n\n`);
			const releaseManifestProd = await loadJson(MANIFEST_PRODUCTION_FILENAME);
			// Extract the current production version from the first package in the manifest
			// All packages in the monorepo should have the same version
			prodVersion = Object.entries(releaseManifestProd)[0][1];
			// Calculate the next prerelease version by incrementing the patch number
			// Example: 1.2.3 -> 1.2.4-next.0
			const versionParts = prodVersion.split('.');
			const nextPatch = Number.parseInt(versionParts[2], 10) + 1;
			nextVersion = `${versionParts[0]}.${versionParts[1]}.${nextPatch}-next.0`;
			process.stdout.write(`Production Version: ${prodVersion}\n`);
			process.stdout.write(`Next Version: ${nextVersion}\n\n`);
		}
	}

	// Load the root package.json to get the list of workspaces
	const repoPackageJson = await loadJson('package.json');

	// Collect all in-repo workspace package names up front so dependency processing
	// can distinguish them from external @twin.org packages regardless of the order
	// the workspaces are processed in.
	const workspaceNames = new Set();
	for (const workspace of repoPackageJson.workspaces) {
		const workspacePackageJson = await loadJson(path.join(workspace, 'package.json'));
		workspaceNames.add(workspacePackageJson.name);
	}

	const versionCache = {};

	for (const workspace of repoPackageJson.workspaces) {
		const workspacePackageJsonFilename = path.join(workspace, 'package.json');
		process.stdout.write(`Processing: ${workspacePackageJsonFilename}\n`);

		// Load the current package.json for this workspace
		const workspacePackageJson = await loadJson(workspacePackageJsonFilename);

		// Process the package: update version and dependencies
		const updatedPackage = await processPackage(
			isProduction,
			prodVersion,
			nextVersion,
			workspacePackageJson,
			versionCache,
			workspaceNames
		);

		// Save the updated package.json
		await saveJson(workspacePackageJsonFilename, updatedPackage);
	}

	// If we're updating for next (prerelease), also update the prerelease manifest
	// This ensures release-please knows about the new prerelease versions
	if (!isProduction) {
		// If we are updating the next version, we also need to update the
		// release-please manifest for next.
		process.stdout.write(`Updating release-please manifest: ${MANIFEST_PRERELEASE_FILENAME}\n`);
		const releaseManifestNext = await loadJson(MANIFEST_PRERELEASE_FILENAME);

		const keys = Object.keys(releaseManifestNext);
		for (const key of keys) {
			releaseManifestNext[key] = nextVersion;
		}

		await saveJson(MANIFEST_PRERELEASE_FILENAME, releaseManifestNext);

		// We also need to update any files specified in the release-please-manifest
		process.stdout.write('Updating release-please-config extra-files\n');
		// Read the current prod version — that is the value actually written in extra
		// files (after alignment to main). For the custom path prodVersion is the
		// user-supplied target version, not the value currently in those files.
		const prodManifestForExtras = await loadJson(MANIFEST_PRODUCTION_FILENAME);
		const currentVersionInFiles = Object.values(prodManifestForExtras)[0];
		const releaseConfig = await loadJson(CONFIG_PRERELEASE_FILENAME);
		if (releaseConfig.packages) {
			for (const packageName of Object.keys(releaseConfig.packages)) {
				const packageConfig = releaseConfig.packages[packageName];
				if (Array.isArray(packageConfig['extra-files'])) {
					for (const extraFile of packageConfig['extra-files']) {
						const filename = path.join(packageName, extraFile);
						process.stdout.write(`\tProcessing: ${filename}\n`);
						const contents = await fs.readFile(filename, 'utf8');
						const lines = contents.split('\n');
						for (let i = 0; i < lines.length; i++) {
							if (lines[i].includes('x-release-please-version')) {
								lines[i] = lines[i].replace(currentVersionInFiles, nextVersion);
							}
						}
						await fs.writeFile(filename, lines.join('\n'), 'utf8');
					}
				}
			}
			await saveJson(CONFIG_PRERELEASE_FILENAME, releaseConfig);
		}
	}

	process.stdout.write('\nDone.\n');
}

/**
 * Process a workspace package.
 * @param isProduction Whether the command is for production or next.
 * @param prodVersion The production version to use when processing the package.
 * @param nextVersion The next version to use when processing the package.
 * @param workspacePackageJson The package.json of the workspace to process.
 * @param versionCache A cache for package versions to avoid redundant lookups.
 * @param workspaceNames The names of all in-repo workspace packages.
 * @returns The updated package.json.
 */
async function processPackage(
	isProduction,
	prodVersion,
	nextVersion,
	workspacePackageJson,
	versionCache,
	workspaceNames
) {
	// Update the package's own version based on the operation type
	if (isProduction) {
		// For production: set to the stable production version
		workspacePackageJson.version = prodVersion;
	} else {
		// For next: set to the next prerelease version
		workspacePackageJson.version = nextVersion;
	}

	// Cache this package's version to avoid redundant lookups when processing dependencies
	versionCache[workspacePackageJson.name] = workspacePackageJson.version;

	// Process all types of dependencies that might reference other @twin.org packages
	// This ensures internal dependencies are updated to the correct versions
	await processDependencies(
		isProduction,
		prodVersion,
		workspacePackageJson.dependencies,
		versionCache,
		workspaceNames,
		false
	);
	await processDependencies(
		isProduction,
		prodVersion,
		workspacePackageJson.devDependencies,
		versionCache,
		workspaceNames,
		false
	);
	await processDependencies(
		isProduction,
		prodVersion,
		workspacePackageJson.peerDependencies,
		versionCache,
		workspaceNames,
		true
	);

	return workspacePackageJson;
}

/**
 * Process the dependencies of a package.
 * @param isProduction Whether the command is for production or next.
 * @param prodVersion The production version to use when processing the dependencies.
 * @param dependencies The dependencies to process.
 * @param versionCache A cache for package versions to avoid redundant lookups.
 * @param workspaceNames The names of all in-repo workspace packages.
 * @param isPeerDependency Whether the dependencies are peer dependencies.
 */
async function processDependencies(
	isProduction,
	prodVersion,
	dependencies,
	versionCache,
	workspaceNames,
	isPeerDependency
) {
	if (!dependencies) {
		return;
	}
	for (const [name, version] of Object.entries(dependencies)) {
		// Only process @twin.org packages (internal dependencies)
		if (name.startsWith('@twin.org')) {
			if (isPeerDependency) {
				// If it's a peer dependency, we just match the major version
				// This allows the package to work with any compatible version
				await getPackageVersion(name, 'latest', versionCache);
				const latest = versionCache[name];
				const latestMajor = Number.parseInt(latest.split('.')[0], 10);
				dependencies[name] = `>=${latestMajor}.0.0-0 <${latestMajor + 1}.0.0`;
			} else if (isProduction) {
				// PRODUCTION MODE: Convert "next" references to actual published versions
				// Set the dependency to a caret range of the resolved or production version
				// This allows compatible updates (e.g., ^1.2.3 allows 1.2.4 but not 1.3.0)
				if (version === 'next') {
					// If the package is set to "next", we resolve it to the latest stable
					await getPackageVersion(name, 'latest', versionCache);
					dependencies[name] = `^${versionCache[name] ?? prodVersion}`;
				} else if (workspaceNames.has(name)) {
					// In-repo linked-versions package: follows the repo version.
					dependencies[name] = `^${versionCache[name] ?? prodVersion}`;
				}
				// Otherwise: an external dependency already pinned by a previous
				// release. Keep the existing pin - on a hotfix the sibling repos have
				// not released a matching version, so re-pinning to prodVersion would
				// reference versions that do not exist on the registry.
			} else if (!isProduction) {
				// NEXT MODE: Use the cached version for local workspace packages
				// (already processed in this run), or "next" for all external deps.
				// Do NOT fetch from npm -- external deps must stay as "next", not a
				// resolved specific version like "0.9.0-next.1".
				dependencies[name] = versionCache[name] ?? 'next';
			}
		}
	}
}

/**
 * Get the version of a package from npm.
 * @param name The name of the package to get the version for.
 * @param tag The tag to use when fetching the version (e.g., "next").
 * @param versionCache A cache for package versions to avoid redundant lookups.
 */
async function getPackageVersion(name, tag, versionCache) {
	if (!versionCache[name]) {
		process.stdout.write(`\tResolving Version for: ${name}@${tag}\n`);
		const version = await execAsync(`npm view "${name}@${tag}" version`);
		versionCache[name] = version;
		process.stdout.write(`\t\tVersion: ${versionCache[name]}\n`);
	}
}

run().catch(err => {
	process.stderr.write(`${err.message}\n${err.stack}`);
	// eslint-disable-next-line unicorn/no-process-exit
	process.exit(1);
});
