# Changelog

All notable changes to this project are documented in this file.

## 1.0.0 — 2026-11-18

First stable release of `@octokern/config`.

- Added zero-mandatory-runtime-dependency configuration core and `@octokern/config/core` entry point.
- Added immutable typed schema builder `v`, Zod 3/4, Joi and Standard Schema v1 adapters.
- Added `ConfigDefinition`, atomic multi-config validation, strict-key checks, typo suggestions and secret redaction.
- Added dotenv parsing, variable expansion, cascading environment files, file secrets and source tracking.
- Added NestJS 10, 11 and 12 integration with root, async, feature and test registration, typed injection and immutable snapshots.
- Added the `config` CLI and retained `fastconfig` as a compatibility alias; includes `check`, `example`, `docs`, `diff`, `inspect`, `init` and `run`.
- Added dual ESM/CommonJS builds, package smoke checks, GitHub Actions CI, release automation and repository contribution/security templates.
- Hardened typed ESLint project scoping, Node ESM config-file linting and safe formatting of structured config values.

## 0.1.0 — development baseline

- Implemented the initial schema, core, environment source, NestJS and CLI functionality.
- Normalized inferred object types and added typo suggestions for common transposed env keys.
