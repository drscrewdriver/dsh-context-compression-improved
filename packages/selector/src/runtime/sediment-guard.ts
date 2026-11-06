/**
 * PTC downgrade guard (plan cci-sedimentation-triage, Phase 3, T3.10/T3.11).
 *
 * Two decisions live here as pure functions, unit-tested before any wiring:
 * 1. PTC-mode detection — registration truth via the omnibus tool names
 *    (`run_code` on 0.1.x, `code_run` on 0.2.x), never wire literal guessing;
 * 2. the negative-feedback loop — when net savings stay negative across K
 *    request boundaries (the community 1:15 / HUD -24,035 shape), fall back
 *    to conservative mode: aging decisions OFF, only fresh large-block cuts.
 *
 * The WRITE_TOOLS blindness probe encodes the root cause directly: in PTC,
 * write operations fold into run_code bodies, so the regex-based read-state
 * predicate sees zero hits and its "superseded" verdicts are untrustworthy.
 */
import type { SedimentSettings } from './types.ts'

/** Omnibus tool names that mark a PTC/code-mode session (both host lines). */
export const OMNIBUS_TOOL_NAMES: readonly string[] = Object.freeze(['run_code', 'code_run'])

/** Conservative fallback mode: aging-style decisions disabled. */
export interface ConservativeMode {
  readonly conservative: boolean
  readonly reason: string
}

/** True when the registered tool surface contains an omnibus runner. */
export function detectPtcMode(hasTool: (name: string) => boolean): boolean {
  return OMNIBUS_TOOL_NAMES.some(name => hasTool(name))
}

/**
 * read-state blindness probe: with PTC active and ZERO write-tool regex hits
 * across the observed calls, the superseded predicate cannot see real write
 * targets — aging decisions must be considered untrustworthy.
 */
export function readStateBlind(ptcActive: boolean, writeRegexHits: number, observedCalls: number): boolean {
  if (!ptcActive) return false
  return observedCalls > 0 && writeRegexHits === 0
}

export interface NetSample {
  readonly grossSaved: number
  readonly recallOffset: number
}

/**
 * Feedback loop state: consumes request-boundary samples and decides whether
 * sediment/aging operation should run in conservative mode. K consecutive
 * negative-net samples arm it; a positive net sample disarms immediately.
 */
export class FeedbackLoop {
  private negativeStreak = 0
  private armed = false

  constructor(private readonly k: number = 5) {}

  get conservative(): boolean {
    return this.armed
  }

  observe(sample: NetSample): ConservativeMode {
    const net = sample.grossSaved - sample.recallOffset
    if (net < 0) {
      this.negativeStreak += 1
      if (this.negativeStreak >= this.k) this.armed = true
    } else if (net > 0) {
      this.negativeStreak = 0
      this.armed = false
    }
    return {
      conservative: this.armed,
      reason: this.armed ? `net-negative-x${this.negativeStreak}` : 'ok',
    }
  }
}

/**
 * Watcher adapter (T3.11 consumption point): the savings ledger reports
 * CUMULATIVE gross/offsets; the feedback loop needs per-boundary NET deltas.
 * This wrapper remembers the last reading and feeds the loop the difference.
 */
export class SedimentFeedbackWatcher {
  private last: { gross: number; offsets: number } = { gross: 0, offsets: 0 }

  constructor(private readonly loop: FeedbackLoop = new FeedbackLoop(5)) {}

  observe(totals: { gross: { exact: number, estimated: number }, offsets: { exact: number, estimated: number } }): ConservativeMode {
    const gross = totals.gross.exact + totals.gross.estimated
    const offsets = totals.offsets.exact + totals.offsets.estimated
    const sample = {
      grossSaved: gross - this.last.gross,
      recallOffset: offsets - this.last.offsets,
    }
    this.last = { gross, offsets }
    return this.loop.observe(sample)
  }

  get conservative(): boolean {
    return this.loop.conservative
  }
}

/**
 * Effective sediment behavior for one session after the PTC guard is folded
 * in: in PTC mode, aging-style decisions short-circuit and the rewrite guard
 * ratio tightens; the card pipeline itself (mask/pool/pointer) is unaffected.
 */
export function effectiveSedimentMode(
  settings: SedimentSettings,
  ptcActive: boolean,
  blindReadState: boolean,
  feedback: ConservativeMode,
): {
  readonly enabled: boolean
  readonly agingAllowed: boolean
  readonly rewriteGuardRatio: number
  readonly reason: string
} {
  if (!settings.enabled) {
    return { enabled: false, agingAllowed: false, rewriteGuardRatio: settings.rewriteGuardRatio, reason: 'disabled' }
  }
  const agingAllowed = !(ptcActive && blindReadState) && !feedback.conservative
  const rewriteGuardRatio = ptcActive || feedback.conservative
    ? Math.max(settings.rewriteGuardRatio, 5)
    : settings.rewriteGuardRatio
  return {
    enabled: true,
    agingAllowed,
    rewriteGuardRatio,
    reason: feedback.conservative
      ? `conservative:${feedback.reason}`
      : ptcActive && blindReadState
        ? 'ptc-blind-aging-off'
        : 'normal',
  }
}
