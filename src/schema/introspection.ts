import { Schema, type SchemaMetadata } from './validators.js';
import { isJoiSchema, isSchemaLike } from './adapter.js';

export interface FieldDescription {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly type: string;
  readonly required: boolean;
  readonly hasDefault: boolean;
  readonly defaultValue?: unknown;
  readonly secret: boolean;
  readonly enumValues?: readonly unknown[];
  readonly example?: string;
  readonly placeholder?: string;
  readonly comment?: string;
  readonly group?: string;
  readonly deprecated?: boolean | string;
  readonly includeInExample: boolean;
  readonly minLength?: number;
  readonly min?: number;
  readonly constraints?: Readonly<Record<string, unknown>>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function getZodDefinition(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  const zod = asRecord(schema._zod);
  const def4 = asRecord(zod?.def);
  if (def4) return def4;
  const def3 = asRecord(schema._def);
  return def3;
}

function unwrapZodDefinition(definition: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  let current = definition;
  const visited = new Set<object>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const typeName = current.typeName ?? current.type;
    if (typeof typeName !== 'string') break;
    if (!['ZodDefault', 'ZodOptional', 'ZodNullable', 'ZodReadonly', 'ZodBranded', 'default', 'optional', 'nullable', 'readonly', 'branded'].includes(typeName)) break;
    const next = current.innerType ?? current.in ?? current.schema;
    current = asRecord(next);
  }
  return current;
}

function extractMinimumLength(definition: Record<string, unknown> | undefined): number | undefined {
  if (!definition) return undefined;
  const direct = definition.minLength;
  if (typeof direct === 'number') return direct;
  if (!Array.isArray(definition.checks)) return undefined;
  for (const item of definition.checks) {
    const check = asRecord(item);
    const checkDefinition = asRecord(asRecord(check?._zod)?.def) ?? check;
    const kind = checkDefinition?.kind ?? checkDefinition?.check;
    const value = checkDefinition?.value ?? checkDefinition?.minValue ?? checkDefinition?.minimum;
    if ((kind === 'min' || kind === 'min_length' || kind === 'minLength') && typeof value === 'number') return value;
  }
  return undefined;
}

function joiMeta(description: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(description.metas)) return undefined;
  const records = description.metas.map(asRecord).filter((item): item is Record<string, unknown> => item !== undefined);
  if (records.length === 0) return undefined;
  const metadata: Record<string, unknown> = {};
  for (const record of records) Object.assign(metadata, record);
  return metadata;
}

function joiRuleLimit(description: Record<string, unknown>, ruleName: string): number | undefined {
  if (!Array.isArray(description.rules)) return undefined;
  for (const item of description.rules) {
    const rule = asRecord(item);
    if (rule?.name !== ruleName) continue;
    const args = asRecord(rule.args);
    const limit = args?.limit ?? args?.length;
    if (typeof limit === 'number') return limit;
  }
  return undefined;
}

function getJoiDescription(schema: unknown): Record<string, unknown> | undefined {
  const object = asRecord(schema);
  if (!object) return undefined;
  if (isJoiSchema(object)) {
    return asRecord((object.describe as () => unknown).call(schema));
  }
  const looksLikeDescription = typeof object.type === 'string' && (
    'flags' in object || 'keys' in object || 'metas' in object || 'rules' in object || 'allow' in object
  );
  return looksLikeDescription ? object : undefined;
}

function inferKind(schema: unknown): string {
  if (schema instanceof Schema) return schema.metadata.kind ?? 'unknown';
  const object = asRecord(schema);
  if (!object) return 'unknown';
  const joiDescription = getJoiDescription(schema);
  if (joiDescription) return typeof joiDescription.type === 'string' ? joiDescription.type : 'unknown';
  const def = unwrapZodDefinition(getZodDefinition(object));
  const typeName = def?.typeName ?? def?.type;
  if (typeof typeName === 'string') {
    return typeName.replace(/^Zod/, '').toLowerCase();
  }
  if (typeof object['~standard'] === 'object') return 'standard-schema';
  return 'unknown';
}

