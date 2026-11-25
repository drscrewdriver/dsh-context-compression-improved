/**
 * F3: CardMerge tests.
 * @module dsh-context-compression-improved/tests/runtime/card-merge
 */
import { describe, expect, it } from 'vitest'
import {
  planCardMerge,
  decodeCardMergeSettings,
  DEFAULT_CARD_MERGE_SETTINGS,
  type CardInfo,
  type CardMergeSettings,
} from '../../src/runtime/card-merge.ts'

function makeCards(count: number, tokensEach = 500): CardInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    tokens: tokensEach,
    sourceRefs: [`session://test/event/${i + 1}`],
  }))
}

const ENABLED: CardMergeSettings = { ...DEFAULT_CARD_MERGE_SETTINGS, enabled: true }

describe('F3: planCardMerge decision logic', () => {
  it('returns null when disabled', () => {
    expect(planCardMerge(makeCards(20), DEFAULT_CARD_MERGE_SETTINGS, 5000)).toBeNull()
  })

  it('returns null when card count < mergeMaxCards', () => {
    expect(planCardMerge(makeCards(5), ENABLED, 5000)).toBeNull()
  })

  it('returns null when total tokens < mergeMinTokens', () => {
    // 8 cards × 400 tokens = 3200 < 4000
    expect(planCardMerge(makeCards(8, 400), ENABLED, 5000)).toBeNull()
  })

  it('returns plan when conditions met (8 cards × 600 tokens = 4800 > 4000)', () => {
    const plan = planCardMerge(makeCards(8, 600), ENABLED, 2000)
    expect(plan).not.toBeNull()
    expect(plan!.netGain).toBeGreaterThan(0)
    expect(plan!.breakEvenOk).toBe(true)
  })

  it('rejects when breakEven fails (tail too large relative to gain)', () => {
    // 8 × 600 = 4800 total, output ~920, netGain ~3880
    // recompute 10000 → ratio = 10000/3880 ≈ 2.58 > mergeBreakEven(2) → reject
    const plan = planCardMerge(makeCards(8, 600), ENABLED, 10_000)
    expect(plan).toBeNull()
  })

  it('cooldown is a settings concern (tested at integration level)', () => {
    // planCardMerge itself has no temporal state — cooldown lives in orchestrator
    expect(ENABLED.mergeCooldownMs).toBe(300_000)
  })
})

describe('F3: decodeCardMergeSettings', () => {
  it('undefined returns defaults with enabled=false', () => {
    const settings = decodeCardMergeSettings(undefined)
    expect(settings.enabled).toBe(false)
    expect(settings.mergeMaxCards).toBe(8)
  })

  it('explicit enabled=true is preserved', () => {
    const settings = decodeCardMergeSettings({ enabled: true, mergeMaxCards: 10 })
    expect(settings.enabled).toBe(true)
    expect(settings.mergeMaxCards).toBe(10)
  })

  it('out-of-range values are clamped', () => {
    const settings = decodeCardMergeSettings({ enabled: true, mergeMaxCards: 100, mergeBreakEven: 0 })
    expect(settings.mergeMaxCards).toBe(50) // clamped to max
    expect(settings.mergeBreakEven).toBe(1) // clamped to min
  })

  it('non-object input returns defaults', () => {
    expect(decodeCardMergeSettings('invalid')).toEqual(DEFAULT_CARD_MERGE_SETTINGS)
    expect(decodeCardMergeSettings(42)).toEqual(DEFAULT_CARD_MERGE_SETTINGS)
  })
})
