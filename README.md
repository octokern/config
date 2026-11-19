# @octokern/config

Zero-runtime-dependency, type-safe environment configuration for Node.js and NestJS. The package includes an immutable schema builder, synchronous fail-fast validation, dotenv sources, secret-file resolution and a CLI. NestJS, Zod and Joi remain optional integrations.

## Requirements

- Node.js `>=22.12.0` (supported LTS lines: 22, 24 and 26)
- TypeScript `strict` mode recommended
- NestJS `^10`, `^11` or `^12` when using the Nest integration

## Install

```bash
pnpm add @octokern/config
# Optional, only when using NestJS:
pnpm add @nestjs/common reflect-metadata rxjs
# Optional schema validators:
pnpm add zod
# or
pnpm add joi
```

The package has no mandatory runtime dependencies. Use `@octokern/config/core` in CLI scripts, Node.js applications and environments where NestJS is not installed. The root import also exports the NestJS integration and therefore requires the optional NestJS peer packages at runtime.

## Define a config

```ts
import { defineEnvConfig, v } from '@octokern/config/core';

export const appConfig = defineEnvConfig('app', {
  PORT: v.port().default(3000),
  HOST: v.string().default('127.0.0.1'),
  NODE_ENV: v.enum(['development', 'test', 'production'] as const)
    .default('development'),
  DATABASE_URL: v.string().url().secret(),
  FEATURE_FLAGS: v.list(v.enum(['billing', 'reports'] as const)),
});

export type AppConfig = import('@octokern/config/core').ConfigOf<typeof appConfig>;
```

`v.infer<typeof schema>` and `InferShape<typeof shape>` are also available. Optional schema members become optional object keys in inferred output types.

## Validate in Node.js

```ts
import {
  validateConfigs,
  resolveEnvWithSources,
} from '@octokern/config/core';
import { appConfig } from './app.def.js';

const source = resolveEnvWithSources({
  envName: process.env.NODE_ENV,
  expandVariables: true,
  fileSecrets: true,
});

const { configs } = validateConfigs([appConfig], source.env);
const app = configs.app as import('@octokern/config/core').ConfigOf<typeof appConfig>;
console.log(app.PORT);
```

Validation is synchronous. Synchronous Zod 3/4, Joi and Standard Schema v1 implementations can be used without importing them from this package. Asynchronous Standard Schema validators are rejected with an explicit issue because module initialization and the built-in validation API are synchronous.

## NestJS

```ts
import { Module } from '@nestjs/common';
import { FastConfigModule, InjectConfig } from '@octokern/config';
import { appConfig } from './app.def.js';

@Module({
  imports: [FastConfigModule.forRoot({ load: [appConfig], isGlobal: true })],
})
export class AppModule {}

class AppService {
  constructor(@InjectConfig(appConfig) readonly config: import('@octokern/config/core').ConfigOf<typeof appConfig>) {}
}
```

`FastConfigModule.forRoot()` validates synchronously. `forRootAsync()` accepts a static `load` list and an asynchronous `useFactory` for environment-source options. `forTest()` intentionally ignores the ambient `process.env` and accepts string-coerced test values and definition overrides.

## Environment sources

The source priority is:

1. `options.env` (or `process.env` when `env` is omitted),
2. dotenv files in the supplied order (the first file wins),
3. `*_FILE` values when file-secret loading is enabled.

`resolveEnvFilePaths({ envName, cwd })` returns the conventional cascade: `.env.<env>.local`, `.env.local` (except in `test`), `.env.<env>`, `.env`. Missing files are ignored; other read errors become `ConfigSourceError`.

```ts
const source = resolveEnvWithSources({
  envName: 'production',
  expandVariables: true,
  fileSecrets: { suffix: '_FILE' },
});
// source.env, source.origins, source.loadedFiles, source.fileSecretTargets
```

Expansion supports `${VAR}`, `${VAR:-fallback}`, `${VAR:?message}` and escaped `\$`. Single-quoted dotenv values and values supplied by the runtime environment are not expanded. File-secret contents are read before expansion and remain literal values.

