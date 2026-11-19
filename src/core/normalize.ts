import { isConfigDefinition } from './config-definition.js';
import type { ConfigDefinition } from './config-definition.js';
import { DuplicateConfigError } from './errors.js';

export function normalizeDefinitions(
  input: ConfigDefinition | readonly ConfigDefinition[] | readonly unknown[],
): readonly ConfigDefinition[] {
  const candidates: readonly unknown[] = Array.isArray(input) ? input : [input];
  const definitions: ConfigDefinition[] = [];
  const byName = new Map<string, ConfigDefinition>();
  for (const candidate of candidates) {
    if (!isConfigDefinition(candidate)) {
      throw new TypeError('Expected every configuration to be created with defineEnvConfig()');
    }
    const existing = byName.get(candidate.name);
    if (existing && existing !== candidate) throw new DuplicateConfigError(candidate.name);
    if (!existing) {
      byName.set(candidate.name, candidate);
      definitions.push(candidate);
    }
  }
  return Object.freeze(definitions);
}
