export interface FieldOptions {
  readonly example?: string;
  readonly placeholder?: string;
  readonly comment?: string;
  readonly group?: string;
  readonly secret?: boolean;
  readonly deprecated?: boolean | string;
  readonly includeInExample?: boolean;
}

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path: readonly (string | number)[];
}

export interface SafeParseSuccess<T> {
  readonly success: true;
  readonly data: T;
}

export interface SafeParseFailure {
  readonly success: false;
  readonly error: SchemaValidationError;
}

export type SafeParseReturn<T> = SafeParseSuccess<T> | SafeParseFailure;

export interface SchemaMetadata {
  readonly kind?: string;
  readonly name?: string;
  readonly description?: string;
  readonly options?: FieldOptions;
  readonly optional?: boolean;
  readonly nullable?: boolean;
  readonly hasDefault?: boolean;
  readonly defaultValue?: unknown;
  readonly secret?: boolean;
  readonly enumValues?: readonly unknown[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  readonly constraints?: Readonly<Record<string, unknown>>;
}

type Parser<T> = (input: unknown, path: readonly (string | number)[]) => T;

export class SchemaValidationError extends Error {
  public readonly issues: readonly ValidationIssue[];

  public constructor(issues: readonly ValidationIssue[]) {
    const frozen = Object.freeze(
      issues.map((issue) =>
        Object.freeze({ ...issue, path: Object.freeze([...issue.path]) }),
      ),
    );
    const first = frozen[0];
    super(
      first
        ? `${formatPath(first.path)}${formatPath(first.path) ? ': ' : ''}${first.message}`
        : 'Schema validation failed',
    );
    this.name = 'SchemaValidationError';
    this.issues = frozen;
  }
}

export function fail(
  message: string,
  path: readonly (string | number)[] = [],
  code = 'invalid_type',
): never {
  throw new SchemaValidationError([{ code, message, path }]);
}

export function formatPath(path: readonly (string | number)[]): string {
  return path.map(String).join('.');
}

function freezeMetadata(metadata: SchemaMetadata): SchemaMetadata {
  return Object.freeze({
    ...metadata,
    ...(metadata.options ? { options: Object.freeze({ ...metadata.options }) } : {}),
    ...(metadata.constraints
      ? { constraints: Object.freeze({ ...metadata.constraints }) }
      : {}),
    ...(metadata.enumValues
      ? { enumValues: Object.freeze([...metadata.enumValues]) }
      : {}),
  });
}

export class Schema<TOutput> {
  public readonly metadata: SchemaMetadata;
  protected readonly parser: Parser<TOutput>;

  public constructor(parser: Parser<TOutput>, metadata: SchemaMetadata = {}) {
    this.parser = parser;
    this.metadata = freezeMetadata(metadata);
  }

