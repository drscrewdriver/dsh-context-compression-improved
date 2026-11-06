/**
 * Sediment orchestrator (plan cci-sedimentation-triage, Phase 3, T3.6).
 *
 * Host-agnostic by injection: the wiring site (pruner) supplies the settings
 * snapshot reader, the event reader, and the call-id map; this module owns
 * the per-session clock and the turn-end decision pipeline:
 *
 *   settings gate → clock predicate → span plan (reason gate)
 *   → triage → card build (tier gates) → rewrite guard → publish.
 *
 * With `sediment.enabled=false` (the default) the FIRST check short-circuits
 * and nothing else in this module runs — the M1 zero-drift guarantee holds by
 * construction: no event accumulation, no card, no append.
 */
import { planTurnSpan, triageSpanBlocks, type SurfaceEvent } from './sediment-span.ts'
import { buildTurnCard, estimateTokens } from './sediment-card.ts'
import { passesRewriteGuard, projectSurfaceEvent, publishSettledCard, type PublishResult } from './sediment-publish.ts'
import { SedimentClock, type CommitDecision } from './sediment-clock.ts'
import { mergeExtraPatterns, type LineRule } from './triage/signals.ts'
import { buildFoldPrompt, type FoldPrompt } from './fold-router.ts'
import type { MaskVerdict } from './triage/types.ts'
import type { SedimentSettings } from './types.ts'

/** Minimal append-capable session face (real Session satisfies it). */
export interface SedimentSession {
  readonly id: string | number
  append(type: never, data: never, options?: never): { seq: number }
}

export interface OrchestratorOptions {
  /** Frozen per-session settings snapshot reader; undefined = not yet observed. */
  readonly settingsFor: (sessionId: string) => SedimentSettings | undefined
  /** Raw host events for one turn (including the trailing turn/end). */
  readonly eventsFor: (session: SedimentSession, turn: number) => ReadonlyArray<{
    seq: number
    type: string
    data?: Record<string, any>
  }>
  /** call-id → tool name/args map built by the wiring site. */
  readonly callInfoFor: (sessionId: string) => (callId: string | undefined) => { name: string; argsJson: string } | undefined
  /** Tokens on the surface AFTER the span (rewrite tail estimate). */
  readonly tailTokensFor: (session: SedimentSession, endSeq: number) => number
  readonly onLanded?: (sessionId: string, savedTokens: number, tier: string, result: PublishResult) => void
  readonly onSkip?: (sessionId: string, reason: string) => void
  /** Narrative tier 2 channel (T4.5): present only when a fold endpoint is configured. */
  readonly fold?: {
    readonly run: (sessionId: string, prompt: FoldPrompt, signal: AbortSignal) => Promise<string | undefined>
  }
}

export interface TurnOutcome {
  readonly committed: boolean
  readonly reason: string
}

/** Compiled extra-pattern rules per session settings identity (cheap cache). */
const ruleCache = new WeakMap<SedimentSettings, readonly LineRule[]>()

function rulesFor(settings: SedimentSettings): readonly LineRule[] {
  let rules = ruleCache.get(settings)
  if (rules === undefined) {
    rules = mergeExtraPatterns(settings.extraSignalPatterns ?? [])
    ruleCache.set(settings, rules)
  }
  return rules
}

export class SedimentOrchestrator {
  private readonly clocks = new Map<string, SedimentClock>()

  constructor(private readonly options: OrchestratorOptions) {}

  clockFor(sessionId: string): SedimentClock {
    let clock = this.clocks.get(sessionId)
    if (clock === undefined) {
      clock = new SedimentClock()
      this.clocks.set(sessionId, clock)
    }
    return clock
  }