## CLI

The canonical executable is `config` (matching the package name). The previous `fastconfig` command remains available as a compatibility alias. Package-runner usage is:

```bash
npx @octokern/config --help
npx @octokern/config check --config src/app.def.ts --expand --file-secrets
npx @octokern/config example --out .env.example
npx @octokern/config docs --out ENV.md
npx @octokern/config diff .env .env.production
npx @octokern/config inspect --json
npx @octokern/config init --out .env --force
npx @octokern/config run -- node dist/main.js
```

Config discovery searches for `*.def.{ts,js,mts,cts,mjs,cjs}` while skipping `node_modules`, `dist`, `.git` and `coverage`. Native Node TypeScript loading is attempted first; install `jiti` or `tsx` in the consuming project as a fallback on runtimes that cannot load the chosen TypeScript syntax natively.

Commands:

- `check`: validate config without bootstrapping NestJS (`--config`, repeatable `--env-file`, `--expand`, `--file-secrets`, `--strict`, `--no-process-env`, `--json`, `--quiet`).
- `example`: create `.env.example`; supports field metadata, `--out`, `--stdout`, `--check`.
- `docs`: generate an environment-variable Markdown table; supports `--out`, `--stdout`, `--inject README.md` and the `<!-- fastconfig:start -->` / `<!-- fastconfig:end -->` markers.
- `diff`: compare dotenv files; secret values are masked, including when `--show-values` is requested. `--json` and `--exit-code` are supported.
- `inspect`: show parsed values and origins; supports `--show-secrets` and `--json`.
- `init`: write a private `.env`, fill metadata/defaults and generate cryptographically random values for secret fields; existing files require `--force`.
- `run`: validate before starting the requested child process.

`NO_COLOR` disables ANSI colors.

## Build and test

```bash
pnpm run typecheck
pnpm test
pnpm run build
node bin/octokernconfig.mjs --help
```

The ESM build is emitted to `dist/esm`, the CommonJS build to `dist/cjs`. `@octokern/config/core` is the Nest-free entry point.

## Compatibility matrix

The CI suite verifies NestJS 10, 11 and 12 independently. The core entry point (`@octokern/config/core`) does not load NestJS and remains usable without installing any NestJS packages. The root entry point (`@octokern/config`) exposes the NestJS integration and therefore requires the optional NestJS peer packages when imported.

NestJS 12 ships its core packages as ESM. This package provides both ESM and CommonJS builds; CommonJS consumers must run on a Node.js release with unflagged `require(esm)` support. The package baseline is Node.js `>=22.12.0`.

## Release and security

After the initial bootstrap, releases are versioned with Changesets and published from GitHub Actions using npm Trusted Publishing (OIDC) with npm `11.5.1+`; no long-lived `NPM_TOKEN` is needed for automated releases. npm requires the package to exist before a Trusted Publisher can be configured, so the first `1.0.0` version is published once by an authenticated maintainer. After that, configure the publisher for repository `octokern/config`, workflow filename `release.yml` (filename only), GitHub environment `npm`, and allow direct `npm publish`. The publish job runs on Node.js 24, grants `id-token: write` only to the isolated publishing job, and uses the GitHub-provided token for tags and Releases. Create the `npm` GitHub environment and allow GitHub Actions to create pull requests in repository settings. See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for the full bootstrap and release steps.

The repository includes issue forms, pull-request templates and Discussion forms. Enable GitHub Discussions in repository settings and create categories whose slugs are `q-a` and `ideas` so the matching files in `.github/DISCUSSION_TEMPLATE/` are activated. The `Sync labels` workflow creates or updates the labels referenced by issue forms when `.github/labels.json` changes (it can also be run manually).

Please report vulnerabilities privately using GitHub's **Report a vulnerability** feature; do not open public issues for security reports. See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) and [SUPPORT.md](SUPPORT.md).

