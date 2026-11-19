import { parseArgs } from './args.js';
import { checkCommand } from './commands/check.js';
import { exampleCommand } from './commands/example.js';
import { diffCommand } from './commands/diff.js';
import { docsCommand } from './commands/docs.js';
import { inspectCommand } from './commands/inspect.js';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { CLI_NAME, CLI_VERSION } from './version.js';
import { color } from './format.js';

const HELP = `${CLI_NAME} — type-safe environment configuration\n\n` +
  `Usage:\n  npx @octokern/config <command> [options]\n\n` +
  `Commands:\n` +
  `  check       Validate environment configuration without starting NestJS\n` +
  `  example     Generate .env.example from configuration definitions\n` +
  `  docs        Generate Markdown environment variable documentation\n` +
  `  diff        Compare two dotenv files\n` +
  `  inspect     Show resolved configuration values and their sources\n` +
  `  init        Create a private .env file with defaults and generated secrets\n` +
  `  run         Validate configuration, then run a command\n\n` +
  `Global options:\n` +
  `  -c, --config <file>       Load an explicit *.def.ts/js configuration file\n` +
  `  -e, --env-file <file>     Load an env file (repeatable)\n` +
  `      --expand              Expand \${VAR} references in dotenv values\n` +
  `      --file-secrets        Resolve *_FILE secret references\n` +
  `      --no-process-env      Do not read process.env\n` +
  `      --strict              Reject unknown environment keys\n` +
  `      --json                Emit machine-readable JSON\n` +
  `  -q, --quiet               Suppress success output\n` +
  `      --help                Show help\n` +
  `      --version             Show version\n`;

function normalizeArgv(argv: readonly string[]): readonly string[] {
  if (argv === process.argv) return argv.slice(2);
  const executable = argv[1] ?? '';
  const isNodeInvocation = argv[0]?.endsWith('node') === true || argv[0]?.endsWith('node.exe') === true;
  const isPackageCli = executable.endsWith('fastconfig.mjs') || executable.endsWith('octokernconfig.mjs') || executable === 'config';
  if (argv.length >= 2 && (isNodeInvocation || isPackageCli)) return argv.slice(2);
  return argv;
}

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  const parsed = parseArgs(normalizeArgv(argv));
  if (parsed.options.help === true) {
    console.log(HELP);
    return;
  }
  if (parsed.options.version === true) {
    console.log(`${CLI_NAME} ${CLI_VERSION}`);
    return;
  }
  if (!parsed.command) {
    console.log(HELP);
    return;
  }
  try {
    const context = { args: parsed };
    switch (parsed.command) {
      case 'check': await checkCommand(context); break;
      case 'example': await exampleCommand(context); break;
      case 'docs': await docsCommand(context); break;
      case 'diff': await diffCommand(context); break;
      case 'inspect': await inspectCommand(context); break;
      case 'init': await initCommand(context); break;
      case 'run': await runCommand(context); break;
      default:
        console.error(color.red(`Unknown command "${parsed.command}".\n\n${HELP}`));
        process.exitCode = 2;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (parsed.options.json === true) console.error(JSON.stringify({ success: false, error: message }));
    else console.error(color.red(message));
    process.exitCode = 1;
  }
}

export { parseArgs } from './args.js';
export { loadConfigDefinitions } from './loader.js';
export { CLI_NAME, CLI_VERSION } from './version.js';
export { renderEnvExample } from './commands/example.js';
export { renderConfigDocs } from './commands/docs.js';
