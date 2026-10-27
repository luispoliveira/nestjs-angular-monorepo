# github-actions-ci Specification

## Purpose

Runs the monorepo quality gate automatically on pull requests and pushes to main and develop, with dependency and build caching to keep runs fast.

## Requirements

### Requirement: Workflow triggers on PR and push
The CI workflow SHALL run automatically on `pull_request` events targeting `main` or `develop`, and on `push` events to `main` or `develop`.

#### Scenario: PR opened against develop
- **WHEN** a pull request is opened or synchronised targeting `develop`
- **THEN** the quality-gate job starts within GitHub Actions

#### Scenario: Push to main
- **WHEN** a commit is pushed directly to `main`
- **THEN** the quality-gate job starts within GitHub Actions

### Requirement: Concurrent runs on the same ref are cancelled
The workflow SHALL use a `concurrency` group keyed on workflow name + ref, with `cancel-in-progress: true`, so a new push to the same PR cancels the in-flight run.

#### Scenario: Second push while first run is in progress
- **WHEN** a second commit is pushed to an open PR while a CI run is already executing
- **THEN** the older run is cancelled and the newer run proceeds

### Requirement: Quality gate steps run in order
The quality-gate job SHALL execute these steps in sequence: install deps → generate Prisma client → lint → type-check → build → test. A failure in any step SHALL mark the job as failed and stop execution.

#### Scenario: Type error present in a PR
- **WHEN** a PR introduces a TypeScript type error
- **THEN** the `check-types` step exits non-zero and the job is marked failed

#### Scenario: All steps pass
- **WHEN** all commands exit zero
- **THEN** the job is marked successful and GitHub marks the PR check as passed

### Requirement: pnpm store is cached across runs
The workflow SHALL use `actions/setup-node` with `cache: pnpm` so the pnpm content-addressable store is restored from cache on subsequent runs, reducing install time.

#### Scenario: Second run on same branch
- **WHEN** the workflow runs a second time with an unchanged lockfile
- **THEN** `pnpm install` resolves packages from cache rather than downloading them

### Requirement: Turborepo output cache is persisted
The workflow SHALL use `actions/cache` to save and restore the `.turbo/` directory, keyed on `runner.os + github.sha` with a fallback restore key on `runner.os`.

#### Scenario: Unchanged packages on re-run
- **WHEN** only one package changes between two runs on the same branch
- **THEN** Turborepo restores cached outputs for unchanged packages

### Requirement: Prisma client generation does not require a live database
The `pnpm db:generate` step SHALL succeed without any database connection, relying solely on the Prisma schema files present in the repository.

#### Scenario: CI environment with no Postgres service
- **WHEN** no `services:` container is configured in the workflow
- **THEN** `pnpm db:generate` completes successfully and the generated client is available for subsequent build and type-check steps
