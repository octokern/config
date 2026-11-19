# Release audit — @octokern/config 1.0.0

## Release metadata

- Package: `@octokern/config`
- Version: `1.0.0`
- Canonical CLI executable: `config` (`npx @octokern/config <command>`); `fastconfig` remains a compatibility alias.
- Runtime dependencies: none. NestJS, `reflect-metadata` and `rxjs` are optional peers. Zod and Joi are structural integrations.
- Node.js engine: `>=22.12.0`; CI tests Node 22, 24 and 26.
- NestJS peer support: `^10 || ^11 || ^12`, with a dedicated CI compatibility matrix.

## Release hardening included

- Added MIT `LICENSE` and release notes for `1.0.0`.
- Added version-aware CLI build output so Changesets release versions are reflected in `config --version`.
- Added npm package file allowlist including `dist`, `bin`, README, CHANGELOG and LICENSE.
- Added `npm pack` dry-run validation to `prepublishOnly` and CI.
- Added ESM and CommonJS consumer smoke tests in CI.
- Added GitHub issue forms, issue config, pull request template, Discussions templates, label synchronization workflow, Code of Conduct, Contributing, Security and Support policies.
- Added Node LTS CI, NestJS 10/11/12 compatibility workflow, CodeQL and dependency review workflows, Dependabot and Changesets v2 split version/pack/publish workflow with job-scoped npm OIDC and automatic GitHub Releases.
- Documented the one-time authenticated npm bootstrap publish required before a Trusted Publisher can be configured; subsequent releases use the OIDC workflow.

## Compatibility notes

NestJS 12 core packages are ESM-only. Nest's migration guidance lists Node.js 20.19+ or 22.12+ for Nest 12 and notes that CommonJS use relies on unflagged `require(esm)`. This package deliberately sets its supported engine baseline to Node.js 22.12+ because Node.js 18 and 20 are EOL as of this release. Supported LTS CI lines are Node 22, 24 and 26.

npm Trusted Publishing requires npm CLI 11.5.1+ and Node.js 22.14+. The release workflow runs on Node.js 24 and installs npm 11.5.1+ before its OIDC publish step. npm's trusted publisher configuration must be created after the package exists in the registry; therefore the first 1.0.0 upload is documented as a one-time authenticated maintainer publish without provenance, and future releases use OIDC provenance.

## Verification boundaries

The input project previously passed the owner's local `pnpm typecheck`, `pnpm test` and `pnpm run build` after the `InferShape` and typo-suggestion fixes. In this build environment, project `node_modules` are not installed and the Corepack pnpm shim cannot download from the npm registry; therefore the final dependency-backed typecheck, ESLint, Vitest suite and live NestJS 10/11/12 matrix could not be rerun here.

The final npm tarball is built and installed into a temporary consumer in offline mode. ESM and CommonJS imports of `@octokern/config/core`, CommonJS TypeScript declaration resolution, both installed CLI aliases and `--version` were smoke-tested. GitHub YAML, issue form metadata, Discussion form fields and label references were structurally validated. Source architecture checks confirmed `.js` relative imports, no filesystem/NestJS imports from `src/core`, no NestJS imports from CLI, and no `import.meta.url` / `__dirname` in `src`. The final ZIP archive integrity is checked locally. These checks do not substitute for the full dependency-backed CI matrix.

## Before publishing

1. Push the source archive to `octokern/config` and verify the CI and NestJS compatibility workflows.
2. Check `npm view @octokern/config version`. If the package does not exist, publish `1.0.0` once from an authenticated maintainer terminal; if it already exists, do not duplicate the initial version. Then configure npm Trusted Publishing. npm requires the package to exist before a publisher can be configured. Use workflow filename `release.yml` only, repository `octokern/config`, GitHub environment `npm`, and enable direct `npm publish`.
3. Allow GitHub Actions to create and approve pull requests; create the `npm` GitHub environment and protect `main` with required checks.
4. Enable GitHub Discussions and create category slugs `q-a` and `ideas`; run `Sync labels` once (or push `.github/labels.json`).
5. Complete the first OIDC publish within two days after creating the Trusted Publisher. Create Changesets for subsequent releases.
