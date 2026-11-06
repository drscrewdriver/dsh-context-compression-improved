/**
 * Sediment commit clock (plan cci-sedimentation-triage, Phase 3, T3.4).
 *
 * Decides WHEN a prepared card may touch the surface. The predicate is the
 * event-sequence form from the plan (R7/T3.4): commit only in the quiet seam
 * after `step/end` or `turn/end`, never with an in-flight request, never
 * inside a compaction lifecycle, never on the first batch after resume, and
 * yielding exactly once to a freshly landed official checkpoint (spine's
 * seen-seq cooldown, adopted verbatim in behavior).
 *
 * Per-session state lives in `SedimentClock` instances — one agent's cooldown
 * must never leak into another's (same discipline as the engine's session
 * state map).
 */

export interface CommitContext {
  /** Type of the most recent surface event, e.g. 'turn/end' | 'step/end' | 'request/header'. */
  readonly lastEventType: string | undefined
  /** A request was dispatched for the current step and has not settled. */
  readonly inFlightRequest: boolean
  /** Between `compaction/start` and `compaction/end`. */
  readonly compactionOpen: boolean
  /** Seq of the newest official `compact-checkpoint` on the surface, if any. */
  readonly officialCheckpointSeq: number | undefined
  /** Seq of the official checkpoint this session already yielded to once. */
  readonly seenOfficialCheckpointSeq: number | undefined
  /** First commit window after a cold resume — replay paths are still settling. */
  readonly resumeFirstBatch: boolean
}

export interface CommitDecision {
  readonly ok: boolean
  readonly reason: string
}

/** Pure commit predicate; every exclusion returns a machine-readable reason. */
export function canCommitNow(context: CommitContext): CommitDecision {
  if (!context.inFlightRequest
    && context.lastEventType !== 'turn/end'
    && context.lastEventType !== 'step/end') {
    return { ok: false, reason: 'not-in-quiet-seam' }
  }
  if (context.inFlightRequest) return { ok: false, reason: 'request-in-flight' }
  if (context.compactionOpen) return { ok: false, reason: 'compaction-in-progress' }
  if (context.resumeFirstBatch) return { ok: false, reason: 'resume-first-batch' }
  const official = context.officialCheckpointSeq
  if (official !== undefined && official !== context.seenOfficialCheckpointSeq) {
    return { ok: false, reason: `yield-official-checkpoint-${official}` }
  }
  return { ok: true, reason: 'quiet-seam' }
}

/** Mutable per-session clock: cooldown consumption + re-entrance guard. */
export class SedimentClock {
  private warming = false
  private seenOfficialSeq: number | undefined

  /** True while a commit job is running for this session (no stacked cuts). */
  get busy(): boolean {
    return this.warming
  }

  /** Claim the commit slot; false means another job owns this session's seam. */
  begin(): boolean {
    if (this.warming) return false
    this.warming = true
    return true
  }

  end(): void {
    this.warming = false
  }

  /** Consume the one-time yield for the given official checkpoint seq. */
  noteOfficialConsumed(seq: number): void {
    this.seenOfficialSeq = seq
  }

  get seenOfficial(): number | undefined {
    return this.seenOfficialSeq
  }

  /** Decide with this clock's cooldown state folded in. */
  decide(base: Omit<CommitContext, 'seenOfficialCheckpointSeq'>): CommitDecision {
    return canCommitNow({ ...base, seenOfficialCheckpointSeq: this.seenOfficialSeq })
  }
}
