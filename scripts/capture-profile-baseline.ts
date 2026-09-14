/**
 * One-off baseline capture: freeze the resolvePolicy output for the pre-existing
 * profiles (before 'tokenpilot-inspired' is added) into a JSON fixture used by
 * tests/runtime/tokenpilot/profile-baseline.spec.ts as the backward-compat golden.
 *
 * Usage: node scripts-dist/capture-profile-baseline.js [baseline-file]
 */
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/** The slice of the built pruner entry this capture consumes. */
interface PrunerRuntime {
  resolveConfig: (input: Record<string, unknown>) => Record<string, unknown>
  resolvePolicy: (
    config: Record<string, unknown>,
    profile: string,
    custom: unknown,
    options: Record<string, unknown>,
  ) => Record<string, unknown>
}

/** One option matrix row. */
interface OptionCase {
  label: string
  options: Record<string, unknown>
}

/** One custom-document matrix row. */
interface CustomDocCase {
  label: string
  custom: unknown
}

/** The fixture shape `profile-baseline.spec.ts` reads back. */
interface ProfileBaseline {
  capturedAt: string
  profiles: Record<string, Record<string, Record<string, unknown>>>
}

const require = createRequire(import.meta.url)
const runtime = require('../packages/selector/lib/pruner.js') as PrunerRuntime

const OLD_PROFILES: readonly string[] = [
  'off',
  'native',
  'balanced',
  'cache-strict',
  'savings',
  'adaptive',
  'custom',
]
const baseConfig = runtime.resolveConfig({})
const OPTION_CASES: readonly OptionCase[] = [
  { label: 'defaults', options: {} },
  { label: 'linkage', options: { contextWindowTokens: 128_000, autoCompactThresholdPercent: 80 } },
]
const CUSTOM_DOCS: readonly CustomDocCase[] = [
  { label: 'default-custom', custom: undefined },
]

const snapshot: ProfileBaseline = { capturedAt: 'pre-tokenpilot-inspired', profiles: {} }
for (const profile of OLD_PROFILES) {
  const byCase: Record<string, Record<string, unknown>> = {}
  snapshot.profiles[profile] = byCase
  for (const optionCase of OPTION_CASES) {
    for (const customCase of CUSTOM_DOCS) {
      const key = `${optionCase.label}${customCase.label === 'default-custom' ? '' : `/${customCase.label}`}`
      byCase[key] = runtime.resolvePolicy(
        baseConfig,
        profile,
        customCase.custom,
        optionCase.options,
      )
    }
  }
}

const out = process.argv[2] ?? 'packages/selector/tests/runtime/fixtures/profile-baseline.json'
writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`baseline written: ${out}`)
