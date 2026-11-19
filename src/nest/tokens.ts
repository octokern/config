import { Inject } from '@nestjs/common';
import type { ConfigDefinition } from '../core/config-definition.js';

export function getConfigToken<TOutput>(definitionOrName: ConfigDefinition<TOutput> | string): symbol {
  const name = typeof definitionOrName === 'string' ? definitionOrName : definitionOrName.name;
  return Symbol.for(`@octokern/config/config:${name}`);
}

export function InjectConfig<TOutput>(definition: ConfigDefinition<TOutput>): ParameterDecorator {
  return Inject(getConfigToken(definition));
}
