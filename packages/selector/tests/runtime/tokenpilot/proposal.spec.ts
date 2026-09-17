import { describe, expect, it } from 'vitest'
import {
  classifyCandidates,
  computeBenefit,
  proposalId,
} from '../../../src/runtime/tokenpilot/proposal.ts'

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
})

describe('proposalId', () => {
  it('is stable for the same digest list and length-sensitive', () => {
    const digests = ['aa'.repeat(32), 'bb'.repeat(32)]
    expect(proposalId(digests)).toBe(proposalId([...digests]))
    expect(proposalId(digests)).toHaveLength(12)
    expect(proposalId(digests)).not.toBe(proposalId([digests[0]!, digests[1]!, digests[0]!]))
  })

  it('distinguishes an empty batch from a single digest', () => {
    expect(proposalId([])).not.toBe(proposalId(['cc'.repeat(32)]))
  })
})

/** Triage fixtures: α=0.5 keeps the arithmetic obvious —
 *  payback = 0.5·tail / (0.5·R) = tail / R. */
const TRIAGE = { alpha: 0.5, tailTokens: 1000, reviewHighImpactTokens: 4000 }

function candidate(overrides: {
  sourceSeq?: number
  tokensBefore?: number
  tokensAfter?: number
  reducer?: string
  component?: string
}): Parameters<typeof classifyCandidates>[0][number] {
  return {
    sourceSeq: overrides.sourceSeq ?? 1,
    tokensBefore: overrides.tokensBefore ?? 1000,
    tokensAfter: overrides.tokensAfter ?? 500,
    reducer: overrides.reducer ?? 'native-whole-result',
    component: overrides.component ?? 'native-tool-result',
    content: [{ type: 'text', text: 'opaque result body' }],
  }
}

describe('classifyCandidates', () => {
  it('auto-applies the clearly profitable band and drops negative recovery', () => {
    // tail/R = 1000/1000 = 1 → payback = 1 → auto; R = 0 → drop.
    const result = classifyCandidates(
      [candidate({ sourceSeq: 1, tokensBefore: 2000, tokensAfter: 1000 }), candidate({ sourceSeq: 2, tokensBefore: 500, tokensAfter: 500 })],
      TRIAGE,
    )
    expect(result.auto.map(entry => entry.sourceSeq)).toEqual([1])
    expect(result.drop.map(entry => entry.sourceSeq)).toEqual([2])
    expect(result.review).toEqual([])
  })

  it('sends high-impact candidates to review even inside the auto band', () => {
    // payback = 1000/5000 = 0.2 ≤ 1, but tokensBefore ≥ 4000 → review ("直接送审").
    const result = classifyCandidates(
      [candidate({ tokensBefore: 5000, tokensAfter: 4000 })],
      TRIAGE,
    )
    expect(result.auto).toEqual([])
    expect(result.review).toHaveLength(1)
    expect(result.review[0]!.items[0]!.tokensBefore).toBe(5000)
  })

  it('keeps the Ŝ-gated edge band in review and closes it while Ŝ is unknown', () => {
    // payback = 1000/200 = 5: with Ŝ = 40 → 5 ≤ 0.25·40 = 10 → auto.
    const known = classifyCandidates(
      [candidate({ tokensBefore: 1200, tokensAfter: 1000 })],
      { ...TRIAGE, remainingTurns: 40 },
    )
    expect(known.auto).toHaveLength(1)
    // payback = 1000/50 = 20: with Ŝ = 40, 20 > 0.25·40 and > 3 → drop.
    const slow = classifyCandidates(
      [candidate({ tokensBefore: 1050, tokensAfter: 1000 })],
      { ...TRIAGE, remainingTurns: 40 },
    )
    expect(slow.drop).toHaveLength(1)
    // Same slow candidate with Ŝ unknown → no edge band, no auto → drop.
    const unknown = classifyCandidates(
      [candidate({ tokensBefore: 1050, tokensAfter: 1000 })],
      TRIAGE,
    )
    expect(unknown.drop).toHaveLength(1)
    // payback = 1000/400 = 2.5: Ŝ = 8 → 2.5 > 0.25·8 = 2 and ≤ 3 → review.
    const edge = classifyCandidates(
      [candidate({ tokensBefore: 1400, tokensAfter: 1000 })],
      { ...TRIAGE, remainingTurns: 8 },
    )
    expect(edge.review).toHaveLength(1)
    // Same edge candidate with Ŝ unknown → drop.
    const edgeUnknown = classifyCandidates(
      [candidate({ tokensBefore: 1400, tokensAfter: 1000 })],
      TRIAGE,
    )
    expect(edgeUnknown.drop).toHaveLength(1)
  })

  it('freezes digest, kind, and benefit into the review skeleton', () => {
    const result = classifyCandidates(
      [candidate({ sourceSeq: 9, reducer: 'dedupe-pointer', component: 'fresh' })],
      // payback = 1000/500 = 2: Ŝ = 6 → 2 > 0.25·6 = 1.5 and ≤ 3 → review.
      { ...TRIAGE, remainingTurns: 6 },
    )
    const skeleton = result.review[0]!
    expect(skeleton.kind).toBe('dedup')
    expect(skeleton.items[0]!.seq).toBe(9)
    expect(skeleton.items[0]!.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(skeleton.items[0]!.kind).toBe('dedup')
    expect(skeleton.benefit.recoveredTokens).toBe(500)
    expect(skeleton.id).toEqual(proposalId([skeleton.items[0]!.digest]))
  })

  it('labels estimator-channel seqs without changing the triage math', () => {
    const result = classifyCandidates(
      [candidate({ sourceSeq: 11, reducer: 'superseded-read-whole-result', component: 'history' })],
      { ...TRIAGE, remainingTurns: 6, estimatorSeqs: new Set([11]) },
    )
    expect(result.review[0]!.kind).toBe('estimator')
  })
})
