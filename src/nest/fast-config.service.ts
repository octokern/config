import { inspect } from 'node:util';
import { normalizeDefinitions } from '../core/normalize.js';
import { validateConfigs, type ValidateConfigsOptions } from '../core/validator.js';
import type { ConfigDefinition } from '../core/config-definition.js';
import { ConfigNotRegisteredError, DuplicateConfigError } from '../core/errors.js';
import { FAST_CONFIG_SERVICE_REGISTRATION } from '../core/internal.js';
import {
  resolveEnvWithSources,
  type EnvSourceOptions,
  type ResolveEnvResult,
} from '../env/resolve-env.js';
import { getSchemaMetadata, getShape, type FieldDescription } from '../schema/introspection.js';

export interface FastConfigCreateOptions extends EnvSourceOptions, ValidateConfigsOptions {
  readonly load: ConfigDefinition | readonly ConfigDefinition[];
  readonly overrides?: readonly (readonly [ConfigDefinition, unknown])[];
}

export interface SnapshotOptions {
  readonly maskSecrets?: boolean;
}

interface MutableServiceState {
  readonly definitions: Map<string, ConfigDefinition>;
  readonly configs: Map<string, unknown>;
  readonly source: ResolveEnvResult;
}

const serviceStates = new WeakMap<FastConfigService, MutableServiceState>();

function deepFreeze<T>(value: T, seen = new WeakSet()): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  const candidate = value as object;
  if (seen.has(candidate)) return value;
  seen.add(candidate);
  const prototype = Object.getPrototypeOf(candidate) as object | null;
  if (Array.isArray(candidate) || prototype === Object.prototype || prototype === null) {
    for (const child of Object.values(candidate)) deepFreeze(child, seen);
    Object.freeze(candidate);
  }
  return value;
}

function collectSecretPaths(
  schema: unknown,
  prefix: readonly string[] = [],
  result = new Set<string>(),
): ReadonlySet<string> {
  const metadata = getSchemaMetadata(schema);
  if ((metadata.secret === true || metadata.options?.secret === true) && prefix.length > 0) {
    result.add(prefix.join('.'));
    return result;
  }
  const shape = getShape(schema);
  if (shape) {
    for (const [key, child] of Object.entries(shape))
      collectSecretPaths(child, [...prefix, key], result);
  }
  return result;
}

function cloneAndMask(value: unknown, secretPaths: ReadonlySet<string>, prefix = ''): unknown {
  if (Array.isArray(value))
    return value.map((item) => cloneAndMask(item, secretPaths, `${prefix}.*`));
  if (value === null || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    result[key] = secretPaths.has(path) ? '[REDACTED]' : cloneAndMask(child, secretPaths, path);
  }
  return result;
}

export class FastConfigService {
  private readonly warningList: readonly string[];

  public constructor(
    registration: symbol,
    definitions: readonly ConfigDefinition[],
    configs: Readonly<Record<string, unknown>>,
    source: ResolveEnvResult,
    warnings: readonly string[] = [],
  ) {
    if (registration !== FAST_CONFIG_SERVICE_REGISTRATION) {
      throw new TypeError(
        'FastConfigService must be created by FastConfigModule or FastConfigService.create()',
      );
    }
    serviceStates.set(this, {
      definitions: new Map(definitions.map((definition) => [definition.name, definition])),
      configs: new Map(Object.entries(configs).map(([name, value]) => [name, deepFreeze(value)])),
      source,
    });
    this.warningList = Object.freeze([...warnings]);
    Object.freeze(this);
  }

  public static create(options: FastConfigCreateOptions): FastConfigService {
    const definitions = normalizeDefinitions(options.load);
    const source = resolveEnvWithSources(options);
    const fileSecretSuffix =
      options.fileSecrets && typeof options.fileSecrets === 'object'
        ? (options.fileSecrets.suffix ?? '_FILE')
        : '_FILE';
    const validated = validateConfigs(definitions, source.env, {
      ...options,
      fileSecretSuffix,
      origins: source.origins,
      envFileKeys: source.envFileKeys,
    });
    const configs: Record<string, unknown> = { ...validated.configs };
    for (const [definition, value] of options.overrides ?? []) {
      if (!definitions.some((candidate) => candidate === definition)) {
        throw new ConfigNotRegisteredError(definition.name);
      }
      configs[definition.name] = value;
    }
    return new FastConfigService(
      FAST_CONFIG_SERVICE_REGISTRATION,
      definitions,
      configs,
      source,
      validated.warnings,
    );
  }

  public get<TOutput>(definition: ConfigDefinition<TOutput>): TOutput {
    const state = serviceStates.get(this);
    if (state?.definitions.get(definition.name) !== definition) {
      throw new ConfigNotRegisteredError(definition.name);
    }
    return state.configs.get(definition.name) as TOutput;
  }

  public has(definitionOrName: ConfigDefinition | string): boolean {
    const state = serviceStates.get(this);
    if (!state) return false;
    if (typeof definitionOrName === 'string') return state.definitions.has(definitionOrName);
    return state.definitions.get(definitionOrName.name) === definitionOrName;
  }

  public names(): readonly string[] {
    const state = serviceStates.get(this);
    return Object.freeze(state ? [...state.definitions.keys()] : []);
  }

  public loadedFiles(): readonly string[] {
    return serviceStates.get(this)?.source.loadedFiles ?? [];
  }

  public warnings(): readonly string[] {
    return this.warningList;
  }

  public describe(): Readonly<Record<string, readonly FieldDescription[]>> {
    const description: Record<string, readonly FieldDescription[]> = {};
    const state = serviceStates.get(this);
    if (state) {
      for (const [name, definition] of state.definitions)
        description[name] = definition.describeFields();
    }
    return Object.freeze(description);
  }

  public snapshot(options: SnapshotOptions = {}): Readonly<Record<string, unknown>> {
    const maskSecrets = options.maskSecrets ?? true;
    const result: Record<string, unknown> = {};
    const state = serviceStates.get(this);
    if (!state) return Object.freeze(result);
    for (const [name, definition] of state.definitions) {
      const value = state.configs.get(name);
      if (!maskSecrets) {
        result[name] = value;
        continue;
      }
      const secrets = new Set<string>([
        ...collectSecretPaths(definition.schema),
        ...definition.secretPaths(),
      ]);
      result[name] = cloneAndMask(value, secrets);
    }
    return deepFreeze(result);
  }

  public toJSON(): Readonly<Record<string, unknown>> {
    return this.snapshot();
  }

  public [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `FastConfigService ${inspect(this.snapshot(), { depth: 5, colors: false })}`;
  }
}

/** Internal bridge used only by FastConfigModule.forFeature(). */
export function registerFeatureConfig(
  service: FastConfigService,
  definition: ConfigDefinition,
): unknown {
  const state = serviceStates.get(service);
  if (!state) throw new TypeError('Invalid FastConfigService instance');
  const existing = state.definitions.get(definition.name);
  if (existing) {
    if (existing !== definition) throw new DuplicateConfigError(definition.name);
    return state.configs.get(definition.name);
  }
  const validated = validateConfigs([definition], state.source.env, {
    origins: state.source.origins,
    envFileKeys: state.source.envFileKeys,
  });
  const value = validated.configs[definition.name];
  state.definitions.set(definition.name, definition);
  state.configs.set(definition.name, deepFreeze(value));
  return value;
}
