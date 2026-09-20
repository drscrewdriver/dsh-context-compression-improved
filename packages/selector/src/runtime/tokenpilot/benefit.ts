/**
 * TokenPilot-inspired benefit model — **advisory only**.
 *
 * This module prices one pass's planned replacements as ONE merged mutation and
 * labels the batch with the band the model would have chosen. The label is
 * ADVICE: nothing here suppresses, delays, or rewrites a reduction. The former
 * human-gated review pipeline consumed these bands to withhold the batch from
 * landing; that gate was retired because a reduction must never block automatic
 * processing. The bands now feed the `reduction-advice` audit and the advisor
 * report, and every planned replacement that the rule engine produced lands.
 *
 * Cache accounting (TokenPilot paper): one merged mutation pays a one-time tail
 * KV-cache refill penalty of `(1−α)·tailTokens`, and every later turn recovers
 * the reclaimed tokens at the cache-hit discount `α`:
 *
 * ```
 * R              = Σ(tokensBefore − tokensAfter)   // net reclaimed tokens
 * paybackTurns   = (1−α)·tailTokens / (α·R)        // one-time refill / per-turn saving
 * expectedSaving = α·R·max(0, Ŝ − paybackTurns)    // Ŝ = estimated remaining turns
 * ```
 *
 * The refill penalty only models mutations of already-cached context. A
 * fresh-stage batch (shaped before its first request) is exempt via
 * `refillPenaltyExempt`: payback is 0 and every reclaimed token saves from
 * the very first turn. Without that exemption every realistic fresh batch
 * prices into the `not-worth-it` band, which makes the advice useless exactly
 * where it is most often consulted.
 *
 * `expectedSaving` is only produced when Ŝ is known (the estimator answered
 * with `expectedRemainingTurns`); it is never fabricated from a guess.
 *
 * Pure functions only: the classifier needs no I/O, no session state, and no
 * host services, so every label is unit-testable and audit-replayable.
 */

/** The minimal per-candidate face the benefit model consumes. */
export interface BenefitCandidate {
  readonly sourceSeq: number
  readonly tokensBefore: number
  readonly tokensAfter: number
}

export interface BenefitInput {
  /** Cache-hit discount rate α ∈ (0,1); validated upstream by config parsing. */
  readonly alpha: number
  /** Token mass of the protected tail that must be refilled after a mutation. */
  readonly tailTokens: number
  /** Estimated remaining turns Ŝ; `undefined` keeps expectedSaving out of the result. */
  readonly remainingTurns?: number | undefined
  /** True for fresh-stage batches: their content was never served, so it is
   *  not in the KV cache and shaping it causes no cache break — no refill
   *  penalty applies and the whole discounted recovery is pure gain. */
  readonly refillPenaltyExempt?: boolean | undefined
}

export interface BenefitEstimate {
  /** Net reclaimed tokens across the batch; may be ≤ 0 when a batch is not worth it. */
  readonly recoveredTokens: number
  /** The one-time cache-refill penalty the merged mutation pays: (1−α)·tailTokens. */
  readonly penaltyTokens: number
  /** Turns of discounted recovery needed to recoup the penalty; `undefined` when α·R ≤ 0. */
  readonly paybackTurns?: number
  /** Discounted net benefit over the remaining session; omitted when Ŝ is unknown. */
  readonly expectedSaving?: number
}

/**
 * The band one priced batch falls into. Advisory vocabulary only — every band
 * lands; the label says what the model thought of the landing, not whether it
 * was allowed to happen.
 */
export type AdviceBand =
  /** Payback ≤ 1 turn, or ≤ a quarter of the estimated remaining turns. */
  | 'profitable'
  /** At least one candidate reaches the high-impact threshold: the batch is
   *  large enough that a human would want to know it moved. */
  | 'high-impact'
  /** Ŝ known and payback ∈ (1, 3]: it does pay back, but slowly. */
  | 'slow-payback'
  /** α·R ≤ 0: the accounting has no discounted recovery to argue from. */
  | 'unpriceable'
  /** Ŝ known and payback > 3 turns: the model would not have spent the cache break. */
  | 'not-worth-it'

export interface AdviceInput {
  /** Cache-hit discount rate α ∈ (0,1); validated upstream by config parsing. */
  readonly alpha: number
  /** Token mass of the protected tail that must be refilled after a mutation. */
  readonly tailTokens: number
  /** Candidates at or above this token impact are labelled `high-impact`. */
  readonly highImpactTokens: number
  /** Estimated remaining turns Ŝ; `undefined` closes the slow-payback band. */
  readonly remainingTurns?: number | undefined
  /** Landing stage of the batch: `'fresh'` batches are priced without the
   *  tail-refill penalty (first-exposure shaping causes no cache break);
   *  `'history'` batches — already-served content — pay it in full. */
  readonly stage?: 'fresh' | 'history' | undefined
}

