import { describe, expect, expectTypeOf, it } from 'vitest';
import { v } from '../../src/schema/validators.js';
import { defineEnvConfig } from '../../src/core/config-definition.js';
import { SchemaValidationError } from '../../src/schema/validators.js';

describe('built-in schema builder', () => {
  it('coerces and validates numbers, ports and booleans safely', () => {
    expect(v.number().int().parse('42')).toBe(42);
    expect(v.port().parse('65535')).toBe(65535);
    expect(() => v.port().parse('65536')).toThrow(SchemaValidationError);
    expect(v.boolean().parse(' YES ')).toBe(true);
    expect(v.boolean().parse('off')).toBe(false);
    expect(() => v.boolean().parse('maybe')).toThrow(SchemaValidationError);
    expect(() => v.number().parse('')).toThrow(SchemaValidationError);
  });

  it('supports immutable string modifiers and metadata', () => {
    const base = v.string();
    const schema = base.trim().toLowerCase().min(3).email().description('Account email').example('user@example.com');
    expect(base.parse('  USER@EXAMPLE.COM  ')).toBe('  USER@EXAMPLE.COM  ');
    expect(schema.parse(' USER@EXAMPLE.COM ')).toBe('user@example.com');
    expect(schema.metadata.description).toBe('Account email');
    expect(schema.metadata.options?.example).toBe('user@example.com');
  });

  it('parses lists, arrays, json, durations, unions and literals', () => {
    expect(v.list().parse('a, b,, c')).toEqual(['a', 'b', 'c']);
    expect(v.list(v.number().int()).parse('1,2,3')).toEqual([1, 2, 3]);
    expect(v.array(v.number()).parse('[1,"2",3]')).toEqual([1, 2, 3]);
    expect(v.json(v.object({ enabled: v.boolean() })).parse('{"enabled":"true"}')).toEqual({ enabled: true });
    expect(v.duration().parse('5m')).toBe(300_000);
    expect(v.duration({ unit: 's' }).parse('2h')).toBe(7200);
    expect(v.union([v.literal('dev'), v.literal('prod')]).parse('prod')).toBe('prod');
  });

  it('reports nested issue paths and keeps optional keys optional in types', () => {
    const schema = v.object({
      PORT: v.port(),
      HOST: v.string().default('127.0.0.1'),
      OPTIONAL: v.string().optional(),
      NESTED: v.object({ NAME: v.string().min(2) }),
    });
    const parsed = schema.safeParse({ PORT: '3000', NESTED: { NAME: '' } });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['NESTED', 'NAME']);
    type Output = v.infer<typeof schema>;
    expectTypeOf<Output>().toEqualTypeOf<{
      PORT: number;
      HOST: string;
      OPTIONAL?: string;
      NESTED: { NAME: string };
    }>();
  });

  it('preserves nested object shape metadata across modifiers', () => {
    const schema = v.object({
      API_KEY: v.string().secret(),
    }).name('Credentials');
    const definition = defineEnvConfig('schema-config', schema);
    expect(definition.describeFields()).toMatchObject([
      { key: 'API_KEY', secret: true },
    ]);
    expect(definition.parse({ API_KEY: 'local-secret' }).API_KEY).toBe('local-secret');
  });

  it('captures transform failures and applies defaults lazily', () => {
    let defaultCalls = 0;
    const schema = v.string().optional().default(() => {
      defaultCalls += 1;
      return 'fallback';
    });
    expect(schema.parse(undefined)).toBe('fallback');
    expect(defaultCalls).toBe(1);
    const broken = v.string().transform(() => {
      throw new Error('cannot convert');
    });
    const result = broken.safeParse('value');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.code).toBe('transform_failed');
  });
});
