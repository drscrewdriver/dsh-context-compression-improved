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
  /** Authoritative same-revision exact canonical content count. */
  readonly count: TokenCount
  /** Same-revision legacy heuristic price used only by bounded projections. */
  readonly shadowedHeuristicTokenCount: number
  /** Character pressure is candidate-shape telemetry only, never a gate. */
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
  readonly tokenizerId: string
  readonly tokenizerRevision: string
}

/**
 * Discriminated History planning outcome: every skip path carries its own
 * reason instead of collapsing into one merged "no eligible minimum reclaim"
 * audit, so operators can tell a protected working set from missing exact
 * counts or an unreachable reclaim target.
 */
export type HistoryPlanOutcome =
  | { readonly kind: 'planned', readonly plans: PlannedReplacement[] }
  | { readonly kind: 'exact-tokenizer-unavailable' }
  | { readonly kind: 'below-profile-trigger' }
  | { readonly kind: 'no-safe-candidates' }
  | { readonly kind: 'protected-working-set' }
  | { readonly kind: 'insufficient-reclaim', readonly reclaim: number, readonly required: number }
  | { readonly kind: 'cannot-reach-deadline-target', readonly reclaim: number, readonly required: number }
