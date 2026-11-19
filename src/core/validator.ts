import { isConfigDefinition } from './config-definition.js';
import type { ConfigDefinition } from './config-definition.js';
import { ConfigValidationError, type ConfigIssue } from './errors.js';
import { normalizeDefinitions } from './normalize.js';

export interface StrictConfigOptions {
  readonly mode?: 'error' | 'warn';
  readonly prefix?: string | readonly string[];
  readonly ignore?: readonly string[];
}
export type StrictOption = boolean | StrictConfigOptions;

export interface ValidateConfigsOptions {
  readonly strict?: StrictOption;
  readonly fileSecretSuffix?: string;
  readonly origins?: Readonly<Record<string, string>>;
  readonly envFileKeys?: readonly string[];
}

export interface ValidateConfigsResult {
  readonly configs: Readonly<Record<string, unknown>>;
  readonly warnings: readonly string[];
}

function matchesPrefix(key: string, prefix: string | readonly string[] | undefined): boolean {
  if (prefix === undefined) return true;
  const prefixes = typeof prefix === 'string' ? [prefix] : prefix;
  return prefixes.some((item) => key.startsWith(item));
}

function strictIssues(
  definitions: readonly ConfigDefinition[],
  rawEnv: Readonly<Record<string, unknown>>,
  strict: StrictOption,
  suffix: string,
  origins?: Readonly<Record<string, string>>,
  envFileKeys?: readonly string[],
): readonly ConfigIssue[] {
  if (!strict) return [];
  const options = typeof strict === 'boolean' ? {} : strict;
  const known = new Set<string>();
  for (const definition of definitions) {
    for (const field of definition.describeFields()) {
      known.add(field.key);
      known.add(field.key.toUpperCase());
      known.add(`${field.key}${suffix}`);
      known.add(`${field.key.toUpperCase()}${suffix}`);
    }
  }
  const ignored = new Set(options.ignore ?? []);
  const fileKeys = new Set(envFileKeys ?? []);
  return Object.keys(rawEnv)
    .filter((key) => matchesPrefix(key, options.prefix))
    .filter((key) => !(origins?.[key] === 'process.env' && !fileKeys.has(key) && options.prefix === undefined))
    .filter((key) => !known.has(key) && !ignored.has(key))
    .map((key) => ({
      configName: 'env',
      key,
      path: [key],
      code: 'unknown_key',
      message: `Unknown environment variable "${key}"`,
    }));
}

export function validateConfigs(
  definitionsInput: ConfigDefinition | readonly ConfigDefinition[],
  rawEnv: Readonly<Record<string, unknown>>,
  options: ValidateConfigsOptions = {},
): ValidateConfigsResult {
  const definitions = normalizeDefinitions(definitionsInput);
  const configs: Record<string, unknown> = {};
  const issues: ConfigIssue[] = [];
  const warnings: string[] = [];

  for (const definition of definitions) {
    const result = definition.safeParse(rawEnv);
    if (result.success) configs[definition.name] = result.data;
    else issues.push(...result.issues);
  }

  const strict = options.strict;
  if (strict) {
    const extra = strictIssues(
      definitions,
      rawEnv,
      strict,
      options.fileSecretSuffix ?? '_FILE',
      options.origins,
      options.envFileKeys,
    );
    if (typeof strict === 'object' && strict.mode === 'warn') {
      warnings.push(...extra.map((issue) => issue.message));
    } else {
      issues.push(...extra);
    }
  }

  if (issues.length) throw new ConfigValidationError(issues);
  return Object.freeze({ configs: Object.freeze(configs), warnings: Object.freeze(warnings) });
}

export function assertConfigDefinitions(value: unknown): asserts value is readonly ConfigDefinition[] {
  const definitions = Array.isArray(value) ? value : [value];
  if (!definitions.every(isConfigDefinition)) {
    throw new TypeError('Expected ConfigDefinition or an array of ConfigDefinition values');
  }
}
