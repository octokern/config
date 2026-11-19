import {
  type DynamicModule,
  Inject,
  Logger,
  Module,
  Optional,
  type InjectionToken,
  type Provider,
} from '@nestjs/common';
import { normalizeDefinitions } from '../core/normalize.js';
import type { ConfigDefinition } from '../core/config-definition.js';
import type { StrictOption } from '../core/validator.js';
import { DuplicateConfigError } from '../core/errors.js';
import { FAST_CONFIG_SERVICE } from '../core/internal.js';
import type { EnvSourceOptions } from '../env/resolve-env.js';
import { getConfigToken } from './tokens.js';
import { FastConfigService, registerFeatureConfig, type FastConfigCreateOptions } from './fast-config.service.js';

export interface FastConfigModuleOptions extends Omit<FastConfigCreateOptions, 'load'> {
  readonly load: ConfigDefinition | readonly ConfigDefinition[];
  readonly isGlobal?: boolean;
  readonly logOnInit?: boolean;
}

export interface FastConfigModuleAsyncOptions {
  readonly imports?: readonly DynamicModule[] | readonly unknown[];
  readonly inject?: readonly InjectionToken[];
  readonly load: ConfigDefinition | readonly ConfigDefinition[];
  readonly useFactory: (...dependencies: unknown[]) => EnvSourceOptions | Promise<EnvSourceOptions>;
  readonly isGlobal?: boolean;
  readonly logOnInit?: boolean;
  readonly strict?: StrictOption;
}

export interface FastConfigTestOptions {
  readonly load: ConfigDefinition | readonly ConfigDefinition[];
  readonly env?: Readonly<Record<string, unknown>>;
  readonly overrides?: readonly (readonly [ConfigDefinition, unknown])[];
  readonly isGlobal?: boolean;
}

const registeredFeatures = new Map<string, ConfigDefinition>();

function serviceProviders(service: FastConfigService, definitions: readonly ConfigDefinition[]): Provider[] {
  const providers: Provider[] = [
    { provide: FastConfigService, useValue: service },
    { provide: FAST_CONFIG_SERVICE, useValue: service },
  ];
  for (const definition of definitions) {
    providers.push({ provide: getConfigToken(definition), useValue: service.get(definition) });
  }
  return providers;
}

function createModuleOptionsProvider(logOnInit: boolean): Provider[] {
  return logOnInit ? [{ provide: CONFIG_LOGGING_OPTIONS, useValue: { enabled: true } }, ConfigLoggingLifecycle] : [];
}

const CONFIG_LOGGING_OPTIONS = Symbol.for('@octokern/config/logging-options');

function formatEnvValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

class ConfigLoggingLifecycle {
  public constructor(
    @Optional() @Inject(CONFIG_LOGGING_OPTIONS) private readonly options: { readonly enabled: boolean } | undefined,
    @Optional() @Inject(FastConfigService) private readonly configService: FastConfigService | undefined,
  ) {}

  public onModuleInit(): void {
    if (!this.options?.enabled || !this.configService) return;
    const logger = new Logger('OctokernConfig');
    logger.log(`Loaded configurations: ${this.configService.names().join(', ') || '(none)'}`);
    const files = this.configService.loadedFiles();
    if (files.length) logger.log(`Environment files: ${files.join(', ')}`);
    for (const warning of this.configService.warnings()) logger.warn(warning);
  }
}

@Module({})
export class FastConfigModule {
  public static forRoot(options: FastConfigModuleOptions): DynamicModule {
    const definitions = normalizeDefinitions(options.load);
    const service = FastConfigService.create(options);
    const providers = [
      ...serviceProviders(service, definitions),
      ...createModuleOptionsProvider(options.logOnInit ?? false),
    ];
    const exported: InjectionToken[] = [FastConfigService, FAST_CONFIG_SERVICE, ...definitions.map(getConfigToken)];
    return {
      module: FastConfigModule,
      global: options.isGlobal ?? true,
      providers,
      exports: exported,
    };
  }

  public static forRootAsync(options: FastConfigModuleAsyncOptions): DynamicModule {
    const definitions = normalizeDefinitions(options.load);
    const serviceProvider: Provider = {
      provide: FastConfigService,
      inject: [...(options.inject ?? [])],
      useFactory: async (...dependencies: unknown[]) => {
        const sourceOptions = await options.useFactory(...dependencies);
        return FastConfigService.create({
          ...sourceOptions,
          load: definitions,
          ...(options.strict !== undefined ? { strict: options.strict } : {}),
        });
      },
    };
    const providers: Provider[] = [
      serviceProvider,
      { provide: FAST_CONFIG_SERVICE, useExisting: FastConfigService },
      ...definitions.map((definition): Provider => ({
        provide: getConfigToken(definition),
        inject: [FastConfigService],
        useFactory: (...dependencies: unknown[]) => {
          const service = dependencies[0];
          if (!(service instanceof FastConfigService)) throw new TypeError('FastConfigService provider is not available');
          return service.get(definition);
        },
      })),
      ...createModuleOptionsProvider(options.logOnInit ?? false),
    ];
    const exported: InjectionToken[] = [FastConfigService, FAST_CONFIG_SERVICE, ...definitions.map(getConfigToken)];
    return {
      module: FastConfigModule,
      global: options.isGlobal ?? true,
      imports: [...(options.imports ?? [])] as DynamicModule[],
      providers,
      exports: exported,
    };
  }

  public static forFeature(load: ConfigDefinition | readonly ConfigDefinition[]): DynamicModule {
    const definitions = normalizeDefinitions(load);
    for (const definition of definitions) {
      const previous = registeredFeatures.get(definition.name);
      if (previous && previous !== definition) throw new DuplicateConfigError(definition.name);
      registeredFeatures.set(definition.name, definition);
    }
    const providers: Provider[] = definitions.map((definition) => ({
      provide: getConfigToken(definition),
      inject: [FastConfigService],
      useFactory: (...dependencies: unknown[]) => {
        const service = dependencies[0];
        if (!(service instanceof FastConfigService)) {
          throw new TypeError('FastConfigModule.forFeature() requires FastConfigModule.forRoot() in an imported module');
        }
        return registerFeatureConfig(service, definition);
      },
    }));
    return {
      module: FastConfigModule,
      providers,
      exports: definitions.map(getConfigToken),
    };
  }

  public static forTest(options: FastConfigTestOptions): DynamicModule {
    const definitions = normalizeDefinitions(options.load);
    const testEnv: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(options.env ?? {})) {
      testEnv[key] = formatEnvValue(value);
    }
    const service = FastConfigService.create({
      load: definitions,
      env: testEnv,
      noProcessEnv: true,
      envFiles: [],
      ...(options.overrides ? { overrides: options.overrides } : {}),
    });
    return {
      module: FastConfigModule,
      global: options.isGlobal ?? false,
      providers: serviceProviders(service, definitions),
      exports: [FastConfigService, FAST_CONFIG_SERVICE, ...definitions.map(getConfigToken)],
    };
  }
}
