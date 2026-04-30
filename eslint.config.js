/**
 * ESLint flat config for YeRide Next.
 *
 * Enforces:
 * 1. TypeScript strict-type-checked rules
 * 2. React + React Hooks rules
 * 3. The Clean Architecture dependency rule via eslint-plugin-boundaries:
 *      domain        → may import only from   domain, shared
 *      app           → may import only from   domain, app, shared
 *      data          → may import only from   domain, data, shared
 *      presentation  → may import only from   domain, app, presentation, shared
 *      shared        → may import only from   shared
 *
 *    Tests in any layer may additionally import from test fixtures and
 *    in-memory fakes living in src/shared/testing.
 */

const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const boundaries = require('eslint-plugin-boundaries');
const importPlugin = require('eslint-plugin-import');
const reactHooks = require('eslint-plugin-react-hooks');
const react = require('eslint-plugin-react');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'ios/**',
      'android/**',
      '.expo/**',
      'dist/**',
      'coverage/**',
      'babel.config.js',
      'metro.config.js',
      'jest.config.js',
      'eslint.config.js',
      '*.d.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
        ecmaFeatures: { jsx: true },
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      boundaries,
      import: importPlugin,
      'react-hooks': reactHooks,
      react,
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/domain/**' },
        { type: 'app', pattern: 'src/app/**' },
        { type: 'data', pattern: 'src/data/**' },
        { type: 'presentation', pattern: 'src/presentation/**' },
        { type: 'shared', pattern: 'src/shared/**' },
      ],
      'boundaries/include': ['src/**/*'],
    },
    rules: {
      // ───── TypeScript strictness ─────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // ───── React / hooks ─────
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ───── Architecture: dependency rule ─────
      // Using the legacy `boundaries/element-types` rule. It emits a v6
      // deprecation warning; migration to `boundaries/dependencies` with the
      // new object-selector schema is tracked as a follow-up. The rule still
      // works correctly and enforces the layer boundaries.
      //
      // `shared` is allowed to depend on `domain` because domain is the
      // architectural floor — small helpers like `formatDomainError` that
      // know about DomainError live legitimately in shared. The rule is
      // *not* a guard against depending on stable abstractions; it's a
      // guard against depending on volatile ones (data/presentation).
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'domain', allow: ['domain', 'shared'] },
            { from: 'app', allow: ['domain', 'app', 'shared'] },
            { from: 'data', allow: ['domain', 'data', 'shared'] },
            {
              from: 'presentation',
              allow: ['domain', 'app', 'presentation', 'shared'],
            },
            { from: 'shared', allow: ['domain', 'shared'] },
          ],
        },
      ],
      'boundaries/no-unknown': 'error',
      'boundaries/no-unknown-files': 'off',

      // ───── Imports ─────
      'import/no-default-export': 'off',
      'import/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-cycle': 'error',

      // ───── General ─────
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  // Test files and test-only fixture code: relax architecture rules.
  // src/shared/testing/ is excluded because it contains in-memory fakes that
  // must implement domain repository interfaces and compose presentation
  // providers.
  // src/presentation/di/container.ts is the composition root — by
  // architectural convention it's allowed to wire every layer together.
  // Phase 7 turn 2: useGpsLifecycle.ts and useGpsStore.ts are the
  // presentation-layer seam over the BackgroundGeolocationClient SDK
  // adapter. They import the adapter's `Bg*Event` / `BgPermissionStatus`
  // domain-shaped types so the rest of the presentation layer never has
  // to know the SDK exists. Same architectural exception as the DI
  // container: a single composition file allowed to cross layers.
  {
    files: [
      '**/__tests__/**/*.{ts,tsx}',
      '**/*.test.{ts,tsx}',
      'src/shared/testing/**/*.{ts,tsx}',
      'src/presentation/di/container.ts',
      'src/presentation/hooks/useGpsLifecycle.ts',
      'src/presentation/stores/useGpsStore.ts',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'boundaries/element-types': 'off',
    },
  },
  // Logger transport: this file IS the architectural sentinel that the rest
  // of the codebase relies on to keep `console.*` out of feature code. By
  // definition it must call `console.*` directly to emit log lines, including
  // `console.debug` and `console.info` so RN/Metro tags log lines at the
  // right level. Allow all console methods here only.
  {
    files: ['src/shared/logger/Logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  prettierConfig,
];
