/**
 * Scope-independent handle on the live review pipeline.
 *
 * The R4 HTTP routes are registered on the plugin's TOP-LEVEL fiber
 * (`cordis.patch.yml` → `context-compression-improved-estimator-catalog`),
 * but every `ToolResultPruner` is mounted inside an agent preset's isolated
 * group — `canonicalCompressionRows()` declares
 * `isolate: { compaction: true, toolResultPruner: true }` — so
 * `ctx.get('toolResultPruner')` at the top level is always `undefined` and the
 * queue route could only ever answer 503 "review pipeline unavailable".
 *
 * Ownership, not transport, was in the wrong place: the queue records are
 * already keyed by session id, so the store belongs to the plugin rather than
 * to one pruner instance. Every instance shares one store and publishes itself
 * here, which lets a top-level reader reach whichever instance currently holds
 * a session's proposals.
 *
 * The durable seam already behaves this way — `REVIEW_STORAGE_DOMAIN` /
 * `REVIEW_STORAGE_TABLE` are constants, so every instance opens the same table.
 * Only the in-memory fallback was per-instance, and that is what this module
 * makes shared.
 *
 * @module dsh-context-compression-improved/review-registry
 */

import { MemoryReviewStore, type ReviewQueueStore } from './review-queue.ts'

/**
 * The review faces the HTTP routes consume — structural, so the concrete
 * `ToolResultPruner` (a Cordis service with a far wider surface) satisfies it
 * without this module depending on the runtime class.
 */
export interface ReviewPrunerFace {
  listReviewProposals(session: unknown): readonly {
    readonly id: string
    readonly kind: string
    readonly items: readonly {
      readonly seq: number
      readonly kind: string
      readonly component: string
      readonly tokensBefore: number
      readonly tokensAfter: number
    }[]
    readonly benefit: {
      readonly recoveredTokens: number
      readonly penaltyTokens: number
      readonly paybackTurns?: number
      readonly expectedSaving?: number
    }
    readonly enqueuedTurn: number
    readonly lastTurnIndex: number
  }[]
  decideReviewProposal(
    session: unknown,
    proposalId: string,
    decision: 'approved' | 'rejected' | 'ignored',
  ): { ok: true } | { ok: false, reason: string } | undefined
  /** Aggregate pending read; absent on older builds (routes then degrade to 503). */
  listAllReviewProposals?(): readonly {
    readonly sessionId: string
    readonly proposals: readonly {
      readonly id: string
      readonly kind: string
      readonly items: readonly { readonly seq: number; readonly kind: string; readonly component: string; readonly tokensBefore: number; readonly tokensAfter: number }[]
      readonly benefit: { readonly recoveredTokens: number; readonly penaltyTokens: number; readonly paybackTurns?: number; readonly expectedSaving?: number }
      readonly enqueuedTurn: number
      readonly lastTurnIndex: number
    }[]
  }[]
  reviewSummary?(session: unknown): {
    readonly autoApplied: number
    readonly reviewApplied: number
    readonly expired: number
    readonly voided: number
  }
}

/**
 * The one in-memory fallback every pruner instance starts from. Session ids are
 * globally unique and `ReviewSessionRecord` is keyed by them, so a single store
 * is semantically identical to one store per instance — except that a reader
 * reaching any instance now observes every session.
 */
const sharedStore: ReviewQueueStore = new MemoryReviewStore()

const live = new Set<ReviewPrunerFace>()

/** The process-wide review queue store shared by every pruner instance. */
export function sharedReviewStore(): ReviewQueueStore {
  return sharedStore
}

/**
 * Publish one pruner instance for scope-independent readers.
 * @param pruner - the instance to publish.
 * @returns the disposer removing it, for `ctx.effect`.
 */
export function registerReviewPruner(pruner: ReviewPrunerFace): () => void {
  live.add(pruner)
  return () => {
    live.delete(pruner)
  }
}

/**
 * Resolve a live pruner instance for the top-level routes.
 *
 * Any instance can serve an aggregate read because the store is shared, and a
 * session-scoped read is answered from that same store. Instances that have
 * upgraded to the durable seam read the same table, so the answer does not
 * depend on which instance this happens to return.
 *
 * @returns a live instance, or `undefined` when no preset has been composed yet.
 */
export function resolveReviewPruner(): ReviewPrunerFace | undefined {
  return live.values().next().value
}
