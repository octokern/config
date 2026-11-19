import {
  Schema,
  SchemaValidationError,
  type ValidationIssue,
} from './validators.js';

export interface AdapterSuccess<T = unknown> {
  readonly success: true;
  readonly data: T;
}
export interface AdapterFailure {
  readonly success: false;
  readonly issues: readonly ValidationIssue[];
}
export type AdapterResult<T = unknown> = AdapterSuccess<T> | AdapterFailure;

export interface StandardValidationIssueLike {
  readonly message?: unknown;
  readonly path?: readonly (string | number | { readonly key?: unknown })[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function pathFromUnknown(path: unknown): readonly (string | number)[] {
  if (!Array.isArray(path)) return [];
  return path.map((segment: unknown) => {
    if (typeof segment === 'string' || typeof segment === 'number') return segment;
    const item = record(segment);
    return typeof item?.key === 'string' || typeof item?.key === 'number'
      ? item.key
      : String(segment);
  });
}

function issuesFromUnknown(value: unknown, fallbackPath: readonly (string | number)[]): readonly ValidationIssue[] {
  if (!Array.isArray(value)) {
    return [{ code: 'external_validation', message: 'Schema validation failed', path: fallbackPath }];
  }
  return value.map((item: unknown) => {
    const issue = record(item);
    return {
      code: typeof issue?.code === 'string' ? issue.code : 'external_validation',
      message: typeof issue?.message === 'string' ? issue.message : 'Schema validation failed',
      path: [...fallbackPath, ...pathFromUnknown(issue?.path ?? issue?.instancePath)],
    };
  });
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  const candidate = record(value);
  return typeof candidate?.then === 'function';
}

function parseStandard(schema: Record<string, unknown>, input: unknown, path: readonly (string | number)[]): AdapterResult {
  const standard = record(schema['~standard']);
  if (!standard || typeof standard.validate !== 'function') {
    return { success: false, issues: [{ code: 'invalid_schema', message: 'Invalid Standard Schema v1 implementation', path }] };
  }
  let result: unknown;
  try {
    result = (standard.validate as (value: unknown) => unknown)(input);
  } catch (error) {
    return { success: false, issues: [{ code: 'external_validation', message: error instanceof Error ? error.message : String(error), path }] };
  }
  if (isPromiseLike(result)) {
    return { success: false, issues: [{ code: 'async_schema', message: 'Asynchronous Standard Schema validators are not supported by synchronous configuration loading', path }] };
  }
  const output = record(result);
  if (!output) return { success: false, issues: [{ code: 'invalid_schema', message: 'Standard Schema returned an invalid result', path }] };
  if (Array.isArray(output.issues)) {
    return { success: false, issues: issuesFromUnknown(output.issues, path) };
  }
  if ('value' in output) return { success: true, data: output.value };
  return { success: false, issues: [{ code: 'invalid_schema', message: 'Standard Schema returned neither value nor issues', path }] };
}

function parseZod(schema: Record<string, unknown>, input: unknown, path: readonly (string | number)[]): AdapterResult {
  if (typeof schema.safeParse === 'function') {
    try {
      const result = record((schema.safeParse as (value: unknown) => unknown).call(schema, input));
      if (result?.success === true) return { success: true, data: result.data };
      if (result?.success === false) {
        const error = record(result.error);
        return { success: false, issues: issuesFromUnknown(error?.issues, path) };
      }
    } catch (error) {
      return { success: false, issues: [{ code: 'external_validation', message: error instanceof Error ? error.message : String(error), path }] };
    }
  }
  return { success: false, issues: [{ code: 'invalid_schema', message: 'Zod schema does not expose safeParse()', path }] };
}

function parseJoi(schema: Record<string, unknown>, input: unknown, path: readonly (string | number)[]): AdapterResult {
  if (typeof schema.validate !== 'function') {
    return { success: false, issues: [{ code: 'invalid_schema', message: 'Joi schema does not expose validate()', path }] };
  }
  try {
    const result = record((schema.validate as (value: unknown, options: unknown) => unknown).call(schema, input, {
      abortEarly: false,
      convert: true,
    }));
    if (!result) return { success: false, issues: [{ code: 'invalid_schema', message: 'Joi returned an invalid result', path }] };
    const error = record(result.error);
    if (error) {
      const details = Array.isArray(error.details) ? error.details : [];
      const issues = details.map((detail: unknown) => {
        const item = record(detail);
        return {
          code: typeof item?.type === 'string' ? item.type : 'joi_validation',
          message: typeof item?.message === 'string' ? item.message : 'Joi validation failed',
          path: [...path, ...pathFromUnknown(item?.path)],
        };
      });
      return { success: false, issues: issues.length ? issues : [{ code: 'joi_validation', message: typeof error.message === 'string' ? error.message : 'Joi validation failed', path }] };
    }
    return { success: true, data: result.value };
  } catch (error) {
    return { success: false, issues: [{ code: 'external_validation', message: error instanceof Error ? error.message : String(error), path }] };
  }
}

export function isStandardSchema(value: unknown): boolean {
  const object = record(value);
  const standard = record(object?.['~standard']);
  return standard?.version === 1 && typeof standard.validate === 'function';
}

export function isJoiSchema(value: unknown): boolean {
  const object = record(value);
  return object?.isJoi === true && typeof object.validate === 'function';
}

export function isZodSchema(value: unknown): boolean {
  const object = record(value);
  return typeof object?.safeParse === 'function' && ('_def' in object || '_zod' in object);
}

export function isSchemaLike(value: unknown): boolean {
  if (value instanceof Schema) return true;
  const object = record(value);
  return Boolean(
    object &&
      (isStandardSchema(object) ||
        isJoiSchema(object) ||
        isZodSchema(object) ||
        typeof object.parse === 'function'),
  );
}

export function parseWithSchema(
  schema: unknown,
  input: unknown,
  path: readonly (string | number)[] = [],
): AdapterResult {
  if (schema instanceof Schema) {
    try {
      return { success: true, data: schema.parseAt(input, path) };
    } catch (error) {
      if (error instanceof SchemaValidationError) return { success: false, issues: error.issues };
      return { success: false, issues: [{ code: 'custom', message: error instanceof Error ? error.message : String(error), path }] };
    }
  }
  const object = record(schema);
  if (!object) return { success: false, issues: [{ code: 'invalid_schema', message: 'Invalid schema definition', path }] };
  if (isStandardSchema(object)) return parseStandard(object, input, path);
  if (isJoiSchema(object)) return parseJoi(object, input, path);
  if (isZodSchema(object)) return parseZod(object, input, path);
  if (typeof object.parse === 'function') {
    try {
      return { success: true, data: (object.parse as (value: unknown) => unknown).call(schema, input) };
    } catch (error) {
      const errorObject = record(error);
      const issues = errorObject?.issues;
      if (Array.isArray(issues)) return { success: false, issues: issuesFromUnknown(issues, path) };
      return { success: false, issues: [{ code: 'external_validation', message: error instanceof Error ? error.message : String(error), path }] };
    }
  }
  return { success: false, issues: [{ code: 'invalid_schema', message: 'Unsupported schema implementation', path }] };
}

export function validateSchema<T = unknown>(schema: unknown, rawInput: unknown): AdapterResult<T> {
  return parseWithSchema(schema, rawInput) as AdapterResult<T>;
}
