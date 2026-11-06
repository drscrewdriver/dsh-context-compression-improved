/**
 * T0.2 runtime-side red tests: the sediment section must parse with the same
 * strictness as the other persisted sections (absent inherits off defaults,
 * present-but-invalid throws — never coerced).
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTEXT_COMPRESSION_SETTINGS,
  DEFAULT_SEDIMENT_SETTINGS,
  parseContextCompressionSettings,
} from '../../src/runtime/config.ts'

function baseDoc(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profile: 'balanced',
    custom: structuredClone(DEFAULT_CONTEXT_COMPRESSION_SETTINGS.custom),
    ...extra,
  }
}

describe('sediment section in the settings document', () => {
  it('absent inherits the off defaults', () => {
    const parsed = parseContextCompressionSettings(baseDoc())
    expect(parsed.sediment).toEqual(DEFAULT_SEDIMENT_SETTINGS)
    expect(DEFAULT_SEDIMENT_SETTINGS.enabled).toBe(false)
  })

  it('a valid partial section fills per-field defaults', () => {
    const parsed = parseContextCompressionSettings(baseDoc({
      sediment: { enabled: true, extraSignalPatterns: ['TOOL_TIMEOUT'] },
    }))
    expect(parsed.sediment).toEqual({
      ...DEFAULT_SEDIMENT_SETTINGS,
      enabled: true,
      extraSignalPatterns: ['TOOL_TIMEOUT'],
    })
  })

  it('present-but-invalid sections throw at the settings boundary', () => {
    expect(() => parseContextCompressionSettings(baseDoc({ sediment: { enabled: 'yes' } }))).toThrow(TypeError)
    expect(() => parseContextCompressionSettings(baseDoc({ sediment: { granularity: 'sideways' } }))).toThrow(TypeError)
    expect(() => parseContextCompressionSettings(baseDoc({ sediment: { rewriteGuardRatio: 0 } }))).toThrow(TypeError)
    expect(() => parseContextCompressionSettings(baseDoc({ sediment: { unknownKey: 1 } }))).toThrow(TypeError)
    expect(() => parseContextCompressionSettings(baseDoc({ sediment: { extraSignalPatterns: ['(unclosed'] } }))).toThrow(TypeError)
    expect(() => parseContextCompressionSettings(baseDoc({ sediment: null }))).toThrow(TypeError)
  })

  it('extraSignalPatterns is copied, not aliased through the parse', () => {
    const patterns = ['npm ERR!']
    const parsed = parseContextCompressionSettings(baseDoc({ sediment: { extraSignalPatterns: patterns } }))
    expect(parsed.sediment?.extraSignalPatterns).toEqual(patterns)
    if (parsed.sediment?.extraSignalPatterns !== undefined) {
      expect(parsed.sediment.extraSignalPatterns).not.toBe(patterns)
    }
  })
})
