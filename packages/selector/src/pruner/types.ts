/**
 * Pruner-internal type definitions.
 *
 * These types are private to the pruner module tree and are NOT re-exported
 * through the package's public API.
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenCount } from '../runtime/measurement.ts'
import type { CompressionAuditComponent } from '../runtime/audit.ts'
import type { HistoryMode, PruneStage } from '../runtime/types.ts'

export interface ToolCallInfo {
  readonly name: string
  readonly arguments: string
}

export interface SnapshotCandidate {
  readonly seq: number
  readonly event: SessionEvent<'tool/result'>
  readonly call: ToolCallInfo
  /** Authoritative same-revision exact canonical content count (telemetry only). */
  readonly count: TokenCount
  /** Same-revision legacy heuristic price used only by bounded projections. */
  readonly shadowedHeuristicTokenCount: number
  /**
   * Authoritative decision metric: character pressure in Unicode code points.
   * Every eligibility and acceptance gate decides on this number so the plugin
   * never depends on the routed model id owning a bundled exact tokenizer;
   * `count` is retained as diagnostic telemetry only.
   */
  readonly characterPressure: number
}

export interface PlannedReplacement {
  readonly candidate: SnapshotCandidate
  readonly content: ContentBlock[]
  readonly sourceSeq: number
  readonly reducer: string
  readonly stage: PruneStage
  readonly component: CompressionAuditComponent
  readonly historyMode?: HistoryMode
  readonly charsBefore: number
  readonly charsAfter: number
  readonly tokensBefore: number
  readonly tokensAfter: number
  /**
   * Which measurement produced this plan's decision: 'exact-tokenizer' when
   * both sides of the reduction carry one bundled tokenizer identity,
   * 'characters' when the proof ran on code points alone.
   */
  readonly measurementBasis: 'exact-tokenizer' | 'characters'
  readonly tokenizerId: string
  readonly tokenizerRevision: string
  /**
   * Original-event lines the reducer elided (task_4c/G7 telemetry, from
   * `ReducerOutput.elidedLines`). Rides the rewrite AUDIT record only — it is
   * never printed into replacement content.
   */
  readonly elidedLines?: number
}

/**
 * Discriminated History planning outcome: every skip path carries its own
 * reason instead of collapsing into one merged "no eligible minimum reclaim"
 * audit, so operators can tell a protected working set from an unreachable
 * reclaim target. The former 'exact-tokenizer-unavailable' member is gone:
 * planning decides on the character basis and can no longer refuse for a
 * missing exact count.
 */
export type HistoryPlanOutcome =
  | { readonly kind: 'planned', readonly plans: PlannedReplacement[] }
  | { readonly kind: 'below-profile-trigger' }
  | { readonly kind: 'no-safe-candidates' }
  | { readonly kind: 'protected-working-set' }
  | { readonly kind: 'insufficient-reclaim', readonly reclaim: number, readonly required: number }
  | { readonly kind: 'cannot-reach-deadline-target', readonly reclaim: number, readonly required: number }
