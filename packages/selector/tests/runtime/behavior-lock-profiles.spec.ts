/**
 * Behavior-lock baseline: freezes the current profile defaults verbatim.
 *
 * Plan: cci-longterm-refactor v0.13.1 (F17 — three-stage pipeline step 1: lock baseline)
 *
 * RULE: Before ANY profile default value changes, this file MUST pass unchanged.
 * If it fails, the change is breaking and requires an explicit review + this file update.
 *
 * @module dsh-context-compression-improved/tests/behavior-lock-profiles
 */
import { describe, expect, it } from 'vitest'
import {
  COMPRESSION_PROFILES,
  AUTO_COMPACT_THRESHOLD_LIMITS,
  DEFAULT_CUSTOM_COMPRESSION_POLICY,
  DEFAULT_PTC_COMPRESSION_POLICY,
  DEFAULT_SEDIMENT_SETTINGS,
  decodeCodeSkeletonSettings,
  decodeIntentSummarySettings,
  decodeMonitorPanelSettings,
  decodeAutoCompactSettings,
  type CompressionProfile,
} from '../../src/profiles.ts'

describe('behavior-lock: profile enumeration (v0.12.1 baseline)', () => {
  it('locks the exact profile list and order (v0.15.1: +flash-tuned)', () => {
    expect(COMPRESSION_PROFILES).toEqual([
      'off',
      'native',
      'balanced',
      'cache-strict',
      'savings',
      'adaptive',
      'tokenpilot-inspired',
      'ptc',
      'flash-tuned',
      'custom',
    ] as const satisfies readonly CompressionProfile[])
  })
})

describe('behavior-lock: AUTO_COMPACT defaults (v0.12.1 baseline)', () => {
  it('locks threshold limits', () => {
    expect(AUTO_COMPACT_THRESHOLD_LIMITS).toEqual({
      min: 50,
      max: 90,
      step: 1,
      default: 80,
    })
  })
  it('decode(undefined) returns the default 80%', () => {
    expect(decodeAutoCompactSettings(undefined)).toEqual({ thresholdPercent: 80 })
  })
})

describe('behavior-lock: codeSkeleton default (BREAKING CHANGE v0.13.2: OFF→ON)', () => {
  it('decode(undefined) returns enabled=true (F4转正)', () => {
    expect(decodeCodeSkeletonSettings(undefined)).toEqual({ enabled: true })
  })
  it('codeSkeleton is now default-enabled globally', () => {
    expect(decodeCodeSkeletonSettings(undefined)!.enabled).toBe(true)
  })
})

describe('behavior-lock: intentSummary default (v0.12.1 baseline)', () => {
  it('decode(undefined) returns enabled=false', () => {
    expect(decodeIntentSummarySettings(undefined)).toEqual({ enabled: false })
  })
})

describe('behavior-lock: monitorPanel default (v0.12.1 baseline)', () => {
  it('decode(undefined) returns enabled=false', () => {
    expect(decodeMonitorPanelSettings(undefined)).toEqual({ enabled: false })
  })
})

describe('behavior-lock: sediment default (v0.12.1 baseline)', () => {
  it('DEFAULT_SEDIMENT_SETTINGS is disabled with known parameters', () => {
    expect(DEFAULT_SEDIMENT_SETTINGS).toEqual({
      enabled: false,
      granularity: 'turn',
      minClosingTokens: 120,
      rewriteGuardRatio: 3,
      maxTurnSpanTokens: 32_000,
    })
  })
})

describe('behavior-lock: custom policy default (v0.12.1 baseline)', () => {
  it('DEFAULT_CUSTOM_COMPRESSION_POLICY locks all stage parameters', () => {
    expect(DEFAULT_CUSTOM_COMPRESSION_POLICY).toEqual({
      version: 3,
      unit: 'tokens',
      fresh: { enabled: true, trigger: 8_192, target: 3_072 },
      aggregate: { enabled: true, trigger: 32_768, target: 12_288 },
      history: {
        enabled: true,
        trigger: 500_000,
        keepRecentToolCalls: 10,
        keepRecentTokens: 64_000,
        minReclaim: 96_000,
      },
      prefixPolicy: 'pressure-break',
      tailTrim: { enabled: false, trigger: 700_000 },
    })
  })
})

describe('behavior-lock: PTC policy default (v0.12.1 baseline)', () => {
  it('DEFAULT_PTC_COMPRESSION_POLICY locks all stage parameters', () => {
    expect(DEFAULT_PTC_COMPRESSION_POLICY).toEqual({
      version: 3,
      unit: 'tokens',
      fresh: { enabled: true, trigger: 4_096, target: 1_536 },
      aggregate: { enabled: true, trigger: 16_384, target: 4_096 },
      history: {
        enabled: true,
        trigger: 20_000,
        keepRecentToolCalls: 8,
        keepRecentTokens: 8_000,
        minReclaim: 6_000,
      },
      prefixPolicy: 'pressure-break',
      tailTrim: { enabled: false, trigger: 700_000 },
    })
  })
})
