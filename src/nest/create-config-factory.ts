import { Module, type DynamicModule, type InjectionToken, type Provider } from '@nestjs/common';
import { normalizeDefinitions } from '../core/normalize.js';
import type { ConfigDefinition, ConfigOf } from '../core/config-definition.js';
import { getConfigToken } from './tokens.js';

export interface ConfigFactoryAsyncOptions {
  readonly imports?: readonly DynamicModule[];
}

export interface ConfigFactoryDescriptor<TOutput, TArguments extends readonly unknown[] = readonly unknown[]> {
  readonly provide: symbol;
  readonly inject: readonly InjectionToken[];
  readonly useFactory: (...configs: TArguments) => TOutput;
  asAsync(options?: ConfigFactoryAsyncOptions): DynamicModule;
}

@Module({})
class ConfigFactoryModule {
  public static readonly moduleToken = Symbol.for('@octokern/config/factory-module');
}

type ConfigTuple<TDefinitions extends readonly ConfigDefinition[]> = {
  readonly [Index in keyof TDefinitions]: TDefinitions[Index] extends ConfigDefinition<infer TOutput> ? TOutput : never;
};

export function createConfigFactory<TDefinition extends ConfigDefinition, TOutput>(
  defOrDefs: TDefinition,
  factory: (config: ConfigOf<TDefinition>) => TOutput,
): ConfigFactoryDescriptor<TOutput, readonly [ConfigOf<TDefinition>]>;
export function createConfigFactory<TDefinitions extends readonly [ConfigDefinition, ...ConfigDefinition[]], TOutput>(
  defOrDefs: TDefinitions,
  factory: (...configs: ConfigTuple<TDefinitions>) => TOutput,
): ConfigFactoryDescriptor<TOutput, ConfigTuple<TDefinitions>>;
export function createConfigFactory<TOutput>(
  defOrDefs: ConfigDefinition | readonly ConfigDefinition[],
  factory: (...configs: unknown[]) => TOutput,
): ConfigFactoryDescriptor<TOutput> {
  const definitions = normalizeDefinitions(defOrDefs);
  const provide = Symbol.for(`@octokern/config/factory:${definitions.map((definition) => definition.name).join('+')}`);
  const inject = Object.freeze(definitions.map((definition) => getConfigToken(definition)));
  const useFactory = (...configs: readonly unknown[]): TOutput => factory(...configs);
  return Object.freeze({
    provide,
    inject,
    useFactory,
    asAsync(options: ConfigFactoryAsyncOptions = {}): DynamicModule {
      const provider: Provider = {
        provide,
        inject: [...inject],
        useFactory: (...configs: unknown[]) => factory(...configs),
      };
      return {
        module: ConfigFactoryModule,
        imports: [...(options.imports ?? [])],
        providers: [provider],
        exports: [provide],
      };
    },
  });
}
