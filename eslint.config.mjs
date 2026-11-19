// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

const typedFiles = ['src/**/*.ts', 'test/**/*.ts'];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '.vitest/**',
      '.husky/**',
      'pnpm-lock.yaml',
    ],
  },
  eslint.configs.recommended,
  {
    files: typedFiles,
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-extraneous-class': [
        'error',
        { allowEmpty: true, allowStaticOnly: true, allowWithDecorator: true },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
    },
  },
  {
    files: ['examples/**/*.ts', 'vitest.config.ts'],
    extends: [...tseslint.configs.recommended],
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  prettierConfig,
);
