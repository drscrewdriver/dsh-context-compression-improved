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
  const penaltyTokens = (1 - alpha) * tailTokens
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
 * Triage planned replacements into the three review-mode buckets.
 *
 * Per candidate (R is per candidate, never cross-credited):
 * - `tokensAfter ≥ tokensBefore` → drop (nothing to recover);
 * - `tokensBefore ≥ reviewHighImpactTokens` → review ("直接送审": high impact
 *   always waits for a human, even when the payback band would pass it);
 * - `paybackTurns ≤ 1`, or Ŝ known and `paybackTurns ≤ 0.25·Ŝ` → auto;
 * - Ŝ known and `paybackTurns ∈ (1, 3]` → review;
 * - everything else (Ŝ unknown with a slow payback) → drop.
 */
export function classifyCandidates(
  candidates: readonly ClassifiableCandidate[],
  input: TriageInput,
): ClassificationResult {
  const auto: ClassifiableCandidate[] = []
  const review: ProposalSkeleton[] = []
  const drop: ClassifiableCandidate[] = []
  for (const candidate of candidates) {
    const benefit = computeBenefit([candidate], input)
    if (benefit.recoveredTokens <= 0) {
      drop.push(candidate)
      continue
    }
    const highImpact = candidate.tokensBefore >= input.reviewHighImpactTokens
    const payback = benefit.paybackTurns
    if (!highImpact && payback !== undefined) {
      const clearlyProfitable = payback <= 1
        || (input.remainingTurns !== undefined && payback <= 0.25 * input.remainingTurns)
      if (clearlyProfitable) {
        auto.push(candidate)
        continue
      }
      const edgeBand = input.remainingTurns !== undefined && payback <= 3
      if (!edgeBand) {
        drop.push(candidate)
        continue
      }
    }
    const item: ProposalItem = {
      seq: candidate.sourceSeq,
      component: candidate.component,
      kind: proposalKindFor(candidate, input.estimatorSeqs),
      tokensBefore: candidate.tokensBefore,
      tokensAfter: candidate.tokensAfter,
      digest: contentDigest(candidate.content),
    }
    review.push({
      id: proposalId([item.digest]),
      kind: item.kind,
      items: [item],
      benefit,
    })
  }
  return { auto, review, drop }
}