  /**
   * Entry point called by the wiring site on `turn/end`. Returns immediately
   * with reason 'disabled' when the gate is off — nothing downstream runs.
   */
  async handleTurnEnd(session: SedimentSession, turn: number, context: {
    readonly lastEventType: string | undefined
    readonly inFlightRequest: boolean
    readonly compactionOpen: boolean
    readonly officialCheckpointSeq: number | undefined
    readonly resumeFirstBatch: boolean
  }): Promise<TurnOutcome> {
    const sessionId = String(session.id)
    const settings = this.options.settingsFor(sessionId)
    if (settings === undefined || !settings.enabled) {
      return { committed: false, reason: 'disabled' }
    }
    const clock = this.clockFor(sessionId)
    const decision: CommitDecision = clock.decide({
      lastEventType: context.lastEventType,
      inFlightRequest: context.inFlightRequest,
      compactionOpen: context.compactionOpen,
      officialCheckpointSeq: context.officialCheckpointSeq,
      resumeFirstBatch: context.resumeFirstBatch,
    })
    if (!decision.ok) {
      // Consuming the yield is the clock's job: once skipped for an official
      // checkpoint, the next seam may proceed.
      if (context.officialCheckpointSeq !== undefined && decision.reason.startsWith('yield-official')) {
        clock.noteOfficialConsumed(context.officialCheckpointSeq)
      }
      this.options.onSkip?.(sessionId, decision.reason)
      return { committed: false, reason: decision.reason }
    }
    if (!clock.begin()) {
      return { committed: false, reason: 'already-committing' }
    }
    try {
      return await this.commitTurn(session, turn, settings, clock)
    } finally {
      clock.end()
    }
  }

  private async commitTurn(
    session: SedimentSession,
    turn: number,
    settings: SedimentSettings,
    clock: SedimentClock,
  ): Promise<TurnOutcome> {
    const sessionId = String(session.id)
    const rawEvents = this.options.eventsFor(session, turn)
    const projected: SurfaceEvent[] = []
    for (const event of rawEvents) {
      const callId = event.data?.message?.toolCallId as string | undefined
      const surface = projectSurfaceEvent(event.seq, {
        type: event.type,
        data: event.data as never,
      }, this.options.callInfoFor(sessionId)(callId))
      if (surface !== null) projected.push(surface)
    }
    const plan = planTurnSpan(projected)
    if (!plan.completed) {
      this.options.onSkip?.(sessionId, 'reason-gate')
      return { committed: false, reason: 'reason-gate' }
    }
    if (plan.startSeq === null || plan.endSeq === null) {
      this.options.onSkip?.(sessionId, 'empty-span')
      return { committed: false, reason: 'empty-span' }
    }
    const triage = triageSpanBlocks(plan, rulesFor(settings))
    const foldAvailable = this.options.fold !== undefined
    // Narrative tier 2 (T4.5): when the closing body fails the qualification
    // gate and a fold channel is configured, request the connective narrative
    // over the residual spans ONLY (protected/skeleton material is excluded
    // by buildFoldPrompt construction, S4). Timeout and failure are the
    // FoldRouter's fail-open contract; undefined drops the card to tier 3.
    let foldText: string | undefined
    if (this.options.fold !== undefined && estimateTokens(plan.closingText) < (settings.minClosingTokens ?? 120)) {
      const spans = triage.flatMap(result => result.residualNarrative)
      const protectedLines = triage.flatMap(result => result.poolLines)
      const masks = triage.map(result => result.mask).filter((mask): mask is MaskVerdict => mask !== undefined)
      const prompt = buildFoldPrompt(spans, protectedLines, masks)
      if (prompt !== null) {
        foldText = await this.options.fold.run(sessionId, prompt, AbortSignal.timeout(20_000))
      }
    }
    const draft = buildTurnCard({
      startSeq: plan.startSeq,
      endSeq: plan.endSeq,
      triage,
      closingText: plan.closingText,
      foldAvailable,
      ...(foldText === undefined ? {} : { foldText }),
      minClosingTokens: settings.minClosingTokens,
    })
    if (draft === null) {
      this.options.onSkip?.(sessionId, 'tier-skip')
      return { committed: false, reason: 'tier-skip' }
    }
    const tailTokens = this.options.tailTokensFor(session, plan.endSeq)
    if (!passesRewriteGuard(draft, tailTokens, settings.rewriteGuardRatio)) {
      this.options.onSkip?.(sessionId, 'rewrite-guard')
      return { committed: false, reason: 'rewrite-guard' }
    }
    const result = publishSettledCard(session as never, draft, {
      startSeq: plan.startSeq,
      endSeq: plan.endSeq,
      shadowedSeqs: plan.blocks.map(block => block.seq),
    })
    if (result.ok) {
      this.options.onLanded?.(sessionId, draft.sourceTokens - draft.retainedTokens, draft.narrativeTier, result)
    } else {
      this.options.onSkip?.(sessionId, result.reason)
    }
    return { committed: result.ok, reason: result.reason }
  }
}

/** Re-exported for the wiring site's tail estimate fallback (kept single-sourced). */
export { estimateTokens }
