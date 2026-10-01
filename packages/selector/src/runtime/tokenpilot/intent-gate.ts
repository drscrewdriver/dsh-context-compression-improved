/**
 * Turn-tail intent-summary growth gate (TokenPilot-inspired E2).
 *
 * Pure decision helper evaluated at the turn-boundary postflight: it decides
 * whether this turn may spend a summary-writer LLM call and stage a fold for
 * the next pressure round. The gate is deliberately conservative — every
 * unresolved input (unknown context window, non-finite counters) fails closed
 * toward "do not run", because a skipped fold is free while a wasted summary
 * call is not. Content safety is unaffected either way: fail-open semantics
 * live in the fold landing path, not here.
 */

/** Floor: the live surface must exceed this fraction of the context window. */
export const INTENT_GATE_FLOOR_FRACTION = 0.45

/** Growth: the live surface must have grown by more than this since the last landed fold. */
export const INTENT_GATE_GROWTH_TOKENS = 50_000

/** Session-scoped user override set through `/ctx-summary off|on`. */
export type SummaryOverride = 'on' | 'off' | undefined

export interface IntentGateInput {
  /** Frozen `intentSummary.enabled` setting for the session. */
  enabled: boolean
  /** `/ctx-summary` override; `'off'` wins over everything, `'on'` never bypasses the numeric gates. */
  override: SummaryOverride
  /** Exact live-surface token estimate from the compaction view. */
  liveTokens: number
  /** Host context window in tokens; `undefined` fails the floor check. */
  contextWindow: number | undefined
  /** Live-surface tokens at the time the last fold landed (0 = never folded). */
  baselineTokens: number
}

export interface IntentGateSnapshot extends IntentGateInput {
  readonly decision: boolean
  readonly reason: 'disabled' | 'override-off' | 'no-window' | 'below-floor' | 'below-growth' | 'passed'
}

function isUsableNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/** Evaluate the growth gate. Boundary-exact: equality never triggers. */
export function shouldRunIntentFold(input: IntentGateInput): boolean {
  return evaluateIntentGate(input).decision === true
}

/** Same evaluation with the reason attached, for audits and `/ctx-summary status`. */
export function evaluateIntentGate(input: IntentGateInput): IntentGateSnapshot {
  const snapshot = (decision: boolean, reason: IntentGateSnapshot['reason']): IntentGateSnapshot => ({
    ...input,
    decision,
    reason,
  })
  if (!input.enabled) return snapshot(false, 'disabled')
  if (input.override === 'off') return snapshot(false, 'override-off')
  if (!isUsableNumber(input.liveTokens)) return snapshot(false, 'below-floor')
  if (input.contextWindow === undefined || !isUsableNumber(input.contextWindow)) return snapshot(false, 'no-window')
  if (!(input.liveTokens > input.contextWindow * INTENT_GATE_FLOOR_FRACTION)) return snapshot(false, 'below-floor')
  if (!isUsableNumber(input.baselineTokens)) return snapshot(false, 'below-growth')
  const growth = input.liveTokens - input.baselineTokens
  if (!(growth > INTENT_GATE_GROWTH_TOKENS)) return snapshot(false, 'below-growth')
  return snapshot(true, 'passed')
}
