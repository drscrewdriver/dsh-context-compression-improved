/**
 * One-off baseline capture: freeze the resolvePolicy output for the pre-existing
 * profiles (before 'tokenpilot-inspired' is added) into a JSON fixture used by
 * tests/tokenpilot/profile-baseline.spec.ts as the backward-compat golden.
 *
 * Usage: node scripts/capture-profile-baseline.mjs [baseline-file]
 */
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const runtime = require('../packages/runtime/lib/index.js')

const OLD_PROFILES = ['off', 'native', 'balanced', 'cache-strict', 'savings', 'adaptive', 'custom']
const baseConfig = runtime.resolveConfig({})
const OPTION_CASES = [
  { label: 'defaults', options: {} },
  { label: 'linkage', options: { contextWindowTokens: 128_000, autoCompactThresholdPercent: 80 } },
]
const CUSTOM_DOCS = [
  { label: 'default-custom', custom: undefined },
]

const snapshot = { capturedAt: 'pre-tokenpilot-inspired', profiles: {} }
for (const profile of OLD_PROFILES) {
  snapshot.profiles[profile] = {}
  for (const optionCase of OPTION_CASES) {
    for (const customCase of CUSTOM_DOCS) {
      const key = `${optionCase.label}${customCase.label === 'default-custom' ? '' : `/${customCase.label}`}`
      snapshot.profiles[profile][key] = runtime.resolvePolicy(
        baseConfig,
        profile,
        customCase.custom,
        optionCase.options,
      )
    }
  }
}

const out = process.argv[2] ?? 'packages/runtime/tests/fixtures/profile-baseline.json'
writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`baseline written: ${out}`)
