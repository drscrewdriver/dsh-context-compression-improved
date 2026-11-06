/**
 * Frozen triage contract (plan cci-sedimentation-triage, T0.4).
 *
 * Single source of truth for the three-line sorting vocabulary shared by the
 * signal pool (line A), the narrative stream (line B), and the deterministic
 * masks (line C), plus the whole-turn card assembly. Downstream phases treat
 * this file as read-only: contract changes require a plan amendment, not an
 * in-flight edit.
 *
 * @module runtime/triage/types
 */

/** Roles whose lines may enter the verbatim protection pool. */
export type TriageRole = 'user' | 'assistant' | 'tool'

/**
 * Permanent shallow-read checkpoint (plan R11): survives `discard` — the
 * map is never lost, only the map's bulk. Four fields, rendered as one line.
 */
export interface ShallowCheckpoint {
  /** Normalized target path (drive letter lowered, separators unified). */
  readonly path: string
  /** Coverage statement of the body the checkpoint stands for. */
  readonly coverage: string
  /** session:// reference into the original event (retrieve target). */
  readonly ref: string
  /** Cheap structural fingerprint (size + head hash) for staleness hints. */
  readonly fingerprint: string
}

/** One verbatim line captured by a signal rule, capped at capture time. */
export interface VerbatimLine {
  /** Event seq of the owning tool/result or message on the session surface. */
  readonly seq: number
  readonly role: TriageRole
  /** Line text as captured (240-codepoint cap applied, `truncated` marks it). */
  readonly text: string
  /** Rule id that captured this line (base set or extra slot), for audit. */
  readonly ruleId: string
  /** True when the stored text hit the per-line cap. */
  readonly truncated: boolean
  /** True when the owning block carried a hard failure signal (exit/stderr/isError). */
  readonly hardFailure: boolean
}

/** Deterministic mask verdict for one tool result (line C). */
export type MaskVerdict =
  | {
      readonly kind: 'manifest'
      /** Target paths resolved from call args first, result text only as fallback. */
      readonly paths: readonly string[]
      readonly seq: number
    }
  | {
      readonly kind: 'skeleton'
      /** Captured declaration lines (base order preserved, capped). */
      readonly lines: readonly string[]
      /** Total body lines the skeleton stands for. */
      readonly totalLines: number
      /** Byte length of the elided body, for omission stats. */
      readonly elidedChars: number
      readonly seq: number
      /** Permanent checkpoint layer (R11); `discard` may remove body, never this. */
      readonly checkpoint?: ShallowCheckpoint
    }
  | {
      readonly kind: 'pointer'
      /** Oversized single result replaced by its event-seq pointer. */
      readonly seq: number
      readonly tokens: number
    }

/** One narrative span left for the compression stream (line B). */
export interface NarrativeSpan {
  readonly seq: number
  readonly role: TriageRole
  /** Token estimate carried by the span (estimator contract: same meter as stats). */
  readonly tokens: number
  readonly text: string
}

/**
 * Complete per-block triage output. `poolLines` and `mask` are verbatim-safe
 * (copy, never paraphrase); `residualNarrative` is the only fold-eligible
 * material and MUST NOT contain pooled or masked content.
 */
export interface TriageResult {
  readonly poolLines: readonly VerbatimLine[]
  readonly mask?: MaskVerdict
  readonly residualNarrative: readonly NarrativeSpan[]
  /** Gross tokens of the source block, for the rewrite guard accounting. */
  readonly sourceTokens: number
}

/** Card assembly order (R1/R7): mechanical cache first, narrative appended last. */
export interface TurnCardDraft {
  /** Pointer head: one line, event-seq reference, no backup paths. */
  readonly head: string
  /** Verbatim protection pool section (line A). */
  readonly pool: readonly VerbatimLine[]
  /** Mask sections (line C), in span order. */
  readonly masks: readonly MaskVerdict[]
  /** Omission stats line (counts only). */
  readonly omissionStats: string
  /** Narrative segment: closing text (tier 1) or fold output (tier 2); absent = tier 3. */
  readonly narrative?: string
  /** Narrative tier actually used, for audit and stats separation (M22). */
  readonly narrativeTier: 'closing' | 'fold' | 'mechanical-only'
  /** Sum of retained verbatim+narrative tokens; replacement requires < sourceTokens (M7). */
  readonly retainedTokens: number
  /** Source span tokens this card replaces. */
  readonly sourceTokens: number
}

/** Gate verdicts for one whole-turn replacement candidate (R13). */
export interface TurnGateVerdict {
  /** reason gate: only `turn/end(completed)` may proceed. */
  readonly completed: boolean
  /** closing qualification gate result (tier decision already made upstream). */
  readonly narrativeTier: TurnCardDraft['narrativeTier']
  /** rewrite guard: retained saving must clear tail-rewrite × ratio (findings F2). */
  readonly rewriteGuardPassed: boolean
  /** estimated cached-tail tokens invalidated by the replacement point. */
  readonly rewriteTailTokens: number
}
