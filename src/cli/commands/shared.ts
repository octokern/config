import * as path from 'node:path';
import { resolveEnvWithSources, type ResolveEnvResult } from '../../env/resolve-env.js';
import type { ConfigDefinition } from '../../core/config-definition.js';
import { getOptionString, hasOption, normalizeStringList, type ParsedArgs } from '../args.js';

export interface CommandContext {
  readonly args: ParsedArgs;
}

export function optionList(args: ParsedArgs, name: string): readonly string[] {
  return normalizeStringList(args.options[name] as string | readonly string[] | undefined);
}

export function getConfigPath(args: ParsedArgs): string | undefined {
  return getOptionString(args.options, 'config', 'c');
}

export async function loadDefinitions(context: CommandContext): Promise<readonly ConfigDefinition[]> {
  const { loadConfigDefinitions } = await import('../loader.js');
  const config = getConfigPath(context.args);
  return loadConfigDefinitions({ ...(config ? { config } : {}), cwd: process.cwd() });
}

export function resolveSources(args: ParsedArgs): ResolveEnvResult {
  const envFiles = optionList(args, 'env-file');
  return resolveEnvWithSources({
    ...(envFiles.length ? { envFiles: envFiles.map((file) => path.resolve(process.cwd(), file)) } : {}),
    expandVariables: hasOption(args.options, 'expand'),
    fileSecrets: hasOption(args.options, 'file-secrets'),
    noProcessEnv: hasOption(args.options, 'no-process-env'),
  });
}

export function getOutPath(args: ParsedArgs, fallback: string): string {
  return path.resolve(process.cwd(), getOptionString(args.options, 'out') ?? fallback);
}

export function optionEnabled(args: ParsedArgs, name: string): boolean {
  return hasOption(args.options, name);
}
