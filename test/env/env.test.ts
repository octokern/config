import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDotenv, parseDotenvDetailed } from '../../src/env/dotenv-parser.js';
import { expandVariables } from '../../src/env/expander.js';
import { resolveEnv, resolveEnvFilePaths, resolveEnvWithSources } from '../../src/env/resolve-env.js';
import { ConfigSourceError, ConfigValidationError } from '../../src/core/errors.js';
import { defineEnvConfig } from '../../src/core/config-definition.js';
import { validateConfigs } from '../../src/core/validator.js';
import { v } from '../../src/schema/validators.js';

const tempDirectories: string[] = [];
function createTempDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'octokern-config-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('environment sources', () => {
  it('parses BOM, CRLF, export, comments, escaped and multiline values', () => {
    const escapedQuote = String.fromCharCode(92, 34);
    const parsed = parseDotenvDetailed(`\uFEFFexport A=one\r\nB="line\\nnext ${escapedQuote}quoted${escapedQuote}" # inline\r\nC=plain # note\r\nD='\${A} # literal'\r\nPEM="-----BEGIN KEY-----\nfirst\nsecond\n-----END KEY-----"\r\nESCAPED_DOLLAR="\\\${A}"\r\n`);
    expect(parsed.values.A).toBe('one');
    expect(parsed.values.B).toBe('line\nnext "quoted"');
    expect(parsed.values.C).toBe('plain');
    expect(parsed.values.D).toBe('${A} # literal');
    expect(parsed.singleQuoted.has('D')).toBe(true);
    expect(parsed.values.PEM).toContain('first\nsecond');
    expect(parsed.values.ESCAPED_DOLLAR).toBe('\\${A}');
    expect(parseDotenv('HOST=127.0.0.1').HOST).toBe('127.0.0.1');
  });

  it('expands defaults, required variables and escaped dollar signs', () => {
    const expanded = expandVariables({
      USER: 'octo',
      CONNECTION: 'postgres://${USER}@localhost',
      DEFAULTED: '${MISSING:-fallback}',
      ESCAPED: '\\${USER}',
      UNDEFINED: '${MISSING}',
    });
    expect(expanded.CONNECTION).toBe('postgres://octo@localhost');
    expect(expanded.DEFAULTED).toBe('fallback');
    expect(expanded.ESCAPED).toBe('${USER}');
    expect(expanded.UNDEFINED).toBe('');
    expect(() => expandVariables({ REQUIRED: '${MISSING:?please set it}' })).toThrow(ConfigSourceError);
    expect(() => expandVariables({ A: '${B}', B: '${A}' })).toThrow(/Circular/);
  });

  it('resolves file precedence and preserves exact origins', () => {
    const cwd = createTempDirectory();
    writeFileSync(path.join(cwd, '.env'), 'VALUE=base\nBASE_ONLY=yes\n');
    writeFileSync(path.join(cwd, '.env.production'), 'VALUE=production\n');
    writeFileSync(path.join(cwd, '.env.local'), 'VALUE=local\n');
    const paths = resolveEnvFilePaths({ envName: 'production', cwd });
    expect(paths.map((item) => path.basename(item))).toEqual(['.env.production.local', '.env.local', '.env.production', '.env']);
    const fileOnly = resolveEnvWithSources({ cwd, envName: 'production', noProcessEnv: true });
    expect(fileOnly.env.VALUE).toBe('local');
    expect(fileOnly.origins.VALUE).toBe(path.join(cwd, '.env.local'));
    expect(fileOnly.loadedFiles.map((item) => path.basename(item))).toEqual(['.env.local', '.env.production', '.env']);

    const result = resolveEnvWithSources({ cwd, envName: 'production', env: { VALUE: 'process' } });
    expect(result.env.VALUE).toBe('process');
    expect(result.env.BASE_ONLY).toBe('yes');
    expect(result.origins.VALUE).toBe('options.env');
    expect(result.loadedFiles).toHaveLength(3);
  });

  it('loads file secrets before expansion and does not expand secret contents', () => {
    const cwd = createTempDirectory();
    writeFileSync(path.join(cwd, 'db-password.txt'), 's3cr$et\n');
    writeFileSync(path.join(cwd, '.env'), 'DB_PASS_FILE=db-password.txt\nDB_URL=postgres://user:${DB_PASS}@localhost/db\n');
    const source = resolveEnvWithSources({ cwd, envFiles: ['.env'], fileSecrets: true, expandVariables: true, env: {} });
    expect(source.env.DB_PASS).toBe('s3cr$et');
    expect(source.env.DB_URL).toBe('postgres://user:s3cr$et@localhost/db');
    expect(source.origins.DB_PASS).toContain('DB_PASS_FILE');
    expect(source.fileSecretTargets).toEqual(['DB_PASS']);
  });

  it('lets an explicit env map work while process.env is disabled', () => {
    const result = resolveEnv({ env: { PORT: '1234' }, noProcessEnv: true, envFiles: [] });
    expect(result.PORT).toBe('1234');
  });

  it('strictly checks dotenv keys but ignores unrelated process.env keys without a prefix', () => {
    const cwd = createTempDirectory();
    writeFileSync(path.join(cwd, '.env'), 'PORT=3000\nTYPO=value\n');
    const definition = defineEnvConfig('strict-app', { PORT: v.port() });
    const originalRuntimeValue = process.env.RUNTIME_ONLY;
    process.env.RUNTIME_ONLY = 'ignored-by-default';
    try {
      const source = resolveEnvWithSources({ cwd });
      expect(() => validateConfigs([definition], source.env, {
        strict: true,
        origins: source.origins,
        envFileKeys: source.envFileKeys,
      })).toThrow(ConfigValidationError);
      const cleanCwd = createTempDirectory();
      writeFileSync(path.join(cleanCwd, '.env'), 'PORT=3000\n');
      const cleanSource = resolveEnvWithSources({ cwd: cleanCwd });
      expect(() => validateConfigs([definition], cleanSource.env, {
        strict: true,
        origins: cleanSource.origins,
        envFileKeys: cleanSource.envFileKeys,
      })).not.toThrow();
      expect(() => validateConfigs([definition], cleanSource.env, {
        strict: { prefix: 'RUNTIME_' },
        origins: cleanSource.origins,
        envFileKeys: cleanSource.envFileKeys,
      })).toThrow(ConfigValidationError);
    } finally {
      if (originalRuntimeValue === undefined) delete process.env.RUNTIME_ONLY;
      else process.env.RUNTIME_ONLY = originalRuntimeValue;
    }
  });
});
