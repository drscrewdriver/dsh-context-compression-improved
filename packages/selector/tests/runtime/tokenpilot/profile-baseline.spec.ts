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
} from '../../../src/pruner.ts'

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

  it('derives from the default custom document and injects the capability matrix', () => {
    const config = resolveConfig({})
    const policy = resolvePolicy(config, 'tokenpilot-inspired')
    expect(policy.profile).toBe('tokenpilot-inspired')
    expect(policy.freshEnabled).toBe(true)
    expect(policy.aggregateEnabled).toBe(true)
    expect(policy.historyMode).toBe('routine')
    // tokenpilot-inspired now consumes the Custom policy document; with the
    // default custom document the values match balanced exactly. Users tune
    // them via the CustomPolicyEditor in heuristic mode.
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
      // Advisory advisor ships off with its documented defaults. The
      // resolved matrix intentionally gains this group so it follows the
      // estimator's resolved-consumption pattern; see
      // .agents/plans/ctx-relevance-advisor/spec.md decision record.
      //
      // The retired review gate's four keys are intentionally absent here:
      // they are still ACCEPTED by the parser for upgrade safety but never
      // reach the resolved policy (a reduction must not be gated).
      advisor: {
        mode: '',
        timeoutMs: 8000,
        refreshTurns: 8,
        scoreThreshold: 0.35,
        sampleLimit: 16,
        minTokens: 250,
      },
    })
    // Other profiles never carry the capability matrix.
    expect(resolvePolicy(config, 'balanced').presetOptions).toBeUndefined()
  })

  it('uses explicit custom-document values rather than Auto Compact linkage', () => {
    const config = resolveConfig({})
    const policy = resolvePolicy(config, 'tokenpilot-inspired', undefined, {
      contextWindowTokens: 128_000,
      autoCompactThresholdPercent: 80,
    })
    // tokenpilot-inspired now consumes the Custom document; Auto Compact linkage
    // no longer applies (values come from the explicit policy document).
    expect(policy.autoCompactTokens).toBeUndefined()
    expect(policy.microDeadlineTokens).toBeUndefined()
    expect(policy.historyTriggerTokens).toBe(500_000)
    expect(policy.historyMinReclaimTokens).toBe(96_000)
    expect(policy.historyKeepRecentTokens).toBe(64_000)
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
