export type RawEnvironment = Record<string, string | undefined>;

export interface EnvMappingOptions {
  readonly prefix?: string;
  readonly strict?: boolean;
}
