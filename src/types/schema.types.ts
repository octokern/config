import type { Schema, Infer, InferShape } from '../schema/validators.js';

export interface StandardSchemaV1<TInput = unknown, TOutput = unknown> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: {
      readonly input: TInput;
      readonly output: TOutput;
    };
    readonly validate: (value: TInput) =>
      | { readonly value: TOutput }
      | { readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<string | number> }> }
      | Promise<
          | { readonly value: TOutput }
          | { readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<string | number> }> }
        >;
  };
}

export type AnySchema<TOutput = unknown, TInput = unknown> =
  | Schema<TOutput>
  | StandardSchemaV1<TInput, TOutput>
  | { readonly parse: (input: unknown) => TOutput; readonly safeParse?: (input: unknown) => unknown };

export type InferSchemaType<TSchema> = Infer<TSchema>;
export type { InferShape };
