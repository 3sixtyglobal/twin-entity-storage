// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
/**
 * Validates a custom release version against the current manifests before any
 * release machinery runs.
 *
 * Usage:
 *   node scripts/validate-custom-version.mjs prod <version>
 *   node scripts/validate-custom-version.mjs next <base-version>
 *
 * prod checks:
 *   • Format must be X.Y.Z with each component ≤ 999
 *   • Must be strictly greater than the current published production version
 *   • Must be at least equal to the current development base version
 *   • Major version may only increment by 1 from the current production version
 *
 * next checks:
 *   • Format must be X.Y.Z with each component ≤ 999
 *   • Must be strictly greater than the current development base version,
 *     ensuring <base>-next.0 is ahead of the already-published prerelease
 *   • Major version may only increment by 1 from the current development base
 */
import { loadJson, loadNextPrereleaseManifest } from './common.mjs';

const MANIFEST_PRODUCTION_FILENAME = 'release/release-please-manifest.prod.json';
const MANIFEST_PRERELEASE_FILENAME = 'release/release-please-manifest.prerelease.json';

/**
 * Compare two semver tuples [major, minor, patch].
 * @param {number[]} a Left-hand side.
 * @param {number[]} b Right-hand side.
 * @returns {boolean} True when a is strictly greater than b.
 */
function semverGt(a, b) {
	if (a[0] !== b[0]) {
		return a[0] > b[0];
	}
	if (a[1] !== b[1]) {
		return a[1] > b[1];
	}
	return a[2] > b[2];
}

/**
 * Execute the validation.
 */
async function run() {
	const mode = process.argv[2];
	const custom = process.argv[3];

	if (mode !== 'prod' && mode !== 'next') {
		throw new Error('Usage: node scripts/validate-custom-version.mjs prod|next <version>');
	}

	if (!custom) {
		throw new Error(`Usage: node scripts/validate-custom-version.mjs ${mode} <version>`);
	}

	if (!/^\d+\.\d+\.\d+$/.test(custom)) {
		throw new Error(`customVersion must be in X.Y.Z format (got: ${custom})`);
	}

	const [cMaj, cMin, cPat] = custom.split('.').map(Number);

	if (cMaj > 999 || cMin > 999 || cPat > 999) {
		throw new Error(
			`customVersion ${custom} has a component exceeding 999 — this is likely a typo.`
		);
	}

	const cv = [cMaj, cMin, cPat];

	// Read next's REAL line from origin: the local copy is stale after hotfixes.
	const preManifest = await loadNextPrereleaseManifest(MANIFEST_PRERELEASE_FILENAME);
	const currentPrerelease = Object.values(preManifest)[0];
	const devBase = currentPrerelease.split('-')[0];
	const [rMaj, rMin, rPat] = devBase.split('.').map(Number);

	if (mode === 'prod') {
		const prodManifest = await loadJson(MANIFEST_PRODUCTION_FILENAME);
		const prodVersion = Object.values(prodManifest)[0];
		const [pMaj, pMin, pPat] = prodVersion.split('.').map(Number);

		if (!semverGt(cv, [pMaj, pMin, pPat])) {
			throw new Error(
				`customVersion ${custom} must be strictly greater than the published production version ${prodVersion}. npm packages cannot be un-published.`
			);
		}

		if (cMaj - pMaj > 1) {
			throw new Error(
				`customVersion ${custom} would jump the major version by ${cMaj - pMaj} from the current ${prodVersion}. Maximum allowed increment is 1 — if this is intentional, update the production manifest manually before running this workflow.`
			);
		}

		if (semverGt([rMaj, rMin, rPat], cv)) {
			throw new Error(
				`customVersion ${custom} is below the current development version ${devBase}. This would create a version conflict with the next branch.`
			);
		}

		process.stdout.write(`Custom prod version ${custom} is valid.\n`);
		process.stdout.write(`  Published prod : ${prodVersion}\n`);
		process.stdout.write(`  Current dev    : ${currentPrerelease} (base: ${devBase})\n`);
	} else {
		// Must be strictly greater than the current dev base so that <custom>-next.0
		// is ahead of the current <devBase>-next.X for any X.
		if (!semverGt(cv, [rMaj, rMin, rPat])) {
			throw new Error(
				`customVersion ${custom} must be strictly greater than the current development base ${devBase} (from ${currentPrerelease}). The resulting ${custom}-next.0 would be behind the already-published ${currentPrerelease}.`
			);
		}

		if (cMaj - rMaj > 1) {
			throw new Error(
				`customVersion ${custom} would jump the major version by ${cMaj - rMaj} from the current development base ${devBase}. Maximum allowed increment is 1 — if this is intentional, update the prerelease manifest manually before running this workflow.`
			);
		}

		process.stdout.write(`Custom next version ${custom}-next.0 is valid.\n`);
		process.stdout.write(`  Current dev : ${currentPrerelease} (base: ${devBase})\n`);
	}
}

run().catch(err => {
	process.stderr.write(`::error::${err.message}\n`);
	// eslint-disable-next-line unicorn/no-process-exit
	process.exit(1);
});
