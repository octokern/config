import { defineEnvConfig, v } from '@octokern/config/core';

export const appConfig = defineEnvConfig('app', {
  PORT: v.port().default(3000).name('HTTP port').description('Port used by the HTTP server.'),
  HOST: v.string().default('0.0.0.0').name('Bind address').example('127.0.0.1'),
  NODE_ENV: v.enum(['development', 'test', 'production'] as const)
    .default('development')
    .name('Runtime environment'),
  LOG_LEVEL: v.enum(['debug', 'info', 'warn', 'error'] as const)
    .default('info')
    .options({ group: 'Logging', comment: 'Application log verbosity.' }),
});

export default appConfig;
