import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// apply() 会把统计持久层(StatsStore)开在 resolveDshHome() 下;host spec
// 调 apply 时把 DSH_HOME 钉到临时目录,测试绝不写真实 ~/.dsh。
const VITEST_DSH_HOME = join(tmpdir(), 'cci-vitest-dsh-home')

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      {
        test: {
          name: 'runtime',
          environment: 'node',
          env: { DSH_HOME: VITEST_DSH_HOME },
          include: [
            'packages/selector/tests/runtime/**/*.spec.ts',
            'packages/selector/tests/compat/**/*.spec.ts',
          ],
        },
      },
      {
        test: {
          name: 'selector-host',
          environment: 'node',
          env: { DSH_HOME: VITEST_DSH_HOME },
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
