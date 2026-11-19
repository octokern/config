import { isSchemaLike, parseWithSchema } from '../schema/adapter.js';
import { describeShape, getSchemaMetadata, getShape, type FieldDescription } from '../schema/introspection.js';
import type { ValidationIssue } from '../schema/validators.js';
import type { Infer, InferShape } from '../schema/validators.js';
import { CONFIG_DEFINITION } from './internal.js';
import { ConfigValidationError, type ConfigIssue } from './errors.js';
import { withTypoSuggestion } from './typo.js';

export type ConfigShape = Readonly<Record<string, unknown>>;
export type ConfigOutput<TSchema> = TSchema extends ConfigShape
  ? InferShape<TSchema extends Record<string, unknown> ? TSchema : Record<string, unknown>>
  : TSchema extends { readonly _output: infer TOutput }
    ? TOutput
    : TSchema extends { readonly '~standard': { readonly types?: { readonly output: infer TOutput } } }
      ? TOutput
      : TSchema extends { readonly parse: (input: unknown) => infer TOutput }
          ? TOutput
          : Infer<TSchema>;

export interface ConfigParseOptions {
  readonly emptyAsUndefined?: boolean;
}

export interface ConfigSafeParseSuccess<T> {
  readonly success: true;
  readonly data: T;
}
export interface ConfigSafeParseFailure {
  readonly success: false;
  readonly error: ConfigValidationError;
  readonly issues: readonly ConfigIssue[];
}
export type ConfigSafeParseReturn<T> = ConfigSafeParseSuccess<T> | ConfigSafeParseFailure;

export interface DefineEnvConfigOptions {
  readonly emptyAsUndefined?: boolean;
}

type ConfigOperation =
  | { readonly kind: 'transform'; readonly transform: (value: unknown) => unknown }
  | {
      readonly kind: 'refine';
      readonly predicate: (value: unknown) => boolean;
      readonly message: string;
      readonly path: readonly (string | number)[];
    };

interface InternalConfigState {
  readonly pipeline: readonly ConfigOperation[];
  readonly secretKeys: readonly string[];
  readonly secretPatterns: readonly RegExp[];
  readonly emptyAsUndefined: boolean;
}


function readRawValue(raw: Readonly<Record<string, unknown>>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(raw, key)) return raw[key];
  const upper = key.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(raw, upper)) return raw[upper];
  return undefined;
}

