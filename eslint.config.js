import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const noUnusedVars = ['error', {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrorsIgnorePattern: '^_',
  destructuredArrayIgnorePattern: '^_',
}]

// Gate scripts and test hosts legitimately traffic in `any` (JSON payloads,
// untyped Harness service bridges); the unsafe-family noise there would drown
// the signal, so they are scoped out while every other type-checked rule stays.
const noUnsafeFamily = Object.fromEntries(
  [
    'no-unsafe-argument',
    'no-unsafe-assignment',
    'no-unsafe-call',
    'no-unsafe-member-access',
    'no-unsafe-return',
  ].map(rule => [`@typescript-eslint/${rule}`, 'off']),
)

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', '**/lib/**', '**/dist/**', '**/coverage/**',
      'docs/**', 'scripts-dist/**',
      // Vendored 0.1.5-era helper shipped as plain JS; it has no tsconfig
      // project, so type-checked rules cannot run on it.
      'packages/selector/tests/helpers/legacy-settings/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    // First-party TypeScript: full type-checked strength. Everything linted
    // here is included in tsconfig.tests.json (the only root-level project).
    files: ['packages/**/*.ts', 'packages/**/*.tsx', 'vitest.config.ts', 'vitest.built.config.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        project: ['tsconfig.tests.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { '@typescript-eslint/no-unused-vars': noUnusedVars },
  },
  {
    // Spec files implement mock async methods purely to satisfy typed host
    // interfaces; requiring an await inside every one of them is noise.
    files: ['packages/selector/tests/**'],
    rules: { '@typescript-eslint/require-await': 'off', ...noUnsafeFamily },
  },
  {
    // Standalone .mjs gate scripts live outside every tsconfig; the default
    // project gives type-checked rules a loose type surface to work with.
    files: ['scripts/**/*.{js,mjs}', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { '@typescript-eslint/no-unused-vars': noUnusedVars, ...noUnsafeFamily },
  },
  {
    // Terminal normalization intentionally matches ANSI/BEL control characters.
    files: ['packages/selector/src/runtime/reducers.ts'],
    rules: { 'no-control-regex': 'off' },
  },
)