export interface AdviceResult {
  readonly band: AdviceBand
  /** The full benefit estimate the band was derived from. */
  readonly benefit: BenefitEstimate
  /** Number of candidates that carried a positive recovery and were priced. */
  readonly priced: number
  /** Largest single-candidate token mass in the batch (the high-impact evidence). */
  readonly maxTokensBefore: number
}

/**
 * Shipped defaults of the advisory model. They are constants rather than
 * settings keys because the machine no longer acts on them: after the review
 * gate was retired these numbers only shape a label, so exposing them as
 * tunable configuration would advertise a control that changes no behavior.
 */
export const DEFAULT_ADVICE_ALPHA = 0.1
export const DEFAULT_ADVICE_HIGH_IMPACT_TOKENS = 4_000

/**
 * Aggregate the batch-level benefit of a set of reduction candidates.
 *
 * Individual candidates whose replacement would grow the context contribute
 * zero recovery (they never make a batch look better than dropping them).
 */
export function computeBenefit(candidates: readonly BenefitCandidate[], input: BenefitInput): BenefitEstimate {
  const { alpha, tailTokens, remainingTurns } = input
  let recoveredTokens = 0
  for (const candidate of candidates) {
    recoveredTokens += Math.max(0, candidate.tokensBefore - candidate.tokensAfter)
  }
  const penaltyTokens = input.refillPenaltyExempt === true ? 0 : (1 - alpha) * tailTokens
  const perTurnSaving = alpha * recoveredTokens
  if (perTurnSaving <= 0) {
    return remainingTurns === undefined
      ? { recoveredTokens, penaltyTokens }
      : { recoveredTokens, penaltyTokens, expectedSaving: -penaltyTokens }
  }
  const paybackTurns = penaltyTokens / perTurnSaving
  if (remainingTurns === undefined) {
    return { recoveredTokens, penaltyTokens, paybackTurns }
  }
  return {
    recoveredTokens,
    penaltyTokens,
    paybackTurns,
    expectedSaving: perTurnSaving * Math.max(0, remainingTurns - paybackTurns),
  }
}

/**
 * Label one batch of planned replacements.
 *
 * Pipeline: zero/negative-recovery candidates are priced out first (they never
 * make a batch look better), the surviving batch is priced once through
 * `computeBenefit`, and the band is a batch decision — the refill penalty is a
 * property of the landing event, not of any single candidate, so pricing per
 * candidate would overstate payback N-fold.
 *
 * Band precedence (identical thresholds to the retired triage model):
 * - α too small to price a payback → `unpriceable`;
 * - any candidate at `highImpactTokens` → `high-impact`;
 * - `paybackTurns ≤ 1`, or Ŝ known and `paybackTurns ≤ 0.25·Ŝ` → `profitable`;
 * - Ŝ known and `paybackTurns ∈ (1, 3]` → `slow-payback`;
 * - everything else → `not-worth-it`.
 *
 * @param candidates - planned replacements of one pass, in any order.
 * @param input - pricing inputs and the stage of the batch.
 * @returns the advice, or `undefined` when nothing carried a positive recovery.
 */
export function adviseCandidates(
  candidates: readonly BenefitCandidate[],
  input: AdviceInput,
): AdviceResult | undefined {
  const usable: BenefitCandidate[] = []
  for (const candidate of candidates) {
    if (Math.max(0, candidate.tokensBefore - candidate.tokensAfter) <= 0) continue
    usable.push(candidate)
  }
  if (usable.length === 0) return undefined

  const benefit = computeBenefit(usable, {
    alpha: input.alpha,
    tailTokens: input.tailTokens,
    ...input.remainingTurns !== undefined ? { remainingTurns: input.remainingTurns } : {},
    refillPenaltyExempt: input.stage === 'fresh',
  })
  const payback = benefit.paybackTurns
  const maxTokensBefore = usable.reduce((max, candidate) => Math.max(max, candidate.tokensBefore), 0)
  const band: AdviceBand = payback === undefined
    ? 'unpriceable'
    : maxTokensBefore >= input.highImpactTokens
      ? 'high-impact'
      : payback <= 1
        || (input.remainingTurns !== undefined && payback <= 0.25 * input.remainingTurns)
        ? 'profitable'
        : input.remainingTurns !== undefined && payback <= 3
          ? 'slow-payback'
          : 'not-worth-it'
  return { band, benefit, priced: usable.length, maxTokensBefore }
}
