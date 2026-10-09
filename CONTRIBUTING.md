# Contributing

Thank you for your interest in contributing to this project! This guide will help you understand our development workflow and standards.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Branch Management](#branch-management)
- [Commit Standards](#commit-standards)
- [Pull Request Process](#pull-request-process)
- [Release Process](#release-process)
- [Hotfix Releases](#hotfix-releases)
- [Documentation](#documentation)

## Getting Started

### Prerequisites

- **Node.js** 24.x or later
- **pnpm** 12.x or later (`npm install -g pnpm`)
- **Git**

The repository uses pnpm as its package manager. The exact version is pinned in
the `packageManager` field of the root `package.json`, and the workspace is
defined by `pnpm-workspace.yaml`. There is no npm lockfile, so `npm install`
will not set the repository up correctly.

### Initial Setup

1. **Fork the repository** and clone your fork:

   ```shell
   git clone https://github.com/3sixtyglobal/<repo>.git
   cd <repo>
   ```

2. **Install dependencies**:

   ```shell
   pnpm install
   ```

   This also points git at the `.githooks` directory, see [Git Hooks](#git-hooks).

3. **Verify setup** by running a full build:

   ```shell
   pnpm run dist
   ```

### Git Hooks

`pnpm install` runs a `prepare` script that points git at the version controlled
`.githooks` directory. Two hooks are installed:

| Hook         | Enforces                                                             |
| ------------ | -------------------------------------------------------------------- |
| `commit-msg` | Commit messages follow Conventional Commits, checked with commitlint |
| `pre-push`   | The branch name matches the convention below                         |

If you cloned the repository before the hooks moved out of `.husky`, run
`pnpm install` once to update the hooks path.

## Development Workflow

### Building the Project

To build all packages in the monorepo:

```shell
pnpm run dist
```

Packages are visited in dependency order. Within each package the steps are:

1. **Clean** - Removes existing build artifacts
2. **Build** - Compiles TypeScript to JavaScript
3. **Validate locales** - Checks locale keys against their use in the source
4. **Type check tests** - Compiles the test sources without emitting
5. **Test** - Runs the test suite

Steps 2 to 5 run concurrently, as none of them depends on the output of the
others within the same package. API documentation is not part of this command,
see [Documentation](#documentation).

### Build Output Structure

Each package will have a `dist` folder containing:

- **`es/`** - ES Module format for modern bundlers and Node.js
- **`types/`** - TypeScript declaration files (`.d.ts`)

Generated API documentation is written to `<package>/docs/reference` by
`pnpm run docs`, not to `dist`.

### Development Commands for Repository

These commands are available at the repository level.

```shell
# Format code with Prettier
pnpm run format

# Run all the lint checks: formatting, code, markdown and spelling
pnpm run lint

# Check the published package manifests with publint, run this after a build
# as it inspects the packed output
pnpm run lint:package

# Perform a complete build
pnpm run dist

# Perform a complete build without running the tests
pnpm run dist:no-test

# Format, then lint and compile together, then validate locales and test
pnpm run quality

# The same as quality, without running the tests
pnpm run quality:no-test

# Run the tests for every package
pnpm run test

# Run the tests for every package and report coverage
pnpm run test:coverage

# Remove the build artifacts from every package
pnpm run clean

# Update the dependencies of every package, choosing each one interactively
pnpm run package:update
```

Most of these are thin wrappers over `pnpm -r`. Only `build`, `merge-locales`,
`dist` and `dist:no-test` walk the packages in dependency order, because they
either produce output that later packages compile against, or contain a step
that does. The rest run across all packages at once.

### Development Commands for Packages

These command are available in each package.

```shell
# Compile the TypeScript sources only (fastest during development)
pnpm run build

# Watch the files and auto build when spotting changes
pnpm run dev

# Build the docs into docs/reference
pnpm run docs

# Run the tests
pnpm run test

# Run the tests and report coverage
pnpm run test:coverage

# Type check the tests without emitting
pnpm run test:build

# Clean, build, validate locales, type check the tests and run them
pnpm run dist

# The same as dist, without running the tests
pnpm run dist:no-test
```

## Code Standards

### Quality Requirements

Before committing code, ensure it meets our quality standards, by running the following from the repo root:

```shell
pnpm run quality
```

This formats the code first, since formatting rewrites the files the later
steps read. It then runs the lint checks alongside the compile chain, as
linting needs no build output, and finishes by validating the locales and
running the tests together. The steps can also be run individually:

```shell
pnpm run format && pnpm run lint && pnpm run dist
```

### Code Style Guidelines

- Use **TypeScript** for all new code
- Follow the existing code style (enforced by Prettier)
- Add **JSDoc comments** for public APIs
- Use **meaningful variable and function names**
- Keep functions **small and focused**
- Write **comprehensive tests** for new features

### Test Coverage

`pnpm run test` runs the tests without instrumentation, which is what `dist` and `quality` use. Use `pnpm run test:coverage` when you want a coverage report. Each package writes its report to `<package>/coverage`, as a summary table in the terminal and as `lcov.info` for tooling. The folder is ignored by git and removed by `pnpm run clean`.

To see the coverage inline while editing, install the [Coverage Gutters](https://marketplace.visualstudio.com/items?itemName=ryanluker.vscode-coverage-gutters) extension, which is already in the workspace recommendations and configured to find the per package `lcov.info` files. Run `Coverage Gutters: Watch` from the command palette once per session and the gutters update after each test run.

## Branch Management

### Branch Strategy

We use a **dual-branch strategy**:

- **`main`** - Production-ready code with stable, published versions
- **`next`** - Development branch where all PRs are merged for testing

### Branch Naming Convention

We follow the [Conventional Branch](https://conventional-branch.github.io/) specification.

Use descriptive names with appropriate prefixes:

| Type          | Format                | Example                         |
| ------------- | --------------------- | ------------------------------- |
| **Features**  | `feature/description` | `feature/user-authentication`   |
| **Bug Fixes** | `bugfix/description`  | `bugfix/memory-leak-fix`        |
| **Hot Fixes** | `hotfix/description`  | `hotfix/security-vulnerability` |
| **Chores**    | `chore/description`   | `chore/update-dependencies`     |
| **Releases**  | `release/description` | `release/v1.2.0`                |

The part after the prefix may only contain lowercase letters, numbers, hyphens
and dots. This is enforced by the `pre-push` hook.

### Branch Workflow

1. **Create a branch** from `next`:

   ```shell
   git checkout next
   git pull origin next
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** and commit following our [commit standards](#commit-standards)

3. **Push your branch** and create a Pull Request targeting `next`

## Commit Standards

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Commit Message Format

```commit
<type>: <description>

[optional body]

[optional footer(s)]
```

### Commit Types

| Type         | Description                  | Example                                      |
| ------------ | ---------------------------- | -------------------------------------------- |
| **feat**     | New feature                  | `feat: add user authentication`              |
| **fix**      | Bug fix                      | `fix: resolve memory leak in data processor` |
| **docs**     | Documentation changes        | `docs: update API reference`                 |
| **style**    | Code style changes           | `style: fix formatting in utils`             |
| **refactor** | Code refactoring             | `refactor: simplify error handling`          |
| **perf**     | Performance improvements     | `perf: optimize database queries`            |
| **test**     | Test additions/modifications | `test: add unit tests for validator`         |
| **build**    | Build system changes         | `build: update webpack config`               |
| **ci**       | CI configuration changes     | `ci: add automated testing`                  |
| **chore**    | Maintenance tasks            | `chore: update dependencies`                 |
| **revert**   | Revert previous commit       | `revert: revert commit abc123`               |

### Commit Examples

```shell
# Good commit messages
git commit -m "feat: add JWT token validation"
git commit -m "fix: prevent endless loop in data lookup"
git commit -m "docs: update installation instructions"

# Bad commit messages (avoid these)
git commit -m "fix stuff"
git commit -m "WIP"
git commit -m "changes"
```

## Pull Request Process

### PR Requirements

- **Target Branch**: Always target `next` branch
- **Title**: Follow commit message format (e.g., `feat: add new feature`)
- **Description**: Provide clear description of changes and motivation
- **Tests**: Include tests for new functionality
- **Documentation**: Update docs if needed

### PR Checklist

Before submitting your PR:

- [ ] Formatting, linting, build and tests all pass (`pnpm run quality`)
- [ ] Documentation updated if needed
- [ ] Commit messages follow conventions
- [ ] PR title follows commit message format

### Review Process

1. **Automated Checks**: The `Build` workflow runs `pnpm run quality` and `pnpm run docs`, and the `PR Name Checker` workflow lints the PR title with commitlint
2. **Code Review**: Maintainers will review your code
3. **Feedback**: Address any requested changes
4. **Approval**: Once approved, your PR will be merged to `next`

## Release Process

The release process is handled by dedicated GitHub Actions workflows. A maintainer triggers the appropriate workflow once, then reviews and merges the generated pull requests at each gate. Publishing starts automatically after the final gated release PR is approved and merged.

### How the gate works

```text
workflow_dispatch  →  prepare PR  →  [review & approve]  →  merge PR  →  publish (auto)
```

The publish phase is gated on the release PR being **approved and merged**. If the PR is closed without merge, publishing is skipped. Nothing is published and no GitHub release is created until the PR clears the gate.

### Next (Prerelease) Versions

For development/beta releases from the `next` branch, use the **`Release Next`** workflow:

1. **Start the Release Next workflow**:
   - Go to `Actions → Release Next → Run workflow`
   - Optionally set `customVersion` (for example `0.1.0`) to reset the `next` branch to `0.1.0-next.0`, leave it blank for a normal prerelease increment

2. **Optional gate – Review the version reset PR**:
   - Only created when `customVersion` is set and the reset produces changes
   - Review and merge it into `next` to let the release continue

3. **Review & Merge**:
   - Review the generated release PR carefully
   - Approve and merge it into `next`

4. **Publishing runs automatically**:
   - Packages are published to npm with the `next` tag
   - GitHub releases are created and marked as prerelease
   - The workspace repository is notified of the published submodule

### Production Versions

For stable releases to the `main` branch, use the **`Release Production`** workflow. One trigger drives the full path end-to-end and pauses at each review boundary until the generated pull request is approved and merged.

1. **Trigger the Release Production workflow**:
   - Go to `Actions → Release Production → Run workflow`
   - Select the version bump: `⬆️ promote next`, `🔧 patch`, `✨ minor`, or `🚀 major`
   - Optionally set `customVersion` (for example `1.2.3`) to release an explicit version, this overrides the version bump

2. **Gate 0 – Review the next-to-main PR**:
   - If `next` is ahead of `main`, the workflow creates a PR that brings the full `next` diff into `main`
   - Review and merge that PR to let the production release continue
   - If `next` and `main` are already aligned, this gate is skipped automatically

3. **Gate 1 – Review the main alignment PR**:
   - The workflow prepares `main` with the release-ready package versions and waits
   - Review and merge the generated alignment PR
   - The workflow advances automatically once the PR is merged

4. **Gate 2 – Review the release PR**:
   - The workflow prepares the versioned release PR (version bumps and changelog) and waits
   - Review the generated release PR carefully
   - Approve and merge it into `main`

5. **Publishing and next-branch realignment run automatically**:
   - Packages are published to npm with the `latest` tag
   - Stable GitHub releases are created
   - The workspace repository is notified of the published submodule
   - `Versions Prepare` is triggered on `next` automatically; review and merge the resulting PR to resume prerelease development from the published version

### Recovery: stale autorelease state

The `Release Next` workflow and the release preparation phase in `Release Production` check for stale state before doing any work and fail immediately with the blocking PR URL if they find one.

If an open release PR still has the `autorelease: pending` label after a cancelled or failed run, a new release cannot be started until that state is cleared. To recover:

1. Find the open PR labelled `autorelease: pending` on the relevant branch
2. Remove the `autorelease: pending` label from that PR, or close the PR if it is no longer needed
3. Re-run `Release Next` or `Release Production`, depending on the release you are preparing

### Version Strategy

| Branch | Purpose             | NPM Tag  | GitHub Release |
| ------ | ------------------- | -------- | -------------- |
| `next` | Development/Testing | `next`   | Prerelease     |
| `main` | Production          | `latest` | Stable         |

## Hotfix Releases

A hotfix releases `main` plus selected cherry-picked fixes, without promoting everything currently on `next`.

### When to use a hotfix

Use a hotfix when all three of these conditions apply:

- The defect affects consumers of the stable (`latest`) line.
- The fix is small, isolated, and already merged and validated on `next`.
- Waiting for the next full platform release is not acceptable for those consumers.

If one or more of these conditions is not met, include the fix in the next full release.

### Hotfix workflow

1. Ensure the fix is merged into `next` first.
2. Run the **Create Hotfix Branch** workflow with:
   - A branch name, for example `hotfix/0.9.1`
   - The comma-separated commit SHAs from `next`, ordered oldest to newest
     The workflow creates the branch from `main` and cherry-picks those commits. If a cherry-pick conflicts, the run fails and no branch is pushed. In that case, prepare the branch manually.
3. Verify the branch builds. Cherry-pick any missing dependent commits manually.
4. Run **Release Production** with `hotfixBranch` set to the branch and either:
   - `semverBump` set to `patch`, `minor`, or `major`, or
   - an explicit `customVersion`
     Do not use `promote next` in hotfix mode. The workflow rejects it because it derives the version from the `next` line while releasing different content.
5. Review and merge the generated PRs in order (merge PR, versions PR, release PR). Before merging the release PR, confirm it has the `hotfix` label.
6. After the release PR is merged, the remaining steps run automatically: publish, GitHub releases, creation of a realignment PR for `next` (versions and changelogs only), and deletion of the hotfix branch.

### Important rules

- The fix must exist on `next`. A fix that exists only on `main` is overwritten by the next full release, because that promotion uses the complete content from `next`. Any commit added directly to the hotfix branch must also be applied to `next`.
- Keep the `hotfix` label on the hotfix release PR. This label prevents post-publish realignment from resetting `next` to `main`.
- Cut the hotfix branch from the current `main`. If the branch is behind `main`, the workflow rejects it to avoid releasing older content. Recreate the branch instead of rebasing around the rejection.
- For multi-repo hotfixes, release repositories in dependency order. For example, release this repository first, then update the dependency in the consumer hotfix branch and release the consumer.

### Recovery

- If publish fails after the release PR is merged: the merged PR keeps the `autorelease: pending` label, and later release attempts are blocked. Change that label to `autorelease: tagged` on the merged PR, then re-run the failed jobs. If the workflow itself changed, start a new workflow dispatch because re-runs use the original workflow snapshot.
- If you abort before the release PR is merged: close the generated PR. Since `main` is only changed by merged PRs, no revert is needed. Delete the stray `release/*` branch and the hotfix branch.
- Version behaviour: hotfix `patch`, `minor`, and `major` bumps are calculated from the production manifest. After release, `next` is moved one patch above the released version automatically (for example, releasing `0.9.1` moves `next` to `0.9.2-next.0`). Divergence across repositories during hotfixes is expected and is resolved at the next platform release by using `customVersion`.

## Documentation

### API Documentation

Documentation is auto-generated from TypeScript comments using **TypeDoc**, run `pnpm run docs` to write it to each package's `docs/reference` folder.

### Documentation Structure

- **Source Comments**: JSDoc comments in TypeScript source files
- **Package Docs**: Additional content in each package's `docs/` folder
- **Auto-Generation**: Built documentation is merged into the main docs site

### Development Tips

1. **Use meaningful commit messages** - they become part of the changelog
2. **Write comprehensive tests** - helps prevent regressions
3. **Keep PRs focused** - smaller PRs are easier to review and merge
4. **Update documentation** - help others understand your changes
5. **Follow conventions** - consistency makes the codebase maintainable
6. **Test locally** - run the full build before pushing

---

**Thank you for contributing!** Your efforts help make this project better for everyone. 🚀
