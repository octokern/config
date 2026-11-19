import { readFileSync } from 'node:fs';
import { parseDotenv } from '../../env/dotenv-parser.js';
import { loadConfigDefinitions } from '../loader.js';
import { color } from '../format.js';
import type { CommandContext } from './shared.js';
import { getConfigPath } from './shared.js';
import { hasOption } from '../args.js';

interface DiffEntry {
  readonly key: string;
  readonly change: 'added' | 'removed' | 'changed';
  readonly left?: string | undefined;
  readonly right?: string | undefined;
  readonly secret: boolean;
}

function readEnvFile(filePath: string): Record<string, string | undefined> {
  return parseDotenv(readFileSync(filePath, 'utf8'));
}

export async function diffCommand(context: CommandContext): Promise<void> {
  const [leftPath, rightPath] = context.args.positionals;
  if (!leftPath || !rightPath) throw new Error('Usage: @octokern/config diff <left.env> <right.env> [--show-values] [--json]');
  const left = readEnvFile(leftPath);
  const right = readEnvFile(rightPath);
  let secretKeys = new Set<string>();
  const configPath = getConfigPath(context.args);
  try {
    const definitions = await loadConfigDefinitions(configPath ? { config: configPath } : {});
    secretKeys = new Set(definitions.flatMap((definition) => definition.describeFields().filter((field) => field.secret).map((field) => field.key)));
  } catch { /* diff is useful without a config file; explicit --config errors are not swallowed below */
    if (configPath !== undefined) throw new Error(`Unable to load config from ${configPath}`);
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const showValues = hasOption(context.args.options, 'show-values');
  const entries: DiffEntry[] = [];
  for (const key of keys) {
    const hasLeft = Object.prototype.hasOwnProperty.call(left, key);
    const hasRight = Object.prototype.hasOwnProperty.call(right, key);
    if (!hasLeft) entries.push({ key, change: 'added', ...(showValues ? { right: right[key] } : {}), secret: secretKeys.has(key) });
    else if (!hasRight) entries.push({ key, change: 'removed', ...(showValues ? { left: left[key] } : {}), secret: secretKeys.has(key) });
    else if (left[key] !== right[key]) entries.push({ key, change: 'changed', ...(showValues ? { left: left[key], right: right[key] } : {}), secret: secretKeys.has(key) });
  }
  const rendered = entries.map((entry) => ({
    ...entry,
    ...(entry.secret && !showValues ? { left: undefined, right: undefined } : {}),
    ...(entry.secret && showValues ? { left: '[REDACTED]', right: '[REDACTED]' } : {}),
  }));
  if (hasOption(context.args.options, 'json')) console.log(JSON.stringify(rendered, null, 2));
  else if (!entries.length) console.log(color.green('No differences found'));
  else {
    for (const entry of rendered) {
      const values = showValues ? ` (${entry.left ?? '—'} → ${entry.right ?? '—'})` : '';
      const suffix = entry.secret ? ' [SECRET]' : '';
      const line = `${entry.change.padEnd(7)} ${entry.key}${suffix}${values}`;
      console.log(entry.change === 'changed' ? color.yellow(line) : entry.change === 'added' ? color.green(line) : color.red(line));
    }
  }
  if (hasOption(context.args.options, 'exit-code')) process.exitCode = entries.length ? 1 : 0;
}
