import { describe, expect, it } from 'vitest'
import {
  adviseCandidates,
  computeBenefit,
  DEFAULT_ADVICE_ALPHA,
  DEFAULT_ADVICE_HIGH_IMPACT_TOKENS,
} from '../../../src/runtime/tokenpilot/benefit.ts'

/** Reference values follow the spec formulas exactly:
 *  R = Σ(before − after); penalty = (1−α)·tail; payback = penalty / (α·R);
 *  expectedSaving = α·R·max(0, Ŝ − payback). */

describe('computeBenefit', () => {
  it('returns zero recovery and no payback for an empty batch', () => {
    const result = computeBenefit([], { alpha: 0.1, tailTokens: 4000 })
    expect(result.recoveredTokens).toBe(0)
    expect(result.penaltyTokens).toBe(3600)
    expect(result.paybackTurns).toBeUndefined()
    expect(result.expectedSaving).toBeUndefined()
  })

  it('computes the single-candidate benefit with a known remaining-turn estimate', () => {
    // R = 4000 − 400 = 3600; penalty = 0.9·4000 = 3600; per-turn = 0.1·3600 = 360
    const result = computeBenefit(
      [{ sourceSeq: 7, tokensBefore: 4000, tokensAfter: 400 }],
      { alpha: 0.1, tailTokens: 4000, remainingTurns: 12 },
    )
    expect(result.recoveredTokens).toBe(3600)
    expect(result.penaltyTokens).toBeCloseTo(3600)
    expect(result.paybackTurns).toBeCloseTo(10)
    // α·R·max(0, 12 − 10) = 360·2
    expect(result.expectedSaving).toBeCloseTo(720)
  })

  it('omits expectedSaving while Ŝ is unknown', () => {
    const result = computeBenefit(
      [{ sourceSeq: 7, tokensBefore: 4000, tokensAfter: 400 }],
      { alpha: 0.1, tailTokens: 4000 },
    )
    expect(result.paybackTurns).toBeCloseTo(10)
    expect(result.expectedSaving).toBeUndefined()
  })

  it('merges candidates into one batch so the penalty is paid once', () => {
    const result = computeBenefit(
      [
        { sourceSeq: 1, tokensBefore: 2000, tokensAfter: 500 },
        { sourceSeq: 2, tokensBefore: 3000, tokensAfter: 1000 },
      ],
      { alpha: 0.1, tailTokens: 4000, remainingTurns: 20 },
    )
    expect(result.recoveredTokens).toBe(3500)
    expect(result.penaltyTokens).toBeCloseTo(3600)
    expect(result.paybackTurns).toBeCloseTo(3600 / 350)
    expect(result.expectedSaving).toBeCloseTo(350 * (20 - 3600 / 350))
  })

  it('clamps a growing candidate to zero recovery instead of negative batch credit', () => {
    const result = computeBenefit(
      [{ sourceSeq: 3, tokensBefore: 100, tokensAfter: 400 }],
      { alpha: 0.1, tailTokens: 4000 },
    )
    expect(result.recoveredTokens).toBe(0)
    expect(result.paybackTurns).toBeUndefined()
  })

  it('stays finite as α → 0: no division, payback undefined, expectedSaving negative', () => {
    const result = computeBenefit(
      [{ sourceSeq: 4, tokensBefore: 4000, tokensAfter: 400 }],
      { alpha: 0, tailTokens: 4000, remainingTurns: 12 },
    )
    expect(result.recoveredTokens).toBe(3600)
    expect(result.paybackTurns).toBeUndefined()
    // With zero per-turn saving the batch can only lose the refill penalty.
    expect(result.expectedSaving).toBeCloseTo(-4000)
  })

  it('never reports a positive expectedSaving once Ŝ is inside the payback window', () => {
    // payback = 10 turns; Ŝ = 5 → max(0, Ŝ − payback) = 0
    const result = computeBenefit(
      [{ sourceSeq: 7, tokensBefore: 4000, tokensAfter: 400 }],
      { alpha: 0.1, tailTokens: 4000, remainingTurns: 5 },
    )
    expect(result.expectedSaving).toBeCloseTo(0)
  })

  it('waives the refill penalty for a refill-exempt batch: payback 0, saving α·R·Ŝ', () => {
    // Fresh-stage shaping: the content never entered the KV cache, so no
    // refill penalty applies — the whole discounted recovery is pure gain.
    const result = computeBenefit(
      [{ sourceSeq: 7, tokensBefore: 4000, tokensAfter: 400 }],
      { alpha: 0.1, tailTokens: 4000, remainingTurns: 12, refillPenaltyExempt: true },
    )
    expect(result.recoveredTokens).toBe(3600)
    expect(result.penaltyTokens).toBe(0)
    expect(result.paybackTurns).toBe(0)
    // α·R·max(0, Ŝ − 0) = 360·12
    expect(result.expectedSaving).toBeCloseTo(4320)
  })

  it('keeps the refill penalty when the exemption flag is absent', () => {
    const result = computeBenefit(
      [{ sourceSeq: 7, tokensBefore: 4000, tokensAfter: 400 }],
      { alpha: 0.1, tailTokens: 4000 },
    )
    expect(result.penaltyTokens).toBeCloseTo(3600)
  })
})

