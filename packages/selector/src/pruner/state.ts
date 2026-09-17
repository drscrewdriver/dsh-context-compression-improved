/**
 * Consolidated per-session mutable state for {@link ToolResultPruner}.
 *
 * Every field is a WeakMap keyed by Session, keeping the service
 * stateless across sessions and safe under GC.
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { DedupeTable } from '../runtime/tokenpilot/dedup.ts'
import type { EstimatorFailures } from '../runtime/tokenpilot/estimator.ts'
import type { ReviewQueue, ReviewQueueStore } from '../runtime/tokenpilot/review-queue.ts'
import type {
  ContextCompressionSettings,
  ResolvedConfig,
} from '../runtime/types.ts'

/** Four-state per-session outcome counters behind the floating-window summary row. */
export interface ReviewSessionSummary {
  /** Rewrites that landed through the automatic path while review mode served this session. */
  autoApplied: number
  /** Approved proposals whose merged batch executed with an applied receipt. */
  reviewApplied: number
  /** Pending proposals that expired unhandled at a turn boundary. */
  expired: number
  /** Approved proposals voided at the apply point (digest mismatch et al). */
  voided: number
}

/** Mutable per-session state bag used inside {@link ToolResultPruner}. */
export interface PrunerState {
  /** Resolved immutable deployment configuration. */
  readonly config: ResolvedConfig

  /** Complete canonical setting document frozen when each Session first reaches this root service. */
  readonly sessionSettings: WeakMap<Session, ContextCompressionSettings>
  /** Original result seqs whose first-exposure KEEP/REDUCE decision has committed. */
  readonly firstExposure: WeakMap<Session, Set<number>>
  /** Result seqs permanently exempt from further reduction (recovery outputs and registered equivalents). */
  readonly recoveryExemptions: WeakMap<Session, Set<number>>
  /** Per-session canonical-content hash index backing tokenpilot-inspired dedupe. */
  readonly dedupeTables: WeakMap<Session, DedupeTable>
  /** Advisory estimator verdicts consumed by the read-state classification. */
  readonly estimatorVerdicts: WeakMap<Session, Map<number, boolean>>
  /** Per-session estimator failure backoff state. */
  readonly estimatorFailures: WeakMap<Session, EstimatorFailures>
  /** Runtime prerequisite warnings deduplicated per Session and failure key. */
  readonly warnedFailures: WeakMap<Session, Set<string>>
  /** Last Adaptive postflight attempt emitted per Session; keeps diagnostics bounded and independent. */
  readonly postflightDiagnostics: WeakMap<Session, string>
  /** Current pre-step chain identity, shared by this producer and downstream compaction-basic. */
  readonly activeRequestBoundaries: WeakMap<Session, object>
  /** Boundary identity that already attempted one fully preflighted TailTrim publication. */
  readonly tailTrimBoundaryAttempts: WeakMap<Session, object>
  /** Last effective policy audit key emitted for each Session. */
  readonly policyResolutionAudits: WeakMap<Session, string>
  /**
   * TokenPilot-inspired R4: shared review-queue store. Starts as the in-memory
   * fail-open fallback; swapped to the storageDomain-backed adapter when (and
   * if) that seam opens successfully.
   */
  reviewStore: ReviewQueueStore
  /** Per-session review queue carrying the frozen timeout policy. */
  readonly reviewQueues: WeakMap<Session, ReviewQueue>
  /** Last observed turn index per Session: the monotonic clock for review expiries. */
  readonly reviewClocks: WeakMap<Session, number>
  /** Estimator-reported remaining turns Ŝ per Session; advisory only. */
  readonly estimatorRemainingTurns: WeakMap<Session, number>
  /** Four-state outcome counters per Session (floating-window summary row). */
  readonly reviewSummaries: WeakMap<Session, ReviewSessionSummary>
}