function readRawPath(raw: Readonly<Record<string, unknown>>, path: readonly string[]): unknown {
  const first = path[0];
  if (!first) return undefined;
  let value: unknown = readRawValue(raw, first);
  for (const segment of path.slice(1)) {
    if (typeof value === 'string') {
      try {
        const decoded: unknown = JSON.parse(value);
        if (decoded !== null && typeof decoded === 'object') value = decoded;
      } catch { return value; }
    }
    if (value === null || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    value = Object.prototype.hasOwnProperty.call(record, segment)
      ? record[segment]
      : record[segment.toUpperCase()];
  }
  return value;
}

function maskMessage(message: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return message;
  if (value.length < 4) return 'Invalid value (details hidden: secret)';
  return message.split(value).join('[REDACTED]');
}

export class ConfigDefinition<TOutput = unknown> {
  public readonly [CONFIG_DEFINITION] = true;
  public readonly name: string;
  public readonly schema: unknown;
  private readonly state: InternalConfigState;

  public constructor(name: string, schema: unknown, state?: Partial<InternalConfigState>) {
    if (!name.trim()) throw new TypeError('Configuration name must not be empty');
    this.name = name;
    this.schema = schema;
    this.state = Object.freeze({
      pipeline: Object.freeze([...(state?.pipeline ?? [])]),
      secretKeys: Object.freeze([...(state?.secretKeys ?? [])]),
      secretPatterns: Object.freeze([...(state?.secretPatterns ?? [])]),
      emptyAsUndefined: state?.emptyAsUndefined ?? true,
    });
    Object.freeze(this);
  }

  private withState<TNext = TOutput>(state: Partial<InternalConfigState>): ConfigDefinition<TNext> {
    const nextState: InternalConfigState = {
      pipeline: state.pipeline ?? this.state.pipeline,
      secretKeys: state.secretKeys ?? this.state.secretKeys,
      secretPatterns: state.secretPatterns ?? this.state.secretPatterns,
      emptyAsUndefined: state.emptyAsUndefined ?? this.state.emptyAsUndefined,
    };
    return new ConfigDefinition<TNext>(this.name, this.schema, nextState);
  }

  public transform<TNew>(transformer: (value: TOutput) => TNew): ConfigDefinition<TNew> {
    return this.withState<TNew>({
      pipeline: [...this.state.pipeline, {
        kind: 'transform',
        transform: (value) => transformer(value as TOutput),
      }],
    });
  }

  public refine(
    predicate: (value: TOutput) => boolean,
    messageOrOptions: string | { readonly message: string; readonly path?: readonly (string | number)[] },
  ): ConfigDefinition<TOutput> {
    const message = typeof messageOrOptions === 'string' ? messageOrOptions : messageOrOptions.message;
    const path = typeof messageOrOptions === 'string' ? [] : [...(messageOrOptions.path ?? [])];
    return this.withState({
      pipeline: [...this.state.pipeline, {
        kind: 'refine',
        predicate: (value) => predicate(value as TOutput),
        message,
        path,
      }],
    });
  }

  public secrets(...keys: readonly (TOutput extends object ? keyof TOutput : never)[]): ConfigDefinition<TOutput> {
    return this.withState({ secretKeys: [...new Set([...this.state.secretKeys, ...keys.map(String)])] });
  }

  public secretsMatching(...patterns: readonly RegExp[]): ConfigDefinition<TOutput> {
    return this.withState({ secretPatterns: [...this.state.secretPatterns, ...patterns] });
  }

  public emptyAsUndefined(enabled = true): ConfigDefinition<TOutput> {
    return this.withState({ emptyAsUndefined: enabled });
  }

  public describeFields(): readonly FieldDescription[] {
    const secretPaths = this.getSecretFieldPaths(this.getFieldSchemas());
    return Object.freeze(describeShape(this.schema).map((field) => Object.freeze({
      ...field,
      secret: field.secret || this.isSecret(field.key) || secretPaths.some((secretPath) => secretPath === field.key || secretPath.startsWith(`${field.key}.`)),
    })));
  }

  private isSecret(key: string): boolean {
    return this.state.secretKeys.includes(key) || this.state.secretPatterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(key);
    });
  }

  private getPlainShape(): Readonly<Record<string, unknown>> | undefined {
    if (this.schema === null || typeof this.schema !== 'object' || Array.isArray(this.schema) || isSchemaLike(this.schema)) {
      return undefined;
    }
    return this.schema as Readonly<Record<string, unknown>>;
  }

  private getFieldSchemas(): Readonly<Record<string, unknown>> | undefined {
    return getShape(this.schema);
  }

  public safeParse(rawEnv: Readonly<Record<string, unknown>>, options: ConfigParseOptions = {}): ConfigSafeParseReturn<TOutput> {
    const emptyAsUndefined = options.emptyAsUndefined ?? this.state.emptyAsUndefined;
    const fields = this.getFieldSchemas();
    const plainShape = this.getPlainShape();
    let parsed: unknown;
    const validationIssues: ValidationIssue[] = [];

    if (plainShape) {
      const result: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(plainShape)) {
        let raw = readRawValue(rawEnv, key);
        if (emptyAsUndefined && typeof raw === 'string' && raw.trim() === '') raw = undefined;
        const fieldResult = parseWithSchema(schema, raw, [key]);
        if (fieldResult.success) {
          if (fieldResult.data !== undefined || Object.prototype.hasOwnProperty.call(rawEnv, key) || this.fieldHasDefault(schema)) {
            result[key] = fieldResult.data;
          }
        } else {
          validationIssues.push(...fieldResult.issues);
        }
      }
      parsed = result;
    } else {
      const normalized = { ...rawEnv };
      if (emptyAsUndefined) {
        for (const [key, value] of Object.entries(normalized)) {
          if (typeof value === 'string' && value.trim() === '') normalized[key] = undefined;
        }
      }
      const rootResult = parseWithSchema(this.schema, normalized, []);
      if (rootResult.success) parsed = rootResult.data;
      else validationIssues.push(...rootResult.issues);
    }

    if (validationIssues.length > 0) return this.failure(validationIssues, rawEnv, fields);

    for (const operation of this.state.pipeline) {
      if (operation.kind === 'transform') {
        try {
          parsed = operation.transform(parsed);
        } catch (error) {
          return this.failure([{
            code: 'transform_failed',
            message: error instanceof Error ? error.message : String(error),
            path: [],
          }], rawEnv, fields);
        }
      } else {
        const valid = (() => {
          try { return operation.predicate(parsed); }
          catch { return false; }
        })();
        if (!valid) {
          return this.failure([{
            code: 'custom',
            message: operation.message,
            path: operation.path,
          }], rawEnv, fields);
        }
      }
    }

    return { success: true, data: parsed as TOutput };
  }

  private fieldHasDefault(schema: unknown): boolean {
    return getSchemaMetadata(schema).hasDefault === true;
  }

  private failure(
    sourceIssues: readonly ValidationIssue[],
    rawEnv: Readonly<Record<string, unknown>>,
    fields: Readonly<Record<string, unknown>> | undefined,
  ): ConfigSafeParseFailure {
    const providedKeys = Object.keys(rawEnv);
    const issues = sourceIssues.map((issue) => {
      const first = issue.path[0];
      const firstKey = typeof first === 'string' ? first : undefined;
      const key = issue.path.length ? issue.path.map(String).join('.') : undefined;
      let message = issue.message;
      const issuePath = issue.path.map(String);
      const secretPaths = this.getSecretFieldPaths(fields);
      const issuePathText = issuePath.join('.');
      const secretAncestor = issuePathText.length > 0 && secretPaths.some((secretPath) => secretPath.startsWith(`${issuePathText}.`));
      const secret = firstKey
        ? this.isSecret(firstKey) || this.isSecret(issuePathText) || secretAncestor || secretPaths.some((secretPath) => secretPath === issuePathText || issuePathText.startsWith(`${secretPath}.`))
        : secretPaths.length > 0;
      if (secret) {
        if (secretAncestor) {
          message = 'Invalid value (details hidden: secret)';
        } else if (firstKey) {
          message = maskMessage(message, readRawPath(rawEnv, issuePath));
        } else {
          for (const secretPath of secretPaths) {
            message = maskMessage(message, readRawPath(rawEnv, secretPath.split('.')));
          }
        }
      }
      if (firstKey && issue.path.length === 1 && fields && readRawValue(rawEnv, firstKey) === undefined) {
        message = withTypoSuggestion(message, firstKey, providedKeys);
      }
      return {
        configName: this.name,
        ...(key ? { key } : {}),
        path: issue.path,
        code: issue.code,
        message,
      } satisfies ConfigIssue;
    });
    const error = new ConfigValidationError(issues);
    return { success: false, error, issues: error.issues };
  }

  private isSchemaSecret(schema: unknown): boolean {
    const metadata = getSchemaMetadata(schema);
    return metadata.secret === true || metadata.options?.secret === true;
  }

  private getSecretFieldPaths(fields: Readonly<Record<string, unknown>> | undefined): readonly string[] {
    const paths = new Set<string>(this.state.secretKeys);
    const visit = (shape: Readonly<Record<string, unknown>>, prefix: readonly string[]): void => {
      for (const [key, schema] of Object.entries(shape)) {
        const current = [...prefix, key];
        const joined = current.join('.');
        if (this.isSecret(key) || this.isSecret(joined) || this.isSchemaSecret(schema)) {
          paths.add(joined);
          continue;
        }
        const nested = getShape(schema);
        if (nested) visit(nested, current);
      }
    };
    if (fields) visit(fields, []);
    return Object.freeze([...paths]);
  }

  /** @internal Read-only secret paths used by diagnostics and immutable snapshots. */
  public secretPaths(): readonly string[] {
    return this.getSecretFieldPaths(this.getFieldSchemas());
  }

  public parse(rawEnv: Readonly<Record<string, unknown>>, options: ConfigParseOptions = {}): TOutput {
    const result = this.safeParse(rawEnv, options);
    if (!result.success) throw result.error;
    return result.data;
  }
}

export function defineEnvConfig<const TSchema>(
  name: string,
  shapeOrSchema: TSchema,
  options: DefineEnvConfigOptions = {},
): ConfigDefinition<ConfigOutput<TSchema>> {
  return new ConfigDefinition<ConfigOutput<TSchema>>(name, shapeOrSchema, {
    emptyAsUndefined: options.emptyAsUndefined ?? true,
  });
}

export function isConfigDefinition(value: unknown): value is ConfigDefinition {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<PropertyKey, unknown>;
  return candidate[CONFIG_DEFINITION] === true && typeof candidate.name === 'string' && 'schema' in candidate;
}

export type ConfigOf<TDefinition> = TDefinition extends ConfigDefinition<infer TOutput> ? TOutput : never;