  public parseAt(
    input: unknown,
    path: readonly (string | number)[] = [],
  ): TOutput {
    try {
      return this.parser(input, path);
    } catch (error) {
      if (error instanceof SchemaValidationError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new SchemaValidationError([
        { code: 'custom', message, path },
      ]);
    }
  }

  public parse(input: unknown): TOutput {
    return this.parseAt(input, []);
  }

  public safeParse(input: unknown): SafeParseReturn<TOutput> {
    try {
      return { success: true, data: this.parse(input) };
    } catch (error) {
      const normalized =
        error instanceof SchemaValidationError
          ? error
          : new SchemaValidationError([
              {
                code: 'custom',
                message: error instanceof Error ? error.message : String(error),
                path: [],
              },
            ]);
      return { success: false, error: normalized };
    }
  }

  protected cloneAsSchema<TNext>(
    parser: Parser<TNext>,
    metadata: SchemaMetadata,
  ): Schema<TNext> {
    const prototype = Object.getPrototypeOf(this) as object | null;
    const clone = Object.create(prototype) as Schema<TNext>;
    Object.defineProperties(clone, Object.getOwnPropertyDescriptors(this));
    Object.defineProperties(clone, {
      parser: { value: parser, enumerable: true, writable: true, configurable: true },
      metadata: { value: freezeMetadata(metadata), enumerable: true, writable: true, configurable: true },
    });
    return clone;
  }

  protected cloneAsThis(
    parser: Parser<TOutput>,
    metadata: SchemaMetadata = this.metadata,
  ): this {
    return this.cloneAsSchema(parser, metadata) as this;
  }

  public optional(): Schema<TOutput | undefined> {
    return this.cloneAsSchema(
      (input, path) => input === undefined ? undefined : this.parseAt(input, path),
      { ...this.metadata, optional: true },
    );
  }

  public nullable(): Schema<TOutput | null> {
    return this.cloneAsSchema(
      (input, path) => input === null ? null : this.parseAt(input, path),
      { ...this.metadata, nullable: true },
    );
  }

  public default<TDefault extends Exclude<TOutput, undefined>>(
    value: TDefault | (() => TDefault),
  ): Schema<Exclude<TOutput, undefined>> {
    const getDefault = typeof value === 'function' ? (value as () => TDefault) : () => value;
    return this.cloneAsSchema<Exclude<TOutput, undefined>>(
      (input, path) => (input === undefined
        ? getDefault()
        : this.parseAt(input, path)) as Exclude<TOutput, undefined>,
      {
        ...this.metadata,
        optional: false,
        hasDefault: true,
        defaultValue: typeof value === 'function' ? undefined : value,
      },
    );
  }

  public transform<TNew>(transformer: (value: TOutput) => TNew): Schema<TNew> {
    return this.cloneAsSchema(
      (input, path) => {
        const value = this.parseAt(input, path);
        try {
          return transformer(value);
        } catch (error) {
          fail(
            error instanceof Error ? error.message : String(error),
            path,
            'transform_failed',
          );
        }
      },
      { ...this.metadata, kind: this.metadata.kind ?? 'transform' },
    );
  }

  public refine(
    predicate: (value: TOutput) => boolean,
    messageOrOptions:
      | string
      | { readonly message: string; readonly path?: readonly (string | number)[] },
  ): this {
    const message =
      typeof messageOrOptions === 'string'
        ? messageOrOptions
        : messageOrOptions.message;
    const extraPath =
      typeof messageOrOptions === 'string'
        ? []
        : (messageOrOptions.path ?? []);
    return this.cloneAsThis((input, path) => {
      const value = this.parseAt(input, path);
      const valid = (() => {
        try { return predicate(value); }
        catch { return false; }
      })();
      if (!valid) fail(message, [...path, ...extraPath], 'custom');
      return value;
    });
  }

  public name(label: string): this {
    return this.cloneAsThis(this.parser, { ...this.metadata, name: label });
  }

  public description(text: string): this {
    return this.cloneAsThis(this.parser, { ...this.metadata, description: text });
  }

  public describe(text: string): this {
    return this.description(text);
  }

  public options(options: FieldOptions): this {
    const secret = options.secret ?? this.metadata.secret;
    return this.cloneAsThis(this.parser, {
      ...this.metadata,
      options: { ...this.metadata.options, ...options },
      ...(secret !== undefined ? { secret } : {}),
    });
  }

  public example(example: string): this {
    return this.options({ example });
  }

  public secret(enabled = true): this {
    return this.options({ secret: enabled });
  }
}

export class StringSchema extends Schema<string> {
  public constructor(parser?: Parser<string>, metadata: SchemaMetadata = {}) {
    super(
      parser ??
        ((input, path) => {
          if (typeof input !== 'string') {
            fail(`Expected string, received ${input === null ? 'null' : typeof input}`, path);
          }
          return input;
        }),
      { kind: 'string', ...metadata },
    );
  }

  public trim(): this {
    return this.cloneAsThis((input, path) => this.parseAt(input, path).trim());
  }

  public toLowerCase(): this {
    return this.cloneAsThis((input, path) => this.parseAt(input, path).toLowerCase());
  }

  public toUpperCase(): this {
    return this.cloneAsThis((input, path) => this.parseAt(input, path).toUpperCase());
  }

  public min(length: number, message?: string): this {
    return this.cloneAsThis((input, path) => {
      const value = this.parseAt(input, path);
      if (value.length < length) fail(message ?? `String must contain at least ${length} character(s)`, path, 'too_small');
      return value;
    }, { ...this.metadata, minLength: length });
  }

  public max(length: number, message?: string): this {
    return this.cloneAsThis((input, path) => {
      const value = this.parseAt(input, path);
      if (value.length > length) fail(message ?? `String must contain at most ${length} character(s)`, path, 'too_big');
      return value;
    }, { ...this.metadata, maxLength: length });
  }

  public length(length: number, message?: string): this {
    return this.min(length, message).max(length, message);
  }

  public nonEmpty(message = 'String must not be empty'): this {
    return this.min(1, message);
  }

  public regex(expression: RegExp, message = 'Invalid string format'): this {
    return this.cloneAsThis((input, path) => {
      const value = this.parseAt(input, path);
      expression.lastIndex = 0;
      if (!expression.test(value)) fail(message, path, 'invalid_string');
      return value;
    }, { ...this.metadata, constraints: { ...this.metadata.constraints, regex: expression.source } });
  }

