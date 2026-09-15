/**
 * Consolidated per-session mutable state for {@link ToolResultPruner}.
 *
 * Every field is a WeakMap keyed by Session, keeping the service
 * stateless across sessions and safe under GC.
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { DedupeTable } from '../runtime/tokenpilot/dedup.ts'
import type { EstimatorFailures } from '../runtime/tokenpilot/estimator.ts'
import type {
  ContextCompressionSettings,
  ResolvedConfig,
} from '../runtime/types.ts'

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
}
