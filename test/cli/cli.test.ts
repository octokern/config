import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../../src/cli/args.js';
import { runCli } from '../../src/cli/index.js';

const originalCwd = process.cwd();
const originalExitCode = process.exitCode;
const tempDirectories: string[] = [];

function createProject(): string {
  const cwd = mkdtempSync(path.join(tmpdir(), 'octokern-cli-'));
  tempDirectories.push(cwd);
  writeFileSync(path.join(cwd, 'app.def.mjs'), `
    const definition = {
      [Symbol.for('fast-config.definition')]: true,
      name: 'app',
      schema: {},
      safeParse(raw) {
        const value = Number(raw.PORT);
        if (!Number.isInteger(value) || value < 1 || value > 65535) {
          return { success: false, error: { message: 'Invalid PORT', issues: [{ configName: 'app', key: 'PORT', message: 'Invalid PORT' }] }, issues: [{ configName: 'app', key: 'PORT', message: 'Invalid PORT' }] };
        }
        return { success: true, data: { PORT: value, API_KEY: raw.API_KEY } };
      },
      describeFields() {
        return [
          { key: 'PORT', name: 'HTTP port', type: 'port', required: true, secret: false, includeInExample: true, example: '3000' },
          { key: 'API_KEY', name: 'Service API key', type: 'string', required: false, secret: true, includeInExample: true, minLength: 24 },
        ];
      },
    };
    export default definition;
  `);
  return cwd;
}

afterEach(() => {
  process.chdir(originalCwd);
  process.exitCode = originalExitCode;
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('CLI', () => {
  it('parses value, boolean, repeatable and separator arguments', () => {
    const parsed = parseArgs(['check', '-c', 'app.def.ts', '-e', '.env', '--env-file=.env.local', '--expand', '--no-process-env', '--', 'node', 'server.js']);
    expect(parsed.command).toBe('check');
    expect(parsed.options.config).toBe('app.def.ts');
    expect(parsed.options['env-file']).toEqual(['.env', '.env.local']);
    const repeatedShort = parseArgs(['check', '-e', '.env', '-e', '.env.local']);
    expect(repeatedShort.options['env-file']).toEqual(['.env', '.env.local']);
    expect(parsed.options.expand).toBe(true);
    expect(parsed.options['no-process-env']).toBe(true);
    expect(parsed.commandArgs).toEqual(['node', 'server.js']);
  });

  it('prints help without relying on a prebuilt dist directory', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runCli(['--help']);
    expect(log.mock.calls.flat().join(' ')).toContain('@octokern/config');
  });

  it('recognizes the canonical config executable and reports the synchronized version', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runCli(['node', 'bin/octokernconfig.mjs', '--version']);
    expect(log.mock.calls.flat().join(' ')).toBe('@octokern/config 1.0.0');
  });

  it('runs example and check directly from source with a JavaScript definition', async () => {
    const cwd = createProject();
    process.chdir(cwd);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runCli(['example', '--stdout']);
    expect(log.mock.calls.flat().join('\n')).toContain('PORT=3000');

    writeFileSync(path.join(cwd, '.env'), 'PORT=3000\n');
    await runCli(['check', '--env-file', '.env', '--no-process-env', '--quiet']);
    expect(process.exitCode).toBe(0);
  });

  it('generates docs, injects markers and initializes private secret files', async () => {
    const cwd = createProject();
    process.chdir(cwd);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runCli(['docs', '--stdout']);
    expect(log.mock.calls.flat().join('\n')).toContain('| Название | Переменная | Обязательна | Тип |');

    writeFileSync(path.join(cwd, 'README.md'), '# App\n\n<!-- fastconfig:start -->\n<!-- fastconfig:end -->\n');
    await runCli(['docs', '--inject', 'README.md']);
    expect(readFileSync(path.join(cwd, 'README.md'), 'utf8')).toContain('Service API key');

    await runCli(['init', '--out', '.env.generated']);
    const generated = readFileSync(path.join(cwd, '.env.generated'), 'utf8');
    const secret = /^API_KEY=(.+)$/m.exec(generated)?.[1];
    expect(secret).toBeDefined();
    expect(secret?.length).toBe(24);
    if (process.platform !== 'win32') {
      const mode = statSync(path.join(cwd, '.env.generated')).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('masks schema secrets in diff and reports resolved source in inspect', async () => {
    const cwd = createProject();
    process.chdir(cwd);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeFileSync(path.join(cwd, 'left.env'), 'PORT=3000\nAPI_KEY=old-secret-value\n');
    writeFileSync(path.join(cwd, 'right.env'), 'PORT=3001\nAPI_KEY=new-secret-value\n');
    await runCli(['diff', 'left.env', 'right.env', '--config', 'app.def.mjs', '--show-values']);
    expect(log.mock.calls.flat().join('\n')).not.toContain('old-secret-value');
    expect(log.mock.calls.flat().join('\n')).toContain('[REDACTED]');

    writeFileSync(path.join(cwd, '.env'), 'PORT=3000\nAPI_KEY=inspection-secret\n');
    await runCli(['inspect', '--config', 'app.def.mjs', '--no-process-env', '--json']);
    const inspection = log.mock.calls.flat().join('\n');
    expect(inspection).toContain('"source": "');
    expect(inspection).toContain('"value": "[REDACTED]"');
    expect(error).not.toHaveBeenCalled();
  });

  it('runs a child process only after configuration validation', async () => {
    const cwd = createProject();
    process.chdir(cwd);
    writeFileSync(path.join(cwd, '.env'), 'PORT=3000\nAPI_KEY=valid-secret\n');
    await runCli(['run', '--no-process-env', '--', 'node', '-e', 'process.exit(7)']);
    expect(process.exitCode).toBe(7);
  });
});
