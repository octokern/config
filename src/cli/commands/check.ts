import { ConfigValidationError } from '../../core/errors.js';
import { validateConfigs } from '../../core/validator.js';
import { color } from '../format.js';
import type { CommandContext } from './shared.js';
import { loadDefinitions, optionEnabled, resolveSources } from './shared.js';

export async function checkCommand(context: CommandContext): Promise<void> {
  const definitions = await loadDefinitions(context);
  const source = resolveSources(context.args);
  try {
    const result = validateConfigs(definitions, source.env, {
      strict: optionEnabled(context.args, 'strict') ? true : false,
      origins: source.origins,
      envFileKeys: source.envFileKeys,
    });
    const output = {
      success: true,
      configs: definitions.map((definition) => definition.name),
      files: source.loadedFiles,
      warnings: result.warnings,
    };
    if (optionEnabled(context.args, 'json')) console.log(JSON.stringify(output, null, 2));
    else if (!optionEnabled(context.args, 'quiet')) {
      console.log(color.green(`✓ ${String(definitions.length)} configuration(s) validated`));
      if (source.loadedFiles.length) console.log(`Loaded: ${source.loadedFiles.join(', ')}`);
      for (const warning of result.warnings) console.warn(color.yellow(`Warning: ${warning}`));
    }
    process.exitCode = 0;
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      if (optionEnabled(context.args, 'json')) console.error(JSON.stringify({ success: false, ...error.toJSON() }, null, 2));
      else console.error(color.red(error.message));
    } else throw error;
    process.exitCode = 1;
  }
}