  public url(message = 'Invalid URL'): this {
    return this.refine((value) => {
      try {
        const parsed = new URL(value);
        return Boolean(parsed.protocol && parsed.host);
      } catch {
        return false;
      }
    }, message);
  }

  public email(message = 'Invalid email address'): this {
    return this.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, message);
  }

  public uuid(message = 'Invalid UUID'): this {
    return this.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, message);
  }

  public startsWith(prefix: string, message?: string): this {
    return this.refine((value) => value.startsWith(prefix), message ?? `String must start with "${prefix}"`);
  }

  public endsWith(suffix: string, message?: string): this {
    return this.refine((value) => value.endsWith(suffix), message ?? `String must end with "${suffix}"`);
  }
}

export class NumberSchema extends Schema<number> {
  public constructor(parser?: Parser<number>, metadata: SchemaMetadata = {}) {
    super(
      parser ??
        ((input, path) => {
          if (typeof input === 'number') {
            if (!Number.isFinite(input)) fail('Expected a finite number', path);
            return input;
          }
          if (typeof input !== 'string' || input.trim() === '') {
            fail(`Expected number, received ${String(input)}`, path);
          }
          const parsed = Number(input.trim());
          if (!Number.isFinite(parsed)) fail(`Expected a valid number, received "${input}"`, path);
          return parsed;
        }),
      { kind: 'number', ...metadata },
    );
  }

  public int(message = 'Expected an integer'): this {
    return this.refine(Number.isInteger, message);
  }

  public min(minimum: number, message?: string): this {
    return this.cloneAsThis((input, path) => {
      const value = this.parseAt(input, path);
      if (value < minimum) fail(message ?? `Number must be greater than or equal to ${minimum}`, path, 'too_small');
      return value;
    }, { ...this.metadata, min: minimum });
  }

  public max(maximum: number, message?: string): this {
    return this.cloneAsThis((input, path) => {
      const value = this.parseAt(input, path);
      if (value > maximum) fail(message ?? `Number must be less than or equal to ${maximum}`, path, 'too_big');
      return value;
    }, { ...this.metadata, max: maximum });
  }

  public positive(message = 'Number must be positive'): this {
    return this.refine((value) => value > 0, message);
  }

  public nonnegative(message = 'Number must be non-negative'): this {
    return this.refine((value) => value >= 0, message);
  }

  public port(message = 'Port must be an integer between 1 and 65535'): this {
    return this.cloneAsThis((input, path) => {
      const value = this.parseAt(input, path);
      if (!Number.isInteger(value) || value < 1 || value > 65535) fail(message, path, 'invalid_port');
      return value;
    }, { ...this.metadata, kind: 'port', min: 1, max: 65535, constraints: { ...this.metadata.constraints, integer: true } });
  }
}

export class BooleanSchema extends Schema<boolean> {
  public constructor(metadata: SchemaMetadata = {}) {
    super((input, path) => {
      if (typeof input === 'boolean') return input;
      if (typeof input === 'number' && (input === 0 || input === 1)) return input === 1;
      if (typeof input === 'string') {
        const normalized = input.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
      }
      fail(`Expected boolean (true/false, 1/0, yes/no, on/off), received "${String(input)}"`, path, 'invalid_boolean');
    }, { kind: 'boolean', ...metadata });
  }
}

export type AnySchema = Schema<unknown> | StandardSchemaLike | ParseSchemaLike;
export interface StandardSchemaLike {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor?: string;
    readonly validate: (value: unknown) => unknown;
  };
}
export interface ParseSchemaLike {
  readonly parse: (input: unknown) => unknown;
}

type ValidationValue<TResult> = TResult extends { readonly value: infer TOutput } ? TOutput : never;

export type Infer<TSchema> = TSchema extends Schema<infer TOutput>
  ? TOutput
  : TSchema extends { readonly '~standard': { readonly types?: { readonly output: infer TOutput } } }
    ? TOutput
    : TSchema extends { readonly _output: infer TOutput }
      ? TOutput
      : TSchema extends { readonly __output: infer TOutput }
        ? TOutput
        : TSchema extends { validate: (...args: infer _Args) => infer TResult }
          ? [ValidationValue<TResult>] extends [never] ? unknown : ValidationValue<TResult>
          : TSchema extends { readonly parse: (input: unknown) => infer TOutput }
            ? TOutput
            : unknown;

type Simplify<T> = { [K in keyof T]: T[K] };

