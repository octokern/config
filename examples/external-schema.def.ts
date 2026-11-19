import { defineEnvConfig, v } from '@octokern/config/core';
import { z } from 'zod';

// Zod is optional. It is only needed by applications that choose to use it.
export const databaseConfig = defineEnvConfig('database', {
  DATABASE_URL: z.string().url().describe('Connection URL for PostgreSQL.'),
  DATABASE_POOL_SIZE: v.number().int().min(1).max(50).default(10),
  DATABASE_PASSWORD: z.string().min(12).describe('Database password.'),
}).secrets('DATABASE_PASSWORD');

export default databaseConfig;
