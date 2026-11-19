import { spawnSync } from 'node:child_process';
import { validateConfigs } from '../../core/validator.js';
import { hasOption } from '../args.js';
import type { CommandContext } from './shared.js';
import { loadDefinitions, resolveSources } from './shared.js';

export async function runCommand(context: CommandContext): Promise<void> {
  const commandParts = context.args.commandArgs.length
    ? context.args.commandArgs
    : context.args.positionals;
  const command = commandParts[0];
  if (!command) throw new Error('Usage: @octokern/config run -- <command> [args...]');
  const definitions = await loadDefinitions(context);
  const source = resolveSources(context.args);
  validateConfigs(definitions, source.env, {
    strict: hasOption(context.args.options, 'strict'),
    origins: source.origins,
    envFileKeys: source.envFileKeys,
  });
  const noProcessEnv = context.args.options['no-process-env'] === true;
  const inheritedEnv = noProcessEnv
    ? Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec', 'TEMP', 'TMP'].includes(key),
    ))
    : process.env;
  const childEnv: Record<string, string | undefined> = {
    ...inheritedEnv,
    ...source.env,
  };
  const child = spawnSync(command, commandParts.slice(1), {
    cwd: process.cwd(),
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}
