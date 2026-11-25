/**
 * F1: Net-gain threshold tests.
 *
 * @module dsh-context-compression-improved/tests/runtime/netgain
 */
import { describe, expect, it } from 'vitest'
import { checkNetGain, computeNetGain, CARD_OVERHEAD_TOKENS } from '../../src/runtime/netgain.ts'

describe('F1: checkNetGain boundary cases', () => {
  it('disabled when minNetGain = 0 (always allows)', () => {
    expect(checkNetGain(100, 90, 0)).toBe(true)
    expect(checkNetGain(200, 190, 0)).toBe(true)
  })

  it('disabled when minNetGain negative (always allows)', () => {
    expect(checkNetGain(100, 90, -1)).toBe(true)
  })

  it('skips tiny gain: 500→400 tokens with overhead 80 = gain 20 < 1000', () => {
    expect(checkNetGain(500, 400, 1000)).toBe(false)
  })

  it('allows good gain: 5000→1000 tokens with overhead 80 = gain 3920 > 1000', () => {
    expect(checkNetGain(5000, 1000, 1000)).toBe(true)
  })

  it('boundary exact: gain = minNetGain → allows (>=)', () => {
    // 1000 - 0 - 80 = 920 → need exactly 920 threshold
    expect(checkNetGain(1000, 0, 920)).toBe(true)
    expect(checkNetGain(1000, 0, 921)).toBe(false)
  })

  it('negative gain (card bigger than original) → always skip', () => {
    expect(checkNetGain(100, 200, 1000)).toBe(false)
    expect(checkNetGain(100, 200, 0)).toBe(true) // disabled = allows even bad cuts
  })

  it('zero tokens before → skip', () => {
    expect(checkNetGain(0, 0, 1000)).toBe(false)
  })

  it('huge output: 50000→5000, gain = 44920 >> 1000', () => {
    expect(checkNetGain(50000, 5000, 1000)).toBe(true)
  })
})

describe('F1: computeNetGain', () => {
  it('returns tokensBefore - tokensAfter - overhead', () => {
    expect(computeNetGain(5000, 1000)).toBe(5000 - 1000 - CARD_OVERHEAD_TOKENS)
  })

  it('can be negative when card > original', () => {
    expect(computeNetGain(100, 200)).toBeLessThan(0)
  })
})

describe('F1: CARD_OVERHEAD_TOKENS is reasonable', () => {
  it('overhead is 80 tokens (sourceRef + header + hint)', () => {
    expect(CARD_OVERHEAD_TOKENS).toBe(80)
  })
})
