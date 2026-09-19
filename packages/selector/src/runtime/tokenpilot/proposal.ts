/**
 * TokenPilot-inspired R4: benefit model for the human-gated review pipeline.
 *
 * Pure functions only: the classifier needs no I/O, no session state, and no
 * host services, so every decision is unit-testable and audit-replayable.
 *
 * The cost model follows the TokenPilot paper's cache-accounting view: one
 * merged mutation pays a one-time tail KV-cache refill penalty of
 * `(1−α)·tailTokens`, and every later turn recovers the reclaimed tokens at
 * the cache-hit discount `α`:
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
 * the very first turn.
 *
 * `expectedSaving` is only produced when Ŝ is known (the estimator answered
 * with `expectedRemainingTurns`); it is never fabricated from a guess.
 */
import { createHash } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { dedupeHash, flattenPlainText } from './dedup.ts'

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
 * Stable proposal identity: the sha-256 of the serialized item digests, cut to
 * 12 hex chars. Stable across re-enqueues of the same content so a repeated
 * classification cannot duplicate a pending proposal.
 */
export function proposalId(itemDigests: readonly string[]): string {
  const hash = createHash('sha256')
  for (const digest of itemDigests) hash.update(digest)
  hash.update(String(itemDigests.length))
  return hash.digest('hex').slice(0, 12)
}

/** Human-facing reduction kind carried by every review proposal. */
export type ProposalKind = 'estimator' | 'dedup' | 'read-state'

/** The minimal candidate face the triage classifier consumes. */
export interface ClassifiableCandidate {
  readonly sourceSeq: number
  readonly tokensBefore: number
  readonly tokensAfter: number
  /** Compression primitive that planned this replacement. */
  readonly component: string
  /** Reducer id (`dedupe-pointer`, `superseded-read-whole-result`, …). */
  readonly reducer: string
  /** Content to freeze into the proposal digest. */
  readonly content: readonly ContentBlock[]
}

export interface TriageInput {
  /** Cache-hit discount rate α ∈ (0,1); validated upstream by config parsing. */
  readonly alpha: number
  /** Token mass of the protected tail that must be refilled after a mutation. */
  readonly tailTokens: number
  /** Candidates at or above this token impact skip triage and always enter review. */
  readonly reviewHighImpactTokens: number
  /** Estimated remaining turns Ŝ; `undefined` keeps the edge band closed. */
  readonly remainingTurns?: number | undefined
  /** Seqs whose reduction came from the estimator channel; overrides the kind. */
  readonly estimatorSeqs?: ReadonlySet<number> | undefined
  /** Landing stage of the batch: `'fresh'` batches are priced without the
   *  tail-refill penalty (first-exposure shaping causes no cache break);
   *  `'history'` batches — already-served content — pay it in full. */
  readonly stage?: 'fresh' | 'history' | undefined
}

/** One frozen item inside a review proposal: metadata and digest, never content. */
export interface ProposalItem {
  readonly seq: number
  readonly component: string
  readonly kind: ProposalKind
  readonly tokensBefore: number
  readonly tokensAfter: number
  /** Content sha-256 frozen at enqueue time and re-checked at the apply point. */
  readonly digest: string
}

/** Proposal fields derivable at classification time; queue fields attach at enqueue. */
export interface ProposalSkeleton {
  readonly id: string
  readonly kind: ProposalKind
  readonly items: readonly ProposalItem[]
  readonly benefit: BenefitEstimate
}

export interface ClassificationResult {
  /** Clearly profitable candidates that keep the existing automatic path. */
  readonly auto: readonly ClassifiableCandidate[]
  /** Edge-band or high-impact candidates folded into review proposal skeletons. */
  readonly review: readonly ProposalSkeleton[]
  /** Negative-benefit candidates the pipeline keeps discarding. */
  readonly drop: readonly ClassifiableCandidate[]
}

/**
 * Canonical content digest reused from the dedup hash: plain-text results hash
 * through the dedupe canonicalization; rich blocks fall back to canonical JSON
 * so every candidate is freezable.
 */
export function contentDigest(content: readonly ContentBlock[]): string {
  const text = flattenPlainText(content)
  return dedupeHash(text ?? JSON.stringify(content), 'trim-eol')
}

