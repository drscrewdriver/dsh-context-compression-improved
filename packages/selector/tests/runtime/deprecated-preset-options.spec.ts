/**
 * Upgrade safety for the retired review gate's settings keys.
 *
 * The gate is gone, but its keys are PERSISTED: a live settings document still
 * carries `reviewMode: false`, and both the runtime parser and the browser
 * decoder reject unknown keys. Removing the keys from the accepted set would
 * therefore make the plugin fail to load (runtime) or report the whole settings
 * card as unreadable (client). This spec pins the accept-and-ignore contract in
 * both directions, and pins that the keys never reach the resolved policy.
 */
import { describe, expect, it } from 'vitest'
import {
  parsePresetOptionsSettings,
  resolveConfig,
  resolvePolicy,
} from '../../src/runtime/config.ts'
import { decodePresetOptionsSettings } from '../../src/profiles.ts'

/** The exact legacy section a pre-0.5.2 install has on disk. */
const LEGACY_SECTION = {
  estimatorMode: 'host',
  estimatorProvider: 'local-35b',
  estimatorModel: 'Qwen3.6-35B-A3B',
  estimatorBaseUrl: 'http://192.168.100.242:8200/v1',
  reviewMode: false,
}

describe('retired review-gate keys are accepted and ignored (runtime)', () => {
  it('parses the legacy section without throwing and keeps the live keys', () => {
    const parsed = parsePresetOptionsSettings(LEGACY_SECTION)
    expect(parsed).toEqual({
      estimatorMode: 'host',
      estimatorProvider: 'local-35b',
      estimatorModel: 'Qwen3.6-35B-A3B',
      estimatorBaseUrl: 'http://192.168.100.242:8200/v1',
    })
  })

  it('drops every retired key, even with values the old schema rejected', () => {
    // The retired keys are not validated any more — a stale invalid value in an
    // existing document must not be able to break the load.
    const parsed = parsePresetOptionsSettings({
      reviewMode: 'yes',
      reviewTimeoutTurns: -1,
      cacheHitDiscountAlpha: 'wide',
      reviewHighImpactTokens: null,
    })
    expect(parsed).toEqual({})
  })

  it('still rejects a genuinely unknown key', () => {
    expect(() => parsePresetOptionsSettings({ reviewModes: true })).toThrow(/unknown key/)
  })

  it('never lets a retired key reach the resolved policy matrix', () => {
    // The section arrives as `unknown` from the settings document, so the cast
    // mirrors the production path rather than widening the config surface.
    const policy = resolvePolicy(
      resolveConfig({
        presetOptions: { reviewMode: true, reviewHighImpactTokens: 1 },
      } as unknown as Parameters<typeof resolveConfig>[0]),
      'tokenpilot-inspired',
    )
    const matrix = policy.presetOptions
    expect(matrix).toBeDefined()
    for (const gone of ['reviewMode', 'reviewTimeoutTurns', 'cacheHitDiscountAlpha', 'reviewHighImpactTokens']) {
      expect(Object.hasOwn(matrix as object, gone)).toBe(false)
    }
    // The surviving matrix is exactly the live capability set.
    expect(Object.keys(matrix as object).sort()).toEqual([
      'advisor', 'dedupeToolResults', 'estimator', 'noNetSavingsGuard',
      'prefixStabilizer', 'readState', 'skipReductionRecovery', 'summaryLocator',
    ])
  })
})

describe('retired review-gate keys are accepted and ignored (client mirror)', () => {
  it('decodes a legacy section instead of reporting the card unreadable', () => {
    const decoded = decodePresetOptionsSettings(LEGACY_SECTION)
    // `undefined` here would blank the settings card's presetOptions section.
    expect(decoded).toEqual({
      estimatorMode: 'host',
      estimatorProvider: 'local-35b',
      estimatorModel: 'Qwen3.6-35B-A3B',
      estimatorBaseUrl: 'http://192.168.100.242:8200/v1',
    })
  })

  it('tolerates legacy values the old decoder rejected', () => {
    expect(decodePresetOptionsSettings({ reviewMode: 'yes', reviewHighImpactTokens: -5 })).toEqual({})
  })

  it('still refuses an unknown key', () => {
    expect(decodePresetOptionsSettings({ reviewModes: true })).toBeUndefined()
  })
})
