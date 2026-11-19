import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineEnvConfig, type ConfigOf } from '../../src/core/config-definition.js';
import { v } from '../../src/schema/validators.js';
import { describeField } from '../../src/schema/introspection.js';


describe('external schema adapters', () => {
  it('adapts Zod-shaped schemas in mixed config shapes and prefixes issue paths', () => {
    const zodLike = {
      _def: { typeName: 'ZodString', checks: [{ kind: 'min', value: 3 }] },
      safeParse(value: unknown) {
        return typeof value === 'string' && value.length >= 3
          ? { success: true, data: value.toUpperCase() }
          : { success: false, error: { issues: [{ code: 'too_small', message: 'String too short', path: [] }] } };
      },
    };
    const definition = defineEnvConfig('mixed-zod', { NAME: zodLike, PORT: v.port() });
    const success = definition.safeParse({ NAME: 'octo', PORT: '3000' });
    expect(success.success).toBe(true);
    if (success.success) expect(success.data.NAME).toBe('OCTO');
    const failure = definition.safeParse({ NAME: 'x', PORT: '3000' });
    expect(failure.success).toBe(false);
    if (!failure.success) expect(failure.issues[0]?.path).toEqual(['NAME']);
    expect(definition.describeFields()[0]?.minLength).toBe(3);
  });

  it('adapts Standard Schema v1 in mixed shapes', () => {
    const standard = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value: unknown) {
          return typeof value === 'string' && value.startsWith('sk_')
            ? { value }
            : { issues: [{ message: 'Expected an API key', path: [] }] };
        },
      },
    };
    const definition = defineEnvConfig('standard', { API_KEY: standard });
    const failure = definition.safeParse({ API_KEY: 'wrong' });
    expect(failure.success).toBe(false);
    if (!failure.success) expect(failure.issues[0]?.path).toEqual(['API_KEY']);
    expect(definition.parse({ API_KEY: 'sk_live' }).API_KEY).toBe('sk_live');
  });

  it('introspects Joi object fields including secret and length metadata', () => {
    const joiObject = {
      isJoi: true,
      validate(value: unknown) {
        const input = value as Record<string, unknown>;
        return typeof input.API_KEY === 'string' && input.API_KEY.length >= 12
          ? { value: input }
          : { error: { details: [{ type: 'string.min', message: `"${String(input.API_KEY)}" is too short`, path: ['API_KEY'] }] } };
      },
      describe() {
        return {
          type: 'object',
          keys: {
            API_KEY: {
              type: 'string',
              flags: { presence: 'required' },
              rules: [{ name: 'min', args: { limit: 12 } }],
              metas: [{ name: 'Service API key', secret: true, group: 'Credentials' }],
            },
          },
        };
      },
    };
    const definition = defineEnvConfig('joi-object', joiObject);
    expect(definition.describeFields()).toMatchObject([
      { key: 'API_KEY', name: 'Service API key', required: true, secret: true, minLength: 12, group: 'Credentials' },
    ]);
    const invalid = definition.safeParse({ API_KEY: 'x' });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.message).not.toContain('"x"');
      expect(invalid.error.message).toContain('details hidden: secret');
    }
    expect(definition.secretPaths()).toContain('API_KEY');
  });

  it('adapts Joi-shaped validators and reads schema metadata', () => {
    const joiLike = {
      isJoi: true,
      validate(value: unknown, options: unknown) {
        expect(options).toEqual({ abortEarly: false, convert: true });
        return typeof value === 'string'
          ? { value: value.trim() }
          : { error: { details: [{ type: 'string.base', message: 'must be a string', path: [] }] } };
      },
      describe() {
        return { type: 'string', flags: { presence: 'required' }, description: 'Joi-backed string' };
      },
    };
    const definition = defineEnvConfig('joi', { VALUE: joiLike });
    expectTypeOf<ConfigOf<typeof definition>>().toEqualTypeOf<{ VALUE: string }>();
    const joiOutput: { VALUE: string } = definition.parse({ VALUE: 'hello' });
    const joiValue: string = definition.parse({ VALUE: 'hello' }).VALUE;
    expect(joiOutput.VALUE).toBe(joiValue);
    expect(definition.parse({ VALUE: ' hello ' }).VALUE).toBe('hello');
    const failure = definition.safeParse({ VALUE: 42 });
    expect(failure.success).toBe(false);
    if (!failure.success) expect(failure.issues[0]?.path).toEqual(['VALUE']);
    expect(describeField('VALUE', joiLike)).toMatchObject({ type: 'string', description: 'Joi-backed string', required: true });
  });
});
