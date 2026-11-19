import { color, formatTable, formatValue } from '../format.js';
import { hasOption } from '../args.js';
import type { CommandContext } from './shared.js';
import { loadDefinitions, resolveSources } from './shared.js';

interface InspectEntry {
  readonly config: string;
  readonly key: string;
  readonly value: unknown;
  readonly source: string;
  readonly secret: boolean;
}

export async function inspectCommand(context: CommandContext): Promise<void> {
  const definitions = await loadDefinitions(context);
  const source = resolveSources(context.args);
  const showSecrets = hasOption(context.args.options, 'show-secrets');
  const entries: InspectEntry[] = [];
  for (const definition of definitions) {
    const parsed = definition.safeParse(source.env);
    const configValue = parsed.success && parsed.data !== null && typeof parsed.data === 'object'
      ? parsed.data as Record<string, unknown>
      : {};
    for (const field of definition.describeFields()) {
      const rawKey = Object.prototype.hasOwnProperty.call(source.env, field.key)
        ? field.key
        : field.key.toUpperCase();
      const hasRaw = source.env[rawKey] !== undefined;
      const origin = source.origins[rawKey];
      const rawValue = hasRaw ? source.env[rawKey] : undefined;
      const defaultApplied = field.hasDefault && (!hasRaw || (typeof rawValue === 'string' && rawValue.trim() === ''));
      const sourceLabel = defaultApplied ? 'default' : origin ?? (hasRaw ? 'unknown' : 'missing');
      const fieldValue = Object.prototype.hasOwnProperty.call(configValue, field.key)
        ? configValue[field.key]
        : hasRaw ? source.env[rawKey] : field.defaultValue;
      const value = field.secret && !showSecrets ? '[REDACTED]' : fieldValue;
      entries.push({ config: definition.name, key: field.key, value, source: sourceLabel, secret: field.secret });
    }
  }
  if (hasOption(context.args.options, 'json')) {
    console.log(JSON.stringify(entries.map((entry) => ({
      ...entry,
      value: entry.secret && !showSecrets ? '[REDACTED]' : entry.value,
    })), null, 2));
    return;
  }
  const rows = entries.map((entry) => [
    entry.config,
    entry.key,
    entry.secret && !showSecrets ? '[REDACTED]' : entry.value === undefined ? '<missing>' : formatValue(entry.value),
    entry.source,
  ]);
  console.log(formatTable(['Config', 'Variable', 'Value', 'Source'], rows));
  if (entries.length === 0) console.log(color.gray('No configuration fields found'));
}
