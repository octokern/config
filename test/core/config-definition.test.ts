import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineEnvConfig, type ConfigOf } from '../../src/core/config-definition.js';
import { ConfigValidationError, DuplicateConfigError } from '../../src/core/errors.js';
import { normalizeDefinitions } from '../../src/core/normalize.js';
import { validateConfigs } from '../../src/core/validator.js';
import { v } from '../../src/schema/validators.js';

const appConfig = defineEnvConfig('app', {
  PORT: v.port(),
  HOST: v.string().default('127.0.0.1'),
  TOKEN: v.string().min(8).secret(),
  OPTIONAL: v.string().optional(),
});

describe('ConfigDefinition and validation core', () => {
  it('infers output types and parses environment records', () => {
    const result = appConfig.safeParse({ PORT: '4000', TOKEN: 'very-secret-token' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(4000);
      expect(result.data.HOST).toBe('127.0.0.1');
      expectTypeOf<ConfigOf<typeof appConfig>>().toExtend<{
        PORT: number;
        HOST: string;
        TOKEN: string;
        OPTIONAL?: string;
      }>();
    }
  });

  it('redacts short secrets and suggests close environment keys', () => {
    const result = appConfig.safeParse({ PRTO: '3000', TOKEN: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('did you mean "PRTO"');
      expect(result.error.message).toContain('Invalid value (details hidden: secret)');
      expect(result.error.message).not.toContain('TOKEN: Expected string');
    }
  });

  it('aggregates failures from all definitions atomically', () => {
    const dbConfig = defineEnvConfig('database', { DATABASE_URL: v.string().url() });
    const error = (() => {
      try {
        validateConfigs([appConfig, dbConfig], { PORT: '70000', TOKEN: 'short', DATABASE_URL: 'bad' });
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as ConfigValidationError).issues.length).toBeGreaterThanOrEqual(2);
    expect((error as Error).message).toContain('[APP]');
    expect((error as Error).message).toContain('[DATABASE]');
  });

  it('applies transforms, refinements and strict-key rules', () => {
    const config = defineEnvConfig('app', { PORT: v.port() })
      .transform((value) => ({ ...value, portLabel: String(value.PORT) }))
      .refine((value) => value.PORT > 1000, 'Port must be greater than 1000');
    expect(config.parse({ PORT: '3000' }).portLabel).toBe('3000');
    expect(() => validateConfigs([config], { PORT: '3000', UNKNOWN_KEY: 'x' }, { strict: true })).toThrow(ConfigValidationError);
    const warned = validateConfigs([config], { PORT: '3000', UNKNOWN_KEY: 'x' }, { strict: { mode: 'warn' } });
    expect(warned.warnings).toHaveLength(1);
  });

  it('detects duplicate names but is idempotent for repeated references', () => {
    expect(normalizeDefinitions([appConfig, appConfig])).toHaveLength(1);
    expect(() => normalizeDefinitions([appConfig, defineEnvConfig('app', { PORT: v.port() })])).toThrow(DuplicateConfigError);
  });

  it('checks secret keys at compile time', () => {
    appConfig.secrets('TOKEN');
    // @ts-expect-error TOKEN is the only supported secret key outside the inferred schema.
    appConfig.secrets('NOT_A_CONFIG_KEY');
  });

  it('executes transform and refine operations in declaration order', () => {
    const definition = defineEnvConfig('pipeline', { VALUE: v.number() })
      .refine((value) => value.VALUE > 0, 'must be positive')
      .transform((value) => ({ value: String(value.VALUE) }))
      .refine((value) => value.value.startsWith('1'), { message: 'must start with one', path: ['value'] });
    expect(definition.parse({ VALUE: '123' })).toEqual({ value: '123' });
    const invalid = definition.safeParse({ VALUE: '-2' });
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.issues[0]?.path).toEqual([]);
    const invalidAfterTransform = definition.safeParse({ VALUE: '20' });
    expect(invalidAfterTransform.success).toBe(false);
    if (!invalidAfterTransform.success) expect(invalidAfterTransform.issues[0]?.path).toEqual(['value']);
  });

  it('masks nested secret values in validation errors', () => {
    const nested = defineEnvConfig('nested-secret', {
      AUTH: v.object({ TOKEN: v.string().min(10).secret() }),
    });
    const result = nested.safeParse({ AUTH: { TOKEN: 'tiny' } });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).not.toContain('tiny');
  });
});