type RequiredShapeKeys<TShape extends Record<string, unknown>> = {
  [K in keyof TShape]-?: undefined extends Infer<TShape[K]> ? never : K;
}[keyof TShape];

type OptionalShapeKeys<TShape extends Record<string, unknown>> = {
  [K in keyof TShape]-?: undefined extends Infer<TShape[K]> ? K : never;
}[keyof TShape];

/**
 * Infer the parsed output of an object shape.
 *
 * `-readonly` is intentional: `v.object()` accepts const-inferred shapes, but
 * the parsed object is a regular mutable object. `Simplify` also flattens the
 * required/optional mapped-type intersection so strict type-equality checks
 * see the same shape users write in TypeScript.
 */
export type InferShape<TShape extends Record<string, unknown>> = Simplify<
  {
    -readonly [K in RequiredShapeKeys<TShape>]: Infer<TShape[K]>;
  } & {
    -readonly [K in OptionalShapeKeys<TShape>]?: Exclude<Infer<TShape[K]>, undefined>;
  }
>;

export class ObjectSchema<TShape extends Record<string, unknown>> extends Schema<InferShape<TShape>> {
  public readonly shape: TShape;
  public constructor(shape: TShape) {
    super((input, path) => {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        fail('Expected object', path);
      }
      const source = input as Record<string, unknown>;
      const output: Record<string, unknown> = {};
      const issues: ValidationIssue[] = [];
      for (const [key, fieldSchema] of Object.entries(shape)) {
        const schema = fieldSchema as Schema<unknown>;
        const raw = source[key];
        try {
          const parsed = schema.parseAt(raw, [...path, key]);
          if (parsed !== undefined || Object.prototype.hasOwnProperty.call(source, key) || schema.metadata.hasDefault) {
            output[key] = parsed;
          }
        } catch (error) {
          if (error instanceof SchemaValidationError) issues.push(...error.issues);
          else issues.push({ code: 'custom', message: error instanceof Error ? error.message : String(error), path: [...path, key] });
        }
      }
      if (issues.length > 0) throw new SchemaValidationError(issues);
      return output as InferShape<TShape>;
    }, { kind: 'object' });
    this.shape = Object.freeze({ ...shape });
  }
}

export interface ListOptions {
  readonly separator?: string;
  readonly trim?: boolean;
  readonly skipEmpty?: boolean;
}

export interface DurationOptions {
  readonly unit?: 'ms' | 's';
}

export class v {
  public static string(): StringSchema {
    return new StringSchema();
  }

  public static number(): NumberSchema {
    return new NumberSchema();
  }

  public static boolean(): BooleanSchema {
    return new BooleanSchema();
  }

  public static port(): NumberSchema {
    return new NumberSchema().port();
  }

  public static enum<const TValues extends readonly string[]>(values: TValues): Schema<TValues[number]> {
    const allowed = [...values];
    return new Schema((input, path) => {
      const isAllowed = (value: string): value is TValues[number] => allowed.some((item) => item === value);
      if (typeof input !== 'string' || !isAllowed(input)) fail(`Expected one of: ${allowed.join(', ')}`, path, 'invalid_enum');
      return input;
    }, { kind: 'enum', enumValues: allowed });
  }

  public static literal<const TValue extends string | number | boolean | null>(value: TValue): Schema<TValue> {
    return new Schema((input, path) => {
      if (input !== value) fail(`Expected literal ${JSON.stringify(value)}`, path, 'invalid_literal');
      return value;
    }, { kind: 'literal', enumValues: [value] });
  }

  public static list<TItemSchema extends Schema<unknown> = StringSchema>(
    itemSchema?: TItemSchema,
    options: ListOptions = {},
  ): Schema<TItemSchema extends Schema<infer TItem> ? TItem[] : string[]> {
    const item = itemSchema ?? (new StringSchema() as unknown as TItemSchema);
    const separator = options.separator ?? ',';
    const trim = options.trim ?? true;
    const skipEmpty = options.skipEmpty ?? true;
    return new Schema((input, path) => {
      let items: unknown[];
      if (typeof input === 'string') items = input.split(separator);
      else if (Array.isArray(input)) items = input;
      else fail('Expected a delimited string or array', path);
      const values: unknown[] = [];
      const issues: ValidationIssue[] = [];
      for (const [index, raw] of items.entries()) {
        const value = typeof raw === 'string' && trim ? raw.trim() : raw;
        if (skipEmpty && (value === '' || value === undefined || value === null)) continue;
        try {
          values.push(item.parseAt(value, [...path, index]));
        } catch (error) {
          if (error instanceof SchemaValidationError) issues.push(...error.issues);
          else issues.push({ code: 'custom', message: error instanceof Error ? error.message : String(error), path: [...path, index] });
        }
      }
      if (issues.length) throw new SchemaValidationError(issues);
      return values as TItemSchema extends Schema<infer TItem> ? TItem[] : string[];
    }, { kind: 'list', constraints: { separator, trim, skipEmpty } });
  }

