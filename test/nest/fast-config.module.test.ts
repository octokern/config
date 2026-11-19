import 'reflect-metadata';
import { Inject } from '@nestjs/common';
import { FastConfigModule } from '../../src/nest/fast-config.module.js';
import { FastConfigService } from '../../src/nest/fast-config.service.js';
import { InjectConfig } from '../../src/nest/tokens.js';
import { defineEnvConfig, type ConfigOf } from '../../src/core/config-definition.js';
import { v } from '../../src/schema/validators.js';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

const appConfig = defineEnvConfig('nest-app', {
  PORT: v.port(),
  NAME: v.string().default('test'),
});

class TestConsumer {
  public constructor(
    @InjectConfig(appConfig) public readonly config: ConfigOf<typeof appConfig>,
  ) {}
}

describe('FastConfigModule', () => {
  it('injects typed config values with an isolated test environment', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FastConfigModule.forTest({ load: [appConfig], env: { PORT: 4321 } })],
      providers: [TestConsumer],
    }).compile();
    try {
      const consumer = moduleRef.get<TestConsumer>(TestConsumer);
      expect(consumer.config.PORT).toBe(4321);
      expect(consumer.config.NAME).toBe('test');
      expect(Object.isFrozen(consumer.config)).toBe(true);
    } finally {
      await moduleRef.close();
    }
  });

  it('registers feature configs in the shared FastConfigService', async () => {
    const rootConfig = defineEnvConfig('nest-root', { ROOT: v.string() });
    const featureConfig = defineEnvConfig('nest-feature', { FEATURE: v.string() });
    class FeatureConsumer {
      public constructor(
        @InjectConfig(featureConfig) public readonly config: ConfigOf<typeof featureConfig>,
        @Inject(FastConfigService) public readonly service: FastConfigService,
      ) {}
    }
    const moduleRef = await Test.createTestingModule({
      imports: [
        FastConfigModule.forRoot({
          load: [rootConfig],
          env: { ROOT: 'root-value', FEATURE: 'feature-value' },
          noProcessEnv: true,
          envFiles: [],
        }),
        FastConfigModule.forFeature(featureConfig),
      ],
      providers: [FeatureConsumer],
    }).compile();
    try {
      const consumer = moduleRef.get<FeatureConsumer>(FeatureConsumer);
      expect(consumer.config.FEATURE).toBe('feature-value');
      expect(consumer.service.get(featureConfig).FEATURE).toBe('feature-value');
      expect(consumer.service.names()).toContain('nest-feature');
    } finally {
      await moduleRef.close();
    }
  });

  it('exposes immutable service snapshots with secret masking', () => {
    const secretConfig = defineEnvConfig('nest-secret', {
      API_KEY: v.string().secret(),
      PORT: v.port(),
    });
    const service = FastConfigService.create({
      load: secretConfig,
      env: { API_KEY: 'long-secret-value', PORT: '3000' },
      noProcessEnv: true,
      envFiles: [],
    });
    expect(service.snapshot()).toEqual({ 'nest-secret': { API_KEY: '[REDACTED]', PORT: 3000 } });
    expect(service.snapshot({ maskSecrets: false })).toEqual({ 'nest-secret': { API_KEY: 'long-secret-value', PORT: 3000 } });
    expect(service.names()).toEqual(['nest-secret']);
    expect(service.has(secretConfig)).toBe(true);
    expect(service.has('nest-secret')).toBe(true);
    const sameNameDifferentDefinition = defineEnvConfig('nest-secret', { API_KEY: v.string() });
    expect(service.has(sameNameDifferentDefinition)).toBe(false);
    expect(() => service.get(sameNameDifferentDefinition)).toThrow();
  });
});
