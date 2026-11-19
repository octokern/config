export interface ConfigIssue {
  readonly configName: string;
  readonly key?: string;
  readonly path?: readonly (string | number)[];
  readonly code?: string;
  readonly message: string;
}

export class ConfigError extends Error {
  public override readonly name: string = 'ConfigError';
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class ConfigValidationError extends ConfigError {
  public override readonly name = 'ConfigValidationError';
  public readonly issues: readonly ConfigIssue[];

  public constructor(issues: readonly ConfigIssue[]) {
    const frozen = Object.freeze(
      issues.map((issue) => Object.freeze({
        ...issue,
        ...(issue.path ? { path: Object.freeze([...issue.path]) } : {}),
      })),
    );
    const count = frozen.length;
    const body = frozen.map((issue) => {
      const key = issue.key ?? (issue.path?.length ? issue.path.map(String).join('.') : '<root>');
      return `  - [${issue.configName.toUpperCase()}] ${key}: ${issue.message}`;
    });
    super(`Invalid configuration (${String(count)} issue${count === 1 ? '' : 's'}):${body.length ? `\n${body.join('\n')}` : ''}`);
    this.issues = frozen;
  }

  public toJSON(): { readonly name: string; readonly message: string; readonly issues: readonly ConfigIssue[] } {
    return { name: this.name, message: this.message, issues: this.issues };
  }
}

export class ConfigNotRegisteredError extends ConfigError {
  public override readonly name = 'ConfigNotRegisteredError';
  public constructor(configName: string) {
    super(`Configuration "${configName}" is not registered. Import its module with FastConfigModule.forRoot() or forFeature().`);
  }
}

export class DuplicateConfigError extends ConfigError {
  public override readonly name = 'DuplicateConfigError';
  public constructor(configName: string) {
    super(`A different configuration definition named "${configName}" is already registered.`);
  }
}

export class ConfigSourceError extends ConfigError {
  public override readonly name = 'ConfigSourceError';
  public readonly source: string | undefined;
  public constructor(message: string, source?: string, options?: ErrorOptions) {
    super(message, options);
    this.source = source;
  }
}
