export interface ParsedArgs {
  readonly command?: string;
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, string | boolean | readonly string[]>>;
  readonly commandArgs: readonly string[];
}

const BOOLEAN_OPTIONS = new Set([
  'help', 'version', 'expand', 'file-secrets', 'strict', 'no-process-env', 'json', 'quiet',
  'q', 'check', 'stdout', 'show-values', 'exit-code', 'show-secrets', 'force',
]);
const VALUE_OPTIONS = new Set(['config', 'c', 'env-file', 'e', 'out', 'inject']);
const SHORT_NAMES: Readonly<Record<string, string>> = Object.freeze({ c: 'config', e: 'env-file', q: 'quiet' });

function isReadonlyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

export function normalizeStringList(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return isReadonlyStringArray(value) ? value : [value];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const commandArgs: string[] = [];
  const options: Record<string, string | boolean | readonly string[]> = {};
  let afterSeparator = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (afterSeparator) {
      commandArgs.push(token);
      continue;
    }
    if (token === '--') {
      afterSeparator = true;
      continue;
    }
    if (token === '--no-process-env') {
      options['no-process-env'] = true;
      continue;
    }
    if (token.startsWith('--no-')) {
      options[token.slice(5)] = false;
      continue;
    }
    if (token.startsWith('--')) {
      const equalIndex = token.indexOf('=');
      const rawName = token.slice(2, equalIndex < 0 ? undefined : equalIndex);
      const name = SHORT_NAMES[rawName] ?? rawName;
      const inlineValue = equalIndex >= 0 ? token.slice(equalIndex + 1) : undefined;
      if (BOOLEAN_OPTIONS.has(name) || BOOLEAN_OPTIONS.has(rawName)) {
        options[name] = inlineValue === undefined ? true : inlineValue !== 'false';
      } else if (VALUE_OPTIONS.has(name)) {
        const nextValue = inlineValue ?? argv[index + 1];
        if (inlineValue === undefined && nextValue !== undefined && !nextValue.startsWith('-')) index += 1;
        if (nextValue !== undefined) {
          const existing = options[name];
          options[name] = typeof existing === 'string' ? [existing, nextValue] : isReadonlyStringArray(existing) ? [...existing, nextValue] : nextValue;
        }
      } else {
        options[name] = inlineValue ?? true;
      }
      continue;
    }
    if (token.startsWith('-') && token.length === 2) {
      const rawName = token.slice(1);
      const name = SHORT_NAMES[rawName] ?? rawName;
      if (BOOLEAN_OPTIONS.has(name)) options[name] = true;
      else {
        const nextValue = argv[index + 1];
        if (nextValue !== undefined && !nextValue.startsWith('-')) index += 1;
        if (nextValue !== undefined) {
          const existing = options[name];
          options[name] = typeof existing === 'string'
            ? [existing, nextValue]
            : isReadonlyStringArray(existing)
              ? [...existing, nextValue]
              : nextValue;
        }
      }
      continue;
    }
    positionals.push(token);
  }

  return Object.freeze({
    ...(positionals[0] ? { command: positionals[0] } : {}),
    positionals: Object.freeze(positionals.slice(positionals.length > 0 ? 1 : 0)),
    options: Object.freeze(options),
    commandArgs: Object.freeze(commandArgs),
  });
}

export function getOptionString(options: ParsedArgs['options'], ...names: string[]): string | undefined {
  for (const name of names) {
    const value = options[name];
    if (typeof value === 'string') return value;
    if (isReadonlyStringArray(value)) return value[value.length - 1];
  }
  return undefined;
}

export function hasOption(options: ParsedArgs['options'], ...names: string[]): boolean {
  return names.some((name) => options[name] === true || typeof options[name] === 'string' || Array.isArray(options[name]));
}
