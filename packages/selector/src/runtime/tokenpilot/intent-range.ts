/**
 * Deterministic fold-range selection for the turn-tail intent summary
 * (task_2.1). The host — never the model — decides WHAT gets folded: the
 * consumed increment outside the protected working set, oldest-first
 * (tail-biased folding keeps the cached request prefix byte-stable).
 */
import type { SnapshotCandidate } from '../../pruner/types.ts'

/** Per-batch cap: one pass never folds more than this many candidates. */
export const INTENT_RANGE_MAX_CANDIDATES = 20

export interface IntentRangeInput {
  /** Pressure candidates already filtered to safe/eligible faces by the caller. */
  readonly candidates: readonly SnapshotCandidate[]
  /** Protected working-set seqs (never foldable). */
  readonly protectedSeqs: ReadonlySet<number>
  /** Already-folded seqs (fold-once: never reconsidered). */
  readonly foldedSeqs: ReadonlySet<number>
  /** Per-batch cap so one pass cannot fold unboundedly. */
  readonly maxCandidates: number
}

/**
 * Oldest-first selection of foldable candidates. Excludes the protected
 * working set and already-folded seqs; caps the batch size.
 */
export function computeIntentRange(
  input: IntentRangeInput,
): { readonly seqs: number[], readonly skippedProtected: number, readonly skippedFolded: number } {
  const unprotected = input.candidates.filter(candidate => !input.protectedSeqs.has(candidate.seq))
  const skippedProtected = input.candidates.length - unprotected.length
  const eligible = unprotected.filter(candidate => !input.foldedSeqs.has(candidate.seq))
  const skippedFolded = unprotected.length - eligible.length
  // Oldest-first: seq ascending == oldest first in the append-only log.
  const ordered = [...eligible].sort((a, b) => a.seq - b.seq)
  return { seqs: ordered.slice(0, Math.max(0, input.maxCandidates)).map(candidate => candidate.seq), skippedProtected, skippedFolded }
}
