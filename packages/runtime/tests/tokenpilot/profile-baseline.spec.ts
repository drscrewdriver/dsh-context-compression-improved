/**
 * TokenPilot-inspired preset: policy derivation plus the backward-compat
 * golden. The fixture freezes the resolvePolicy output of every pre-existing
 * profile captured BEFORE this preset existed; any byte difference is a
 * compatibility regression, however intentional it feels.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseContextCompressionSettings,
  resolveConfig,
  resolvePolicy,
} from '../../src/index.ts'

const baseline = JSON.parse(readFileSync(
  join(import.meta.dirname, '..', 'fixtures', 'profile-baseline.json'),
  'utf8',
)) as {
  profiles: Record<string, Record<string, unknown>>
}

const OLD_PROFILES = ['off', 'native', 'balanced', 'cache-strict', 'savings', 'adaptive', 'custom'] as const
const OPTION_CASES = [
  { label: 'defaults', options: {} },
  { label: 'linkage', options: { contextWindowTokens: 128_000, autoCompactThresholdPercent: 80 } },
] as const

describe('tokenpilot-inspired preset', () => {
  it('keeps every pre-existing profile byte-identical to the pre-preset baseline', () => {
    const config = resolveConfig({})
    for (const profile of OLD_PROFILES) {
      for (const optionCase of OPTION_CASES) {
        const key = optionCase.label
        expect(
          resolvePolicy(config, profile, undefined, optionCase.options),
          `${profile}/${key}`,
        ).toStrictEqual(baseline.profiles[profile]?.[key])
      }
    }
  })

  it('derives from the balanced baseline and injects the capability matrix', () => {
    const config = resolveConfig({})
    const policy = resolvePolicy(config, 'tokenpilot-inspired')
    expect(policy.profile).toBe('tokenpilot-inspired')
    expect(policy.freshEnabled).toBe(true)
    expect(policy.aggregateEnabled).toBe(true)
    expect(policy.historyMode).toBe('routine')
    expect(policy.freshTriggerTokens).toBe(8_192)
    expect(policy.freshTargetTokens).toBe(3_072)
    expect(policy.aggregateTriggerTokens).toBe(32_768)
    expect(policy.aggregateTargetTokens).toBe(12_288)
    expect(policy.historyTriggerTokens).toBe(500_000)
    expect(policy.historyMinReclaimTokens).toBe(96_000)
    expect(policy.presetOptions).toStrictEqual({
      noNetSavingsGuard: true,
      skipReductionRecovery: true,
      dedupeToolResults: true,
      summaryLocator: true,
      prefixStabilizer: true,
      readState: true,
      estimator: { mode: '' },
    })
    // Other profiles never carry the capability matrix.
    expect(resolvePolicy(config, 'balanced').presetOptions).toBeUndefined()
  })

  it('links Auto Compact watermarks like balanced does', () => {
    const config = resolveConfig({})
    const policy = resolvePolicy(config, 'tokenpilot-inspired', undefined, {
      contextWindowTokens: 128_000,
      autoCompactThresholdPercent: 80,
    })
    expect(policy.autoCompactTokens).toBe(102_400)
    expect(policy.microDeadlineTokens).toBe(89_600)
    expect(policy.historyTriggerTokens).toBe(64_000)
    expect(policy.historyMinReclaimTokens).toBe(12_288)
    expect(policy.historyKeepRecentTokens).toBe(8_192)
  })

  it('accepts persisted presetOptions overrides and rejects unknown keys', () => {
    const base = {
      profile: 'balanced',
      custom: { version: 3, unit: 'tokens', fresh: { enabled: true, trigger: 2, target: 1 }, aggregate: { enabled: false, trigger: 2, target: 1 }, history: { enabled: false, trigger: 2, keepRecentToolCalls: 1, keepRecentTokens: 1, minReclaim: 1 }, prefixPolicy: 'preserve', tailTrim: { enabled: false, trigger: 2 } },
    }
    const doc = {
      ...base,
      presetOptions: { dedupeToolResults: false, estimatorMode: 'host' },
    }
    expect((parseContextCompressionSettings(structuredClone(doc)) as { presetOptions?: unknown }).presetOptions).toStrictEqual({
      dedupeToolResults: false,
      estimatorMode: 'host',
    })
    expect(() => parseContextCompressionSettings({
      ...base,
      presetOptions: { nope: true },
    })).toThrow()
  })
})
