/**
 * T0.2/T0.3 red tests: the sediment settings section must decode with exactly
 * the runtime schema's strictness — absent inherits off defaults, unknown keys
 * or bad types invalidate the whole section, and an unparseable extra pattern
 * is rejected rather than silently dropped.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEDIMENT_SETTINGS,
  decodeSedimentSettings,
} from '../../src/profiles.ts'

describe('decodeSedimentSettings (plan cci-sedimentation-triage T0.2/T0.3)', () => {
  it('absent decodes to the off defaults', () => {
    expect(decodeSedimentSettings(undefined)).toEqual(DEFAULT_SEDIMENT_SETTINGS)
    expect(DEFAULT_SEDIMENT_SETTINGS.enabled).toBe(false)
    expect(DEFAULT_SEDIMENT_SETTINGS.granularity).toBe('turn')
  })

  it('accepts a complete valid document and round-trips every field', () => {
    const input = {
      enabled: true,
      granularity: 'span',
      minClosingTokens: 200,
      rewriteGuardRatio: 4,
      maxTurnSpanTokens: 40_000,
      extraSignalPatterns: ['TOOL_TIMEOUT', 'npm ERR!'],
    }
    expect(decodeSedimentSettings(input)).toEqual(input)
  })

  it('partial documents inherit per-field defaults', () => {
    const decoded = decodeSedimentSettings({ enabled: true })
    expect(decoded).toEqual({ ...DEFAULT_SEDIMENT_SETTINGS, enabled: true })
  })

  it('rejects unknown keys — never silently ignored', () => {
    expect(decodeSedimentSettings({ enabled: true, keepRounds: 3 })).toBeUndefined()
  })

  it('rejects wrong types and out-of-range bounds', () => {
    expect(decodeSedimentSettings({ enabled: 'yes' })).toBeUndefined()
    expect(decodeSedimentSettings({ granularity: 'turnish' })).toBeUndefined()
    expect(decodeSedimentSettings({ minClosingTokens: 0 })).toBeUndefined()
    expect(decodeSedimentSettings({ minClosingTokens: 2001 })).toBeUndefined()
    expect(decodeSedimentSettings({ rewriteGuardRatio: 0 })).toBeUndefined()
    expect(decodeSedimentSettings({ rewriteGuardRatio: 11 })).toBeUndefined()
    expect(decodeSedimentSettings({ maxTurnSpanTokens: 3_000 })).toBeUndefined()
    expect(decodeSedimentSettings({ maxTurnSpanTokens: 1.5 })).toBeUndefined()
  })

  it('rejects non-plain records (arrays, class instances, null)', () => {
    expect(decodeSedimentSettings(null)).toBeUndefined()
    expect(decodeSedimentSettings([])).toBeUndefined()
    expect(decodeSedimentSettings(new Date())).toBeUndefined()
  })

  it('extraSignalPatterns: invalid entries reject the whole section', () => {
    expect(decodeSedimentSettings({ extraSignalPatterns: ['(unclosed'] })).toBeUndefined()
    expect(decodeSedimentSettings({ extraSignalPatterns: [''] })).toBeUndefined()
    expect(decodeSedimentSettings({ extraSignalPatterns: 'TOOL_TIMEOUT' })).toBeUndefined()
    expect(decodeSedimentSettings({ extraSignalPatterns: ['x'.repeat(201)] })).toBeUndefined()
  })

  it('extraSignalPatterns is copied out, not aliased', () => {
    const patterns = ['TOOL_TIMEOUT']
    const decoded = decodeSedimentSettings({ extraSignalPatterns: patterns })
    expect(decoded?.extraSignalPatterns).toEqual(patterns)
    if (decoded?.extraSignalPatterns !== undefined) {
      expect(decoded.extraSignalPatterns).not.toBe(patterns)
    }
  })
})
