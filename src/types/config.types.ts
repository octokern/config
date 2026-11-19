import type { AnySchema } from './schema.types.js';
import type { ConfigDefinition, ConfigOutput as ConfigOutputType } from '../core/config-definition.js';

export interface ConfigLoaderOptions {
  readonly envPath?: string | readonly string[];
  readonly failFast?: boolean;
  readonly ignoreEnvFile?: boolean;
}

export type ConfigSchemaDefinition<T extends Record<string, AnySchema>> = T;
export type ConfigOutput<T> = T extends ConfigDefinition<infer TOutput>
  ? TOutput
  : T extends Record<string, unknown>
    ? { [K in keyof T]: T[K] extends AnySchema<infer TOutput> ? TOutput : unknown }
    : ConfigOutputType<T>;