function proposalKindFor(candidate: ClassifiableCandidate, estimatorSeqs: ReadonlySet<number> | undefined): ProposalKind {
  if (estimatorSeqs?.has(candidate.sourceSeq) === true) return 'estimator'
  if (candidate.reducer === 'dedupe-pointer') return 'dedup'
  return 'read-state'
}

/**
 * Triage planned replacements into the three review-mode buckets, pricing the
 * pass as ONE merged mutation (R1): the tail KV-cache refill penalty is a
 * property of the landing event, not of any single candidate, so it must be
 * paid exactly once per batch. Pricing per candidate overstates the payback
 * N-fold and starves every real batch out of the auto path.
 *
 * Pipeline: zero/negative-recovery candidates are priced out first (they never
 * make a batch look better), the surviving batch is priced once through
 * `computeBenefit`, the verdict is a batch decision, and any high-impact
 * candidate (`tokensBefore ≥ reviewHighImpactTokens`) covers the whole batch
 * into review — splitting the batch would pay a second cache break that the
 * accounting does not model. Review skeletons are grouped one proposal per
 * kind; a proposal id covers every item digest.
 *
 * Batch verdict bands (identical thresholds to the per-candidate model):
 * - any high-impact candidate, or α too small to price a payback → review;
 * - `paybackTurns ≤ 1`, or Ŝ known and `paybackTurns ≤ 0.25·Ŝ` → auto;
 * - Ŝ known and `paybackTurns ∈ (1, 3]` → review;
 * - everything else (Ŝ unknown with a slow payback) → drop.
 *
 * Stage asymmetry: a `'fresh'` batch is exempt from the tail-refill penalty
 * (`refillPenaltyExempt`) — its content was never served, so compressing it
 * breaks no cache and payback is 0 — while a `'history'` batch mutates
 * already-cached context and pays `(1−α)·tailTokens` in full. Without this
 * exemption every realistic fresh batch prices into the drop band and the
 * auto bucket stays structurally unreachable.
 */
export function classifyCandidates(
  candidates: readonly ClassifiableCandidate[],
  input: TriageInput,
): ClassificationResult {
  const drop: ClassifiableCandidate[] = []
  const usable: ClassifiableCandidate[] = []
  for (const candidate of candidates) {
    if (Math.max(0, candidate.tokensBefore - candidate.tokensAfter) <= 0) {
      drop.push(candidate)
      continue
    }
    usable.push(candidate)
  }
  if (usable.length === 0) return { auto: [], review: [], drop }

  const benefit = computeBenefit(usable, {
    alpha: input.alpha,
    tailTokens: input.tailTokens,
    ...input.remainingTurns !== undefined ? { remainingTurns: input.remainingTurns } : {},
    refillPenaltyExempt: input.stage === 'fresh',
  })
  const payback = benefit.paybackTurns
  const highImpact = usable.some(candidate => candidate.tokensBefore >= input.reviewHighImpactTokens)
  let verdict: 'auto' | 'review' | 'drop'
  if (highImpact || payback === undefined) {
    // High impact covers the whole batch; α too small to price a payback has
    // no discounted recovery to argue from, so a human decides.
    verdict = 'review'
  } else if (payback <= 1
    || (input.remainingTurns !== undefined && payback <= 0.25 * input.remainingTurns)) {
    verdict = 'auto'
  } else if (input.remainingTurns !== undefined && payback <= 3) {
    verdict = 'review'
  } else {
    verdict = 'drop'
  }
  if (verdict === 'auto') return { auto: usable, review: [], drop }
  if (verdict === 'drop') return { auto: [], review: [], drop: [...drop, ...usable] }

  const itemsByKind = new Map<ProposalKind, ProposalItem[]>()
  for (const candidate of usable) {
    const item: ProposalItem = {
      seq: candidate.sourceSeq,
      component: candidate.component,
      kind: proposalKindFor(candidate, input.estimatorSeqs),
      tokensBefore: candidate.tokensBefore,
      tokensAfter: candidate.tokensAfter,
      digest: contentDigest(candidate.content),
    }
    const bucket = itemsByKind.get(item.kind) ?? []
    bucket.push(item)
    itemsByKind.set(item.kind, bucket)
  }
  const review: ProposalSkeleton[] = []
  for (const [kind, items] of itemsByKind) {
    review.push({ id: proposalId(items.map(item => item.digest)), kind, items, benefit })
  }
  return { auto: [], review, drop }
}
