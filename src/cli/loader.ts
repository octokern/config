import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { isConfigDefinition, type ConfigDefinition } from '../core/config-definition.js';
import { normalizeDefinitions } from '../core/normalize.js';

const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'coverage', '.next', '.turbo']);
const CONFIG_PATTERN = /\.def\.(?:ts|js|mts|cts|mjs|cjs)$/i;

export interface LoadConfigOptions {
  readonly cwd?: string;
  readonly config?: string;
}

function findConfigFiles(directory: string, files: string[] = []): readonly string[] {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); }
  catch { return files; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) findConfigFiles(path.join(directory, entry.name), files);
    } else if (entry.isFile() && CONFIG_PATTERN.test(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

async function importWithNativeLoader(filePath: string): Promise<unknown> {
  return import(pathToFileURL(filePath).href) as Promise<unknown>;
}

function importWithFallback(filePath: string, cwd: string): unknown {
  const require = createRequire(path.resolve(cwd, 'package.json'));
  try {
    const jitiModule = require('jiti') as unknown;
    const jitiRecord = jitiModule !== null && typeof jitiModule === 'object' ? jitiModule as Record<string, unknown> : undefined;
    const jitiFactory = typeof jitiModule === 'function' ? jitiModule : jitiRecord?.default;
    if (typeof jitiFactory === 'function') {
      const loader = (jitiFactory as (cwd: string, options: Record<string, unknown>) => (file: string) => unknown)(cwd, { interopDefault: true });
      return loader(filePath);
    }
  } catch { /* try tsx next */ }
  try {
    const tsxApi = require('tsx/cjs/api') as Record<string, unknown>;
    const register = tsxApi.register;
    if (typeof register === 'function') {
      (register as () => void)();
      return require(filePath) as unknown;
    }
  } catch { /* no TS runtime loader installed */ }
  throw new Error(`Unable to load TypeScript config "${filePath}". Use Node >=22.12 with native type stripping, or install optional dev dependency "jiti" or "tsx".`);
}

async function importConfig(filePath: string, cwd: string): Promise<unknown> {
  if (!/\.(?:ts|mts|cts)$/i.test(filePath)) return importWithNativeLoader(filePath);
  try {
    return await importWithNativeLoader(filePath);
  } catch (error) {
    const code = error !== null && typeof error === 'object' && 'code' in error
      ? (error as { readonly code?: unknown }).code
      : undefined;
    if (code !== 'ERR_UNKNOWN_FILE_EXTENSION' && code !== 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' && code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return importWithFallback(filePath, cwd);
  }
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function extractDefinitions(moduleValue: unknown): readonly ConfigDefinition[] {
  const moduleRecord = moduleValue !== null && typeof moduleValue === 'object'
    ? moduleValue as Record<string, unknown>
    : undefined;
  const candidates: unknown[] = [];
  if (isConfigDefinition(moduleValue)) candidates.push(moduleValue);
  if (moduleRecord) {
    for (const key of ['default', 'config', 'configs', 'definitions', 'load']) {
      const candidate = moduleRecord[key];
      if (isConfigDefinition(candidate)) candidates.push(candidate);
      else if (isUnknownArray(candidate)) {
        for (const item of candidate) candidates.push(item);
      }
    }
    for (const [key, candidate] of Object.entries(moduleRecord)) {
      if (!['default', 'config', 'configs', 'definitions', 'load'].includes(key) && isConfigDefinition(candidate)) candidates.push(candidate);
    }
  }
  return normalizeDefinitions(candidates);
}

export async function loadConfigDefinitions(options: LoadConfigOptions = {}): Promise<readonly ConfigDefinition[]> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const paths = options.config
    ? [path.resolve(cwd, options.config)]
    : [...findConfigFiles(cwd)].sort((left, right) => left.localeCompare(right));
  if (paths.length === 0) throw new Error(`No *.def.{ts,js,mts,cts,mjs,cjs} config file found in ${cwd}. Pass --config <path>.`);
  const all: ConfigDefinition[] = [];
  for (const filePath of paths) {
    const loaded = await importConfig(filePath, cwd);
    all.push(...extractDefinitions(loaded));
  }
  return normalizeDefinitions(all);
}
