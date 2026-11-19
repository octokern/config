import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { ConfigSourceError } from '../core/errors.js';
import { expandVariables } from './expander.js';
import { parseDotenvDetailed } from './dotenv-parser.js';
import { resolveFileSecrets, type FileSecretsOptions } from './file-secrets.js';

export interface ResolveEnvFilePathsOptions {
  readonly envName?: string;
  readonly cwd?: string;
}

export interface EnvSourceOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly envFiles?: string | readonly string[];
  readonly envFile?: string | readonly string[];
  readonly envName?: string;
  readonly expandVariables?: boolean;
  readonly fileSecrets?: boolean | FileSecretsOptions;
  readonly noProcessEnv?: boolean;
}

export interface ResolveEnvResult {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly origins: Readonly<Record<string, string>>;
  readonly loadedFiles: readonly string[];
  readonly fileSecretTargets: readonly string[];
  readonly envFileKeys: readonly string[];
}

export function resolveEnvFilePaths(options: ResolveEnvFilePathsOptions = {}): readonly string[] {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const envName = options.envName;
  const names: string[] = [];
  if (envName) names.push(`.env.${envName}.local`);
  if (envName !== 'test') names.push('.env.local');
  if (envName) names.push(`.env.${envName}`);
  names.push('.env');
  return Object.freeze(names.map((name) => path.resolve(cwd, name)));
}

function normalizeFileList(files: string | readonly string[] | undefined, options: ResolveEnvFilePathsOptions): readonly string[] {
  if (files === undefined) return resolveEnvFilePaths(options);
  return Object.freeze((typeof files === 'string' ? [files] : [...files]).map((file) => path.isAbsolute(file) ? file : path.resolve(options.cwd ?? process.cwd(), file)));
}

export function resolveEnvWithSources(options: EnvSourceOptions = {}): ResolveEnvResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const hasExplicitEnvironment = options.env !== undefined;
  const processEnvironment = hasExplicitEnvironment
    ? { ...options.env }
    : options.noProcessEnv ? {} : { ...process.env };
  const runtimeEnvironmentOrigin = hasExplicitEnvironment ? 'options.env' : 'process.env';
  const protectedKeys = new Set(Object.entries(processEnvironment).filter((entry) => entry[1] !== undefined).map(([key]) => key));
  const files = normalizeFileList(options.envFiles ?? options.envFile, { ...(options.envName ? { envName: options.envName } : {}), cwd });
  const merged: Record<string, string | undefined> = {};
  const origins: Record<string, string> = {};
  const singleQuoted = new Set<string>();
  const loadedFiles: string[] = [];
  const envFileKeys = new Set<string>();

  // Files are ordered from highest to lowest precedence; keep the first occurrence of each key.
  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error
        ? (error as { readonly code?: unknown }).code
        : undefined;
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      throw new ConfigSourceError(
        `Unable to read environment file "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
        filePath,
        { cause: error },
      );
    }
    const parsed = parseDotenvDetailed(content);
    loadedFiles.push(filePath);
    for (const [key, value] of Object.entries(parsed.values)) {
      envFileKeys.add(key);
      if (!Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[key] = value;
        origins[key] = filePath;
        if (parsed.singleQuoted.has(key)) singleQuoted.add(key);
      }
    }
  }

  // Runtime environment is the highest-precedence source.
  for (const [key, value] of Object.entries(processEnvironment)) {
    if (value !== undefined) {
      merged[key] = value;
      origins[key] = runtimeEnvironmentOrigin;
      singleQuoted.delete(key);
    }
  }

  let fileSecretTargets: readonly string[] = [];
  if (options.fileSecrets) {
    const secretOptions = options.fileSecrets === true ? {} : options.fileSecrets;
    const resolvedSecrets = resolveFileSecrets(merged, secretOptions, cwd, protectedKeys);
    fileSecretTargets = resolvedSecrets.targets;
    Object.assign(merged, resolvedSecrets.env);
    Object.assign(origins, resolvedSecrets.origins);
  }

  if (options.expandVariables) {
    const expansionProtectedKeys = new Set([...protectedKeys, ...fileSecretTargets]);
    const expanded = expandVariables(merged, {
      protectedKeys: expansionProtectedKeys,
      singleQuotedKeys: singleQuoted,
      origins,
    });
    for (const [key, value] of Object.entries(expanded)) {
      if (value !== merged[key] && !expansionProtectedKeys.has(key) && !singleQuoted.has(key)) origins[key] = origins[key] ?? 'expanded';
      merged[key] = value;
    }
  }

  return Object.freeze({
    env: Object.freeze({ ...merged }),
    origins: Object.freeze({ ...origins }),
    loadedFiles: Object.freeze(loadedFiles),
    fileSecretTargets: Object.freeze([...fileSecretTargets]),
    envFileKeys: Object.freeze([...envFileKeys]),
  });
}

export function resolveEnv(options: EnvSourceOptions = {}): Readonly<Record<string, string | undefined>> {
  return resolveEnvWithSources(options).env;
}