function externalMetadata(schema: unknown): SchemaMetadata {
  if (schema instanceof Schema) return schema.metadata;
  const object = asRecord(schema);
  if (!object) return {};
  const joiDescription = getJoiDescription(schema);
  if (joiDescription) {
    const flags = asRecord(joiDescription.flags);
    const meta = joiMeta(joiDescription);
    const allowed = Array.isArray(joiDescription.allow)
      ? joiDescription.allow.filter((value: unknown) => typeof value === 'string' || typeof value === 'number')
      : undefined;
    const options = {
      ...(typeof meta?.example === 'string' ? { example: meta.example } : {}),
      ...(typeof meta?.placeholder === 'string' ? { placeholder: meta.placeholder } : {}),
      ...(typeof meta?.comment === 'string' ? { comment: meta.comment } : {}),
      ...(typeof meta?.group === 'string' ? { group: meta.group } : {}),
      ...(typeof meta?.deprecated === 'boolean' || typeof meta?.deprecated === 'string' ? { deprecated: meta.deprecated } : {}),
      ...(typeof meta?.includeInExample === 'boolean' ? { includeInExample: meta.includeInExample } : {}),
      ...(typeof meta?.secret === 'boolean' ? { secret: meta.secret } : {}),
    };
    const minLength = joiRuleLimit(joiDescription, 'min');
    const maxLength = joiRuleLimit(joiDescription, 'max');
    return {
      kind: typeof joiDescription.type === 'string' ? joiDescription.type : 'unknown',
      ...(typeof joiDescription.description === 'string' ? { description: joiDescription.description } : {}),
      ...(typeof meta?.name === 'string' ? { name: meta.name } : {}),
      ...(flags && Object.prototype.hasOwnProperty.call(flags, 'default') ? { hasDefault: true, defaultValue: flags.default } : {}),
      ...(flags?.presence === 'optional' || flags?.presence === 'forbidden' ? { optional: true } : {}),
      ...(allowed && allowed.length ? { enumValues: allowed } : {}),
      ...(meta?.secret === true ? { secret: true } : {}),
      ...(Object.keys(options).length ? { options } : {}),
      ...(minLength !== undefined ? { minLength } : {}),
      ...(maxLength !== undefined ? { maxLength } : {}),
    };
  }
  const wrapperDef = getZodDefinition(object);
  const def = unwrapZodDefinition(wrapperDef);
  const description = typeof object.description === 'string'
    ? object.description
    : typeof def?.description === 'string' ? def.description : undefined;
  let defaultValue: unknown;
  let hasDefault = false;
  let optional = false;
  let nullable = false;
  let wrapper = wrapperDef;
  const visited = new Set<object>();
  while (wrapper && !visited.has(wrapper)) {
    visited.add(wrapper);
    const typeName = wrapper.typeName ?? wrapper.type;
    if (typeName === 'ZodDefault' || typeName === 'default') {
      const value = wrapper.defaultValue ?? wrapper.default;
      if (typeof value === 'function') {
        try { defaultValue = (value as () => unknown)(); hasDefault = true; } catch { /* dynamic default cannot be evaluated safely */ }
      } else if (value !== undefined) {
        defaultValue = value;
        hasDefault = true;
      }
    }
    if (typeName === 'ZodOptional' || typeName === 'optional') optional = true;
    if (typeName === 'ZodNullable' || typeName === 'nullable') nullable = true;
    const next = wrapper.innerType ?? wrapper.in ?? wrapper.schema;
    wrapper = asRecord(next);
  }
  const values = def?.values ?? def?.entries;
  const enumValues = Array.isArray(values)
    ? values.filter((value: unknown): value is string | number => typeof value === 'string' || typeof value === 'number')
    : values !== null && typeof values === 'object'
      ? Object.values(values).filter((value: unknown): value is string | number => typeof value === 'string' || typeof value === 'number')
      : undefined;
  const minLength = extractMinimumLength(def);
  return {
    kind: inferKind(schema),
    ...(description ? { description } : {}),
    ...(hasDefault ? { hasDefault, defaultValue } : {}),
    ...(optional ? { optional: true } : {}),
    ...(nullable ? { nullable: true } : {}),
    ...(enumValues && enumValues.length ? { enumValues } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(typeof object.secret === 'boolean' ? { secret: object.secret } : {}),
  };
}

export function getSchemaMetadata(schema: unknown): SchemaMetadata {
  return externalMetadata(schema);
}

export function getShape(schema: unknown): Readonly<Record<string, unknown>> | undefined {
  if (schema instanceof Schema) {
    const shape = asRecord((schema as Schema<unknown> & { readonly shape?: unknown }).shape);
    if (shape) return shape;
  }
  const object = asRecord(schema);
  if (!object) return undefined;
  const joiDescription = getJoiDescription(schema);
  if (joiDescription) return asRecord(joiDescription.keys);
  if (!isSchemaLike(object)) return object;
  const def = unwrapZodDefinition(getZodDefinition(object));
  const shapeCandidate = def?.shape ?? asRecord(def?.schema)?.shape;
  if (typeof shapeCandidate === 'function') {
    try { return asRecord((shapeCandidate as () => unknown).call(def)); }
    catch { return undefined; }
  }
  return asRecord(shapeCandidate);
}

export function describeField(key: string, schema: unknown): FieldDescription {
  const metadata = externalMetadata(schema);
  const options = metadata.options ?? {};
  const kind = metadata.kind ?? inferKind(schema);
  const joiDescription = getJoiDescription(schema);
  const joiFlags = asRecord(joiDescription?.flags);
  const isJoi = joiDescription !== undefined;
  const required = isJoi
    ? joiFlags?.presence === 'required'
    : metadata.optional !== true && !metadata.hasDefault;
  const defaultValue = metadata.hasDefault ? metadata.defaultValue : joiFlags?.default;
  const values = metadata.enumValues ?? (Array.isArray(joiDescription?.allow) ? joiDescription.allow as readonly unknown[] : undefined);
  const description = metadata.description ?? (typeof joiDescription?.description === 'string' ? joiDescription.description : undefined);
  return {
    key,
    name: metadata.name ?? key,
    ...(description ? { description } : {}),
    type: kind,
    required,
    hasDefault: metadata.hasDefault === true || joiFlags?.default !== undefined,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    secret: metadata.secret === true || options.secret === true,
    ...(values && values.length ? { enumValues: values } : {}),
    ...(options.example !== undefined ? { example: options.example } : {}),
    ...(options.placeholder !== undefined ? { placeholder: options.placeholder } : {}),
    ...(options.comment !== undefined ? { comment: options.comment } : {}),
    ...(options.group !== undefined ? { group: options.group } : {}),
    ...(options.deprecated !== undefined ? { deprecated: options.deprecated } : {}),
    includeInExample: options.includeInExample !== false,
    ...(metadata.minLength !== undefined ? { minLength: metadata.minLength } : {}),
    ...(metadata.min !== undefined ? { min: metadata.min } : {}),
    ...(metadata.constraints ? { constraints: metadata.constraints } : {}),
  };
}

export function describeShape(shapeOrSchema: unknown): readonly FieldDescription[] {
  const shape = getShape(shapeOrSchema);
  if (!shape) return [];
  return Object.entries(shape).map(([key, schema]) => describeField(key, schema));
}

export function isSchema(value: unknown): boolean {
  return value instanceof Schema || isSchemaLike(value);
}