  public static array<TItemSchema extends Schema<unknown>>(itemSchema: TItemSchema): Schema<Infer<TItemSchema>[]> {
    return new Schema((input, path) => {
      let values: unknown = input;
      if (typeof values === 'string') {
        try { values = JSON.parse(values) as unknown; }
        catch { fail('Expected a valid JSON array', path, 'invalid_json'); }
      }
      if (!Array.isArray(values)) fail('Expected array', path);
      const output: Infer<TItemSchema>[] = [];
      const issues: ValidationIssue[] = [];
      values.forEach((value: unknown, index: number) => {
        try { output.push(itemSchema.parseAt(value, [...path, index]) as Infer<TItemSchema>); }
        catch (error) {
          if (error instanceof SchemaValidationError) issues.push(...error.issues);
          else issues.push({ code: 'custom', message: error instanceof Error ? error.message : String(error), path: [...path, index] });
        }
      });
      if (issues.length) throw new SchemaValidationError(issues);
      return output;
    }, { kind: 'array' });
  }

  public static object<const TShape extends Record<string, unknown>>(shape: TShape): ObjectSchema<TShape> {
    return new ObjectSchema(shape);
  }

  public static json<TInner extends Schema<unknown> | undefined = undefined>(innerSchema?: TInner): Schema<TInner extends Schema<infer TInnerOutput> ? TInnerOutput : unknown> {
    return new Schema((input, path) => {
      let parsed: unknown = input;
      if (typeof input === 'string') {
        try { parsed = JSON.parse(input) as unknown; }
        catch { fail('Expected valid JSON', path, 'invalid_json'); }
      }
      return innerSchema ? innerSchema.parseAt(parsed, path) as (TInner extends Schema<infer TInnerOutput> ? TInnerOutput : unknown) : parsed as (TInner extends Schema<infer TInnerOutput> ? TInnerOutput : unknown);
    }, { kind: 'json' });
  }

  public static duration(options: DurationOptions = {}): Schema<number> {
    const unit = options.unit ?? 'ms';
    const factors: Readonly<Record<string, number>> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return new Schema((input, path) => {
      if (typeof input === 'number' && Number.isFinite(input)) return unit === 'ms' ? input : input / 1_000;
      if (typeof input !== 'string') fail('Expected a duration string', path);
      const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\s*$/i.exec(input);
      if (!match) fail('Invalid duration. Use ms, s, m, h or d', path, 'invalid_duration');
      const amount = Number(match[1]);
      const suffix = match[2]?.toLowerCase();
      const milliseconds = amount * (factors[suffix ?? ''] ?? Number.NaN);
      if (!Number.isFinite(milliseconds)) fail('Invalid duration', path, 'invalid_duration');
      return unit === 'ms' ? milliseconds : milliseconds / 1_000;
    }, { kind: 'duration', constraints: { unit } });
  }

  public static union<const TSchemas extends readonly Schema<unknown>[]>(schemas: TSchemas): Schema<Infer<TSchemas[number]>> {
    return new Schema((input, path) => {
      const issues: ValidationIssue[] = [];
      for (const schema of schemas) {
        try { return schema.parseAt(input, path) as Infer<TSchemas[number]>; }
        catch (error) { if (error instanceof SchemaValidationError) issues.push(...error.issues); }
      }
      fail(issues.map((issue) => issue.message).join(' or ') || 'No union variant matched', path, 'invalid_union');
    }, { kind: 'union' });
  }

  public static unknown(): Schema<unknown> {
    return new Schema((input) => input, { kind: 'unknown' });
  }

  public static custom<TOutput>(validator: (input: unknown) => TOutput): Schema<TOutput> {
    return new Schema((input, path) => {
      try { return validator(input); }
      catch (error) { fail(error instanceof Error ? error.message : String(error), path, 'custom'); }
    }, { kind: 'custom' });
  }
}

/* eslint-disable @typescript-eslint/no-namespace -- Required to expose the public v.infer<T> namespace API. */
export namespace v {
  export type infer<TSchema> = Infer<TSchema>;
  export type inferShape<TShape extends Record<string, unknown>> = InferShape<TShape>;
}

export type { Infer as InferSchema, InferShape as InferObjectShape };