/** The shipped advice defaults are part of the contract: the audit and the
 *  report quote them, so a silent drift would change what the label means. */
describe('advice defaults', () => {
  it('pins the shipped α and high-impact threshold', () => {
    expect(DEFAULT_ADVICE_ALPHA).toBe(0.1)
    expect(DEFAULT_ADVICE_HIGH_IMPACT_TOKENS).toBe(4_000)
  })
})

describe('adviseCandidates', () => {
  // The shipped threshold is exercised by its own case; every other case lifts
  // it out of the way so one band can be asserted at a time.
  const base = {
    alpha: 0.1,
    tailTokens: 4000,
    highImpactTokens: 1_000_000,
  }

  it('returns undefined when no candidate carries a positive recovery', () => {
    expect(adviseCandidates([], base)).toBeUndefined()
    expect(adviseCandidates([{ sourceSeq: 1, tokensBefore: 100, tokensAfter: 400 }], base)).toBeUndefined()
  })

  it('labels a fast-payback batch profitable', () => {
    // R = 3600, penalty = 3600, α·R = 360 → payback 10 ≤ 0.25·Ŝ requires Ŝ ≥ 40.
    const advice = adviseCandidates(
      [{ sourceSeq: 7, tokensBefore: 4_000, tokensAfter: 400 }],
      { ...base, remainingTurns: 60 },
    )
    expect(advice?.band).toBe('profitable')
    expect(advice?.priced).toBe(1)
    expect(advice?.maxTokensBefore).toBe(4_000)
  })

  it('labels an unpriceable batch when α prices no recovery', () => {
    const advice = adviseCandidates(
      [{ sourceSeq: 7, tokensBefore: 4_000, tokensAfter: 400 }],
      { ...base, alpha: 0, remainingTurns: 12 },
    )
    expect(advice?.band).toBe('unpriceable')
    expect(advice?.benefit.expectedSaving).toBeCloseTo(-4000)
  })

  it('lets one high-impact candidate label the whole batch, ahead of a good payback', () => {
    // The 8k candidate alone reaches the shipped threshold; the small sibling
    // would be profitable on its own. One label per batch, high impact wins.
    const advice = adviseCandidates(
      [
        { sourceSeq: 1, tokensBefore: 200, tokensAfter: 100 },
        { sourceSeq: 2, tokensBefore: 8_192, tokensAfter: 1_000 },
      ],
      { ...base, highImpactTokens: DEFAULT_ADVICE_HIGH_IMPACT_TOKENS, alpha: 1, remainingTurns: 60 },
    )
    expect(advice?.band).toBe('high-impact')
    expect(advice?.maxTokensBefore).toBe(8_192)
  })

  it('labels a slowly paying batch slow-payback when Ŝ is known', () => {
    // R = 12000 → penalty 3600, α·R = 1200 → payback 3. Ŝ = 11 keeps
    // 0.25·Ŝ = 2.75 strictly below the payback, so the batch is not profitable.
    const advice = adviseCandidates(
      [{ sourceSeq: 7, tokensBefore: 12_000, tokensAfter: 0 }],
      { ...base, remainingTurns: 11 },
    )
    expect(advice?.band).toBe('slow-payback')
  })

  it('labels a batch that never pays back not-worth-it, and still returns its benefit', () => {
    const advice = adviseCandidates(
      [{ sourceSeq: 7, tokensBefore: 4_000, tokensAfter: 400 }],
      { ...base, remainingTurns: 2 },
    )
    expect(advice?.band).toBe('not-worth-it')
    expect(advice?.benefit.recoveredTokens).toBe(3600)
  })

  it('never closes a band on Ŝ: an unknown remaining-turn count keeps the batch priceable', () => {
    const advice = adviseCandidates(
      [{ sourceSeq: 7, tokensBefore: 4_000, tokensAfter: 400 }],
      base,
    )
    // payback 10 > 1 and Ŝ is unknown → the profit bands cannot be argued, so
    // the batch is labelled as not worth the cache break rather than fabricated.
    expect(advice?.band).toBe('not-worth-it')
    expect(advice?.benefit.expectedSaving).toBeUndefined()
  })

  it('prices a fresh-stage batch without the refill penalty', () => {
    const advice = adviseCandidates(
      [{ sourceSeq: 7, tokensBefore: 4_000, tokensAfter: 400 }],
      { ...base, highImpactTokens: 1_000_000, stage: 'fresh', remainingTurns: 12 },
    )
    expect(advice?.benefit.penaltyTokens).toBe(0)
    expect(advice?.band).toBe('profitable')
  })

  it('counts only the positively-recovering candidates it priced', () => {
    const advice = adviseCandidates(
      [
        { sourceSeq: 1, tokensBefore: 100, tokensAfter: 400 },
        { sourceSeq: 2, tokensBefore: 4_000, tokensAfter: 400 },
      ],
      { ...base, remainingTurns: 60 },
    )
    expect(advice?.priced).toBe(1)
    expect(advice?.maxTokensBefore).toBe(4_000)
  })
})
