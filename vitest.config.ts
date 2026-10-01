import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['packages/selector/src/**'],
      exclude: ['**/*.d.ts'],
      reporter: ['text', 'json-summary'],
      // Ratcheted just under the measured 0.1.7 baseline
      // (lines 82.16 / functions 83.95 / branches 69.93 / statements 78.40).
      thresholds: {
        lines: 82,
        functions: 83,
        branches: 69,
        statements: 78,
      },
    },
    projects: [
      {
        test: {
          name: 'runtime',
          environment: 'node',
          include: ['packages/selector/tests/runtime/**/*.spec.ts'],
        },
      },
      {
        test: {
          name: 'selector-host',
          environment: 'node',
          include: [
            'packages/selector/tests/cache-prefix-audit.spec.ts',
            'packages/selector/tests/estimator-catalog.spec.ts',
            'packages/selector/tests/**/*.host.spec.ts',
          ],
        },
      },
      {
        resolve: {
          alias: {
            '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL(
              './packages/selector/tests/support/ui-primitives.tsx',
              import.meta.url,
            )),
          },
        },
        test: {
          name: 'selector-client',
          environment: 'jsdom',
          include: ['packages/selector/tests/**/*.client.spec.{ts,tsx}'],
        },
      },
    ],
  },
})
