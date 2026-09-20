import { describe, expect, it } from 'vitest'

import { CHARS_PER_TOKEN, charsForTokens, charsToTokens } from '../../src/runtime/config.ts'

describe('character basis conversion', () => {
  it('derives zero tokens for non-positive or non-finite character counts', () => {
    expect(charsToTokens(0)).toBe(0)
    expect(charsToTokens(-1)).toBe(0)
    expect(charsToTokens(NaN)).toBe(0)
    expect(charsToTokens(Infinity)).toBe(0)
  })

  it('derives the telemetry token figure from characters', () => {
    expect(charsToTokens(1)).toBe(1)
    expect(charsToTokens(4)).toBe(1)
    expect(charsToTokens(5)).toBe(1)
    expect(charsToTokens(8)).toBe(2)
  })

  it('expresses token-named gates on the character basis', () => {
    expect(charsForTokens(0)).toBe(0)
    expect(charsForTokens(1000)).toBe(4000)
    expect(CHARS_PER_TOKEN).toBe(4.0)
  })

  it('stays finite at the integer upper bound (off/native gates must not misfire)', () => {
    expect(Number.isFinite(charsForTokens(Number.MAX_SAFE_INTEGER))).toBe(true)
    expect(charsForTokens(Number.MAX_SAFE_INTEGER)).toBeLessThan(Infinity)
  })
})
