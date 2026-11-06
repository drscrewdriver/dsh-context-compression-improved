/** PTC profile: absolute watermarks, independent `ptcCustom`, and isolation. */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CUSTOM_COMPRESSION_POLICY,
  parseContextCompressionSettings,
  resolveConfig,
  resolvePolicy,
} from '../../src/pruner.ts'
import { DEFAULT_PTC_COMPRESSION_POLICY } from '../../src/runtime/custom-policy.ts'
import { decodeSettings as browserDecodeSettings } from '../../src/client/decode.ts'

const OPTIONS = { contextWindowTokens: 1_000_000, autoCompactThresholdPercent: 80 } as const

describe('ptc profile resolution', () => {
  it('resolves the absolute PTC watermarks with no window linkage', () => {
    const policy = resolvePolicy(resolveConfig(), 'ptc', undefined, OPTIONS)
    expect(policy.profile).toBe('ptc')
    expect(policy.historyMode).toBe('routine')
    expect(policy.freshTriggerTokens).toBe(4_096)
    expect(policy.freshTargetTokens).toBe(1_536)
    expect(policy.aggregateTriggerTokens).toBe(16_384)
    expect(policy.aggregateTargetTokens).toBe(4_096)
    expect(policy.historyTriggerTokens).toBe(20_000)
    expect(policy.historyKeepRecentToolCalls).toBe(8)
    expect(policy.historyKeepRecentTokens).toBe(8_000)
    expect(policy.historyMinReclaimTokens).toBe(6_000)
    expect(policy.autoCompactTokens).toBeUndefined()
    expect(policy.microDeadlineTokens).toBeUndefined()
  })

  it('keeps the same absolute watermarks across context windows', () => {
    for (const contextWindowTokens of [200_000, 1_000_000, 8_000_000]) {
      const policy = resolvePolicy(resolveConfig(), 'ptc', undefined, {
        contextWindowTokens,
        autoCompactThresholdPercent: 80,
      })
      expect(policy.historyTriggerTokens, String(contextWindowTokens)).toBe(20_000)
      expect(policy.historyKeepRecentTokens, String(contextWindowTokens)).toBe(8_000)
      expect(policy.autoCompactTokens).toBeUndefined()
    }
  })

  it('falls back to the PTC default when the fifth argument is omitted', () => {
    expect(resolvePolicy(resolveConfig(), 'ptc').historyTriggerTokens).toBe(20_000)
  })

  it('uses an explicit ptcCustom document', () => {
    const ptcCustom = {
      ...structuredClone(DEFAULT_PTC_COMPRESSION_POLICY),
      history: { ...structuredClone(DEFAULT_PTC_COMPRESSION_POLICY).history, trigger: 12_345 },
    }
    const policy = resolvePolicy(resolveConfig(), 'ptc', undefined, OPTIONS, ptcCustom)
    expect(policy.historyTriggerTokens).toBe(12_345)
  })

  it('keeps deployment-config overrides ahead of the ptcCustom document', () => {
    const config = resolveConfig({ historyTriggerTokens: 9_999, freshTriggerTokens: 2_048, freshTargetTokens: 1_024 })
    const policy = resolvePolicy(config, 'ptc', undefined, OPTIONS)
    expect(policy.historyTriggerTokens).toBe(9_999)
    expect(policy.freshTriggerTokens).toBe(2_048)
  })

  it('rejects a read input cap that would silence the fresh path', () => {
    const config = resolveConfig({ readInputCapChars: 10_000 })
    expect(() => resolvePolicy(config, 'ptc', undefined, OPTIONS))
      .toThrow(/read input cap/u)
  })
})

describe('ptc isolation from custom and tokenpilot', () => {
  it('does not change the custom or tokenpilot policies', () => {
    const custom = resolvePolicy(resolveConfig(), 'custom', structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY), OPTIONS)
    expect(custom.historyTriggerTokens).toBe(500_000)
    const tokenpilot = resolvePolicy(resolveConfig(), 'tokenpilot-inspired', structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY), OPTIONS)
    expect(tokenpilot.historyTriggerTokens).toBe(500_000)
    const ptc = resolvePolicy(resolveConfig(), 'ptc', structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY), OPTIONS)
    expect(ptc.historyTriggerTokens).toBe(20_000)
  })

  it('derives ptc from ptcCustom, never from the shared custom document', () => {
    const editedCustom = {
      ...structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY),
      history: { ...structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY).history, trigger: 777_777 },
    }
    // Editing `custom` alone must not move ptc's defaults.
    const ptcDefault = resolvePolicy(resolveConfig(), 'ptc', editedCustom, OPTIONS)
    expect(ptcDefault.historyTriggerTokens).toBe(20_000)
    // Editing `ptcCustom` alone must not move custom.
    const editedPtc = {
      ...structuredClone(DEFAULT_PTC_COMPRESSION_POLICY),
      history: { ...structuredClone(DEFAULT_PTC_COMPRESSION_POLICY).history, trigger: 31_337 },
    }
    const customStillDefault = resolvePolicy(resolveConfig(), 'custom', editedCustom, OPTIONS)
    expect(customStillDefault.historyTriggerTokens).toBe(777_777)
    expect(resolvePolicy(resolveConfig(), 'ptc', undefined, OPTIONS, editedPtc).historyTriggerTokens).toBe(31_337)
  })
})

describe('ptc settings document', () => {
  it('defaults ptcCustom when absent and preserves it when present', () => {
    const legacy = parseContextCompressionSettings({
      profile: 'ptc',
      custom: structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY),
    })
    expect(legacy.ptcCustom).toEqual(DEFAULT_PTC_COMPRESSION_POLICY)

    const explicit = {
      ...structuredClone(DEFAULT_PTC_COMPRESSION_POLICY),
      history: { ...structuredClone(DEFAULT_PTC_COMPRESSION_POLICY).history, trigger: 18_000 },
    }
    const parsed = parseContextCompressionSettings({
      profile: 'ptc',
      custom: structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY),
      ptcCustom: explicit,
    })
    expect(parsed.ptcCustom?.history.trigger).toBe(18_000)
  })

  it('keeps browser/runtime parity with and without ptcCustom', () => {
    for (const document of [
      { profile: 'ptc', custom: structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY) },
      {
        profile: 'ptc',
        custom: structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY),
        ptcCustom: structuredClone(DEFAULT_PTC_COMPRESSION_POLICY),
      },
    ]) {
      expect(browserDecodeSettings(structuredClone(document)))
        .toEqual(parseContextCompressionSettings(structuredClone(document)))
    }
  })
})
