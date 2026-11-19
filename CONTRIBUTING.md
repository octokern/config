# Contributing

Thank you for helping improve `@octokern/config`.

## Before opening an issue

- Search existing issues and discussions to avoid duplicates.
- For security vulnerabilities, do not open a public issue. Follow [SECURITY.md](SECURITY.md).
- For usage questions, use GitHub Discussions when available.

## Development setup

Requirements: Node.js `>=22.12.0` and pnpm 10.

```bash
git clone https://github.com/octokern/config.git
cd config
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

## TypeScript / ESLint compatibility

Keep the development compiler on TypeScript `~6.0.3` while the configured `typescript-eslint` 8.x release requires the TypeScript 6 JavaScript API (`>=4.8.4 <6.1.0`). TypeScript 7.0 uses a different compiler implementation/API and currently causes `pnpm lint` to fail when resolved as the `typescript` package. Do not widen this dependency to `^7` until upstream TypeScript 7 support is available. This is a development-tooling constraint only; it does not restrict TypeScript versions used by consumers of `@octokern/config`.

## Change process

1. Create a focused branch from `main`.
2. Keep changes scoped and preserve the existing source-layer dependency direction.
3. Add or update tests for behavior and public type changes.
4. Add a Changeset for user-facing changes:

   ```bash
   pnpm changeset
   ```

5. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm pack:check`. Use `pnpm format` to apply the repository formatter when editing source or test files.
6. Open a pull request and complete the checklist in the pull request template.

## Code guidelines

- TypeScript must remain strict; avoid `any` and unsafe casts.
- Keep the core entry point independent of NestJS and filesystem APIs that are not required by the core.
- Keep runtime dependencies at zero. Optional integrations must remain optional peers or structural adapters.
- Relative TypeScript imports must use `.js` extensions.
- Do not add internal `index.ts` barrel files beneath `src/`.
- Do not commit generated secrets, `.env` files, `node_modules` or local build artifacts.

## Compatibility changes

The GitHub Actions workflows test supported Node.js LTS lines and NestJS 10, 11 and 12. Update the compatibility workflow when changing peer ranges or the minimum Node.js version.
