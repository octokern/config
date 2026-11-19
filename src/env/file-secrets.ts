import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { ConfigSourceError } from '../core/errors.js';

export interface FileSecretsOptions {
  readonly suffix?: string;
}

export interface FileSecretsResult {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly origins: Readonly<Record<string, string>>;
  readonly targets: readonly string[];
}

export function resolveFileSecrets(
  environment: Readonly<Record<string, string | undefined>>,
  options: FileSecretsOptions = {},
  cwd = process.cwd(),
  protectedKeys: ReadonlySet<string> = new Set<string>(),
): FileSecretsResult {
  const suffix = options.suffix ?? '_FILE';
  const env: Record<string, string | undefined> = { ...environment };
  const origins: Record<string, string> = {};
  const targets: string[] = [];
  for (const [fileKey, filePath] of Object.entries(environment)) {
    if (!fileKey.endsWith(suffix) || !filePath) continue;
    const target = fileKey.slice(0, -suffix.length);
    if (!target || protectedKeys.has(target) || env[target] !== undefined) continue;
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    try {
      env[target] = readFileSync(resolvedPath, 'utf8').replace(/\r?\n$/, '');
      origins[target] = `${fileKey} (${resolvedPath})`;
      targets.push(target);
    } catch (error) {
      throw new ConfigSourceError(
        `Unable to read file secret for ${target} from "${resolvedPath}": ${error instanceof Error ? error.message : String(error)}`,
        resolvedPath,
        { cause: error },
      );
    }
  }
  return { env: Object.freeze(env), origins: Object.freeze(origins), targets: Object.freeze(targets) };
}
