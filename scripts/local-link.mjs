// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
/**
 * This script is used to link local instances of npm packages in node_modules
 * without using npm commands. When using the <package-name> option, the script
 * will try to find the package in the sibling folders and link it.
 *
 * You can use wildcards to link multiple packages with similar names.
 *    npm run local-link "@twin.org/engine*"
 * or to link all packages in the current repo
 *    npm run local-link "@twin.org//*"
 *
 * Usage:
 *    npm run local-link <package-name>
 * or
 *    npm run local-link /path/to/package
 *
 * To unlink
 *    npm run local-link <package-name> unlink
 * or
 *    npm run local-link /path/to/package unlink
 */
import fs, { readdir } from 'node:fs/promises';
import path from 'node:path';
import { directoryExists, fileExists, isSymbolicLink, loadJson } from './common.mjs';

/**
 * Execute the process.
 */
async function run() {
	process.stdout.write('Local Link\n');
	process.stdout.write('==========\n');
	process.stdout.write('\n');
	process.stdout.write(`Platform: ${process.platform}\n`);

	if (process.argv.length <= 2) {
		throw new Error('No target package specified');
	}

	process.stdout.write('\n');
	const targetPackage = process.argv[2];

	// The target package starts with an @ so we have to try and locate it by
	// looking in the parent folder and assuming the other repos are in
	// a sibling folder to this one
	const packages = await findPackagesDetails(targetPackage);

	const nodeModulesDir = path.resolve('node_modules');
	process.stdout.write(`Node Modules: ${nodeModulesDir}\n`);

	if (process.argv[3] === 'unlink') {
		for (const pkg of packages) {
			await unlinkPackage(nodeModulesDir, pkg.packageName, pkg.targetDir);
		}
	} else {
		for (const pkg of packages) {
			await linkPackage(nodeModulesDir, pkg.packageName, pkg.targetDir);
		}
	}

	process.stdout.write('\nDone.\n');
}

/**
 * Link the specified package.
 * @param nodeModulesDir The node_modules directory.
 * @param packageName The name of the package to link.
 * @param targetDir The target directory of the package to link.
 */
async function linkPackage(nodeModulesDir, packageName, targetDir) {
	const currentNodeDir = path.join(nodeModulesDir, packageName);
	const backupNodeDir = path.join(nodeModulesDir, `${packageName}.bak`);

	const isLink = await isSymbolicLink(currentNodeDir);
	if (isLink) {
		process.stdout.write(`\nThe package ${currentNodeDir} is already a symbolic link, skipping\n`);
		return;
	}

	// Only proceed if the directory exists
	if (await directoryExists(currentNodeDir)) {
		process.stdout.write(`\nLinking package ${packageName}\n`);
		process.stdout.write(`Target package directory: ${targetDir}\n`);

		try {
			// Remove any old backup directory
			if (await directoryExists(backupNodeDir)) {
				await fs.rm(backupNodeDir, { recursive: true });
			}
		} catch {}

		process.stdout.write(`Renaming: ${currentNodeDir} to ${backupNodeDir}\n`);
		await fs.rename(currentNodeDir, backupNodeDir);

		process.stdout.write(`Creating symlink: ${currentNodeDir} to ${targetDir}\n`);
		await fs.symlink(targetDir, currentNodeDir);
	}
}

/**
 * Unlink the specified package.
 * @param nodeModulesDir The node_modules directory.
 * @param packageName The name of the package to unlink.
 * @param targetDir The target directory of the package to unlink.
 */
async function unlinkPackage(nodeModulesDir, packageName, targetDir) {
	const linkName = path.join(nodeModulesDir, packageName);
	if ((await directoryExists(linkName)) && !(await isSymbolicLink(linkName))) {
		process.stdout.write(`\nThe package ${linkName} is not a symbolic link, skipping\n`);
		return;
	}

	const linkNameBackup = `${linkName}.bak`;
	if (await directoryExists(linkNameBackup)) {
		process.stdout.write(`\nUnlinking package ${packageName}\n`);
		process.stdout.write(`Removing symlink: ${linkName}\n`);
		await fs.unlink(linkName);

		process.stdout.write(`Renaming backup directory: ${linkNameBackup} to ${linkName}\n`);
		await fs.rename(linkNameBackup, linkName);
	}
}

/**
 * Find the package directory and name.
 * @param targetPackage The target package to find.
 * @returns The package directory and name.
 */
async function findPackagesDetails(targetPackage) {
	const packages = [];

	if (targetPackage.startsWith('@')) {
		process.stdout.write(`Finding package by name: ${targetPackage}\n`);

		const repoDirRoot = path.resolve('..');
		process.stdout.write(`Root repo directory: ${repoDirRoot}\n\n`);

		const targetPackageParts = targetPackage.split('/');
		const packageNameOnly = targetPackageParts[1];

		const allRepoDirs = await readdir(repoDirRoot, { withFileTypes: true });
		for (const repoDir of allRepoDirs) {
			if (repoDir.isDirectory()) {
				const repoPackageJsonFilename = path.join(repoDirRoot, repoDir.name, 'package.json');
				if (await fileExists(repoPackageJsonFilename)) {
					const repoPackageJson = await loadJson(repoPackageJsonFilename);
					if (Array.isArray(repoPackageJson.workspaces)) {
						for (const workspaceEntry of repoPackageJson.workspaces) {
							const entryParts = workspaceEntry.split('/');
							if (new RegExp(`^${packageNameOnly}`).test(entryParts[1])) {
								const targetDir = path.join(repoDirRoot, repoDir.name, workspaceEntry);
								packages.push({ packageName: await getPackageNameFromDir(targetDir), targetDir });
							}
						}
					}
				}
			}
		}
	} else {
		const targetDir = path.resolve(targetPackage);
		packages.push({ packageName: await getPackageNameFromDir(targetDir), targetDir });
	}

	return packages;
}

/**
 * Get the package name from the directory.
 * @param targetDir The target directory.
 * @returns The package name.
 */
async function getPackageNameFromDir(targetDir) {
	const repoPackageJsonFilename = path.join(targetDir, 'package.json');
	if (await fileExists(repoPackageJsonFilename)) {
		const repoPackageJson = await loadJson(repoPackageJsonFilename);
		return repoPackageJson.name;
	}
	throw new Error(`Unable to locate package.json in target directory: ${targetDir}`);
}

run().catch(err => {
	process.stderr.write(`\n${err}\n`);
	// eslint-disable-next-line unicorn/no-process-exit
	process.exit(1);
});
