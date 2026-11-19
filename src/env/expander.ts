import { ConfigSourceError } from '../core/errors.js';

export interface ExpandVariablesOptions {
  readonly protectedKeys?: ReadonlySet<string>;
  readonly singleQuotedKeys?: ReadonlySet<string>;
  readonly origins?: Readonly<Record<string, string>>;
}

const ESCAPED_DOLLAR = '\u0000OCTOKERN_ESCAPED_DOLLAR\u0000';
const VARIABLE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([-?])([^}]*))?\}/g;

export function expandVariables(
  environment: Readonly<Record<string, string | undefined>>,
  options: ExpandVariablesOptions = {},
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = { ...environment };
  const resolved = new Map<string, string | undefined>();
  const active = new Set<string>();
  const protectedKeys = options.protectedKeys ?? new Set<string>();
  const singleQuoted = options.singleQuotedKeys ?? new Set<string>();

  const resolve = (key: string): string | undefined => {
    if (resolved.has(key)) return resolved.get(key);
    const raw = environment[key];
    if (raw === undefined) return undefined;
    if (protectedKeys.has(key) || singleQuoted.has(key)) {
      resolved.set(key, raw);
      return raw;
    }
    if (active.has(key)) {
      const chain = [...active, key].join(' -> ');
      throw new ConfigSourceError(`Circular environment variable expansion detected: ${chain}`, options.origins?.[key]);
    }
    active.add(key);
    const escaped = raw.replace(/\\\$/g, ESCAPED_DOLLAR);
    const expanded = escaped.replace(VARIABLE_PATTERN, (match, variable: string, operator: string | undefined, fallback: string | undefined) => {
      const referenced = resolve(variable);
      const empty = referenced === undefined || referenced === '';
      if (operator === '-' && empty) return fallback ?? '';
      if (operator === '?' && empty) {
        throw new ConfigSourceError(fallback || `Environment variable ${variable} is required`, options.origins?.[key]);
      }
      return referenced ?? '';
    }).replaceAll(ESCAPED_DOLLAR, '$');
    active.delete(key);
    resolved.set(key, expanded);
    return expanded;
  };

  for (const key of Object.keys(environment)) {
    if (!protectedKeys.has(key) && !singleQuoted.has(key)) result[key] = resolve(key);
  }
  return result;
}
