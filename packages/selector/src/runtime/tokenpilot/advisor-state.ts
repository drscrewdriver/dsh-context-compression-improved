/**
 * Per-session state for the advisory relevance advisor.
 *
 * The advisor is statistics and suggestions only — its outputs (summaries,
 * scores, decay, recertification marks) are observational and must never
 * suppress, delay, or rewrite any reduction that would land. All state lives
 * in WeakMaps keyed by the Session object so it is collected with the session
 * and never leaks across sessions; every collection inside the state is
 * bounded.
 *
 * Module-level `getAdvisorState` mirrors the PrunerState consolidation pattern
 * (GC semantics identical) so `pruner.ts` reaches advisor state through a
 * plain import rather than constructor injection.
 */
import type { Session } from '@deepseek-ai/dsh-session'
import type { AdviceBand } from './benefit.ts'

/** The most recent benefit-model label of a landed batch. Observational only:
 *  no decision path reads it — the report route serves it verbatim. */
export interface AdvisorAdviceSnapshot {
  readonly band: AdviceBand
  /** Turn index the advised batch landed at. */
  readonly turn: number
  readonly itemSeqs: readonly number[]
  readonly recoveredTokens: number
  readonly penaltyTokens: number
  readonly paybackTurns?: number
}

/** One relevance score for one surface seq, with the turn it was scored at. */
export interface AdvisorScoreEntry {
  readonly score: number
  /** Turn index the score was produced at. */
  readonly turn: number
}

/** LLM-summarized tail-task semantics bound to the session todolist. */
export interface AdvisorSummary {
  /** The session's overall task, one sentence. */
  readonly overallTask: string
  /** Subtasks currently being pushed forward. */
  readonly activeSubtasks: readonly string[]
  /** Short task keywords used by the local relevance prescreen. */
  readonly keywords: readonly string[]
  /** Task-semantics version the summary was derived from. */
  readonly todoVersion: string
  /** Turn index the summary was produced at. */
  readonly turn: number
}

/** Per-session estimator-style failure bookkeeping for exponential backoff. */
export interface AdvisorFailures {
  failures: number
  cooldownUntil: number
}

/** Bounded per-session advisor state bag. */
export interface AdvisorState {
  /** Version of the task semantics the cached summary and scores were built against. */
  todoVersion: string | undefined
  summary: AdvisorSummary | undefined
  /** Turn index the last summary pass ran at. */
  lastSummaryTurn: number
  /** Highest candidate seq the scoring pass has examined (incremental watermark). */
  watermarkSeq: number
  /** LRU-bounded seq → score map (most recent touch wins, oldest evicted). */
  readonly scores: Map<number, AdvisorScoreEntry>
  /** Bounded seq → turn marks for old low-relevance segments (suggestions only). */
  readonly recertified: Map<number, number>
  failures: AdvisorFailures | undefined
  /** Re-entry guard: summary + scoring are two LLM calls, so the overlap window is wide. */
  inFlight: boolean
  /** Most recent decay computation, shared verbatim by audits and the report route. */
  lastDecay: { readonly decay: number, readonly weightedChars: number, readonly turn: number } | undefined
  /** Most recent benefit-model advice; replaced by every advised batch. */
  lastAdvice: AdvisorAdviceSnapshot | undefined
}

/** Upper bound of the per-session scores LRU. */
export const ADVISOR_SCORES_LIMIT = 64
/** Upper bound of the per-session recertification marks. */
export const ADVISOR_RECERTIFIED_LIMIT = 64

const advisorStates = new WeakMap<Session, AdvisorState>()

/**
 * The per-session advisor state, created on first touch.
 * @param session - the session to key the state on (by object identity).
 */
export function getAdvisorState(session: Session): AdvisorState {
  let state = advisorStates.get(session)
  if (state === undefined) {
    state = {
      todoVersion: undefined,
      summary: undefined,
      lastSummaryTurn: -1,
      watermarkSeq: 0,
      scores: new Map(),
      recertified: new Map(),
      failures: undefined,
      inFlight: false,
      lastDecay: undefined,
      lastAdvice: undefined,
    }
    advisorStates.set(session, state)
  }
  return state
}

/**
 * Insert or refresh one score with LRU semantics: a re-touched seq moves to
 * the newest position, and the oldest entry is evicted once the map exceeds
 * {@link ADVISOR_SCORES_LIMIT}.
 */
export function recordScore(state: AdvisorState, seq: number, entry: AdvisorScoreEntry): void {
  state.scores.delete(seq)
  state.scores.set(seq, entry)
  if (state.scores.size > ADVISOR_SCORES_LIMIT) {
    const oldest = state.scores.keys().next()
    if (oldest.done !== true) state.scores.delete(oldest.value)
  }
}

/**
 * Mark one seq as LLM-recertified low relevance (a suggestion for later
 * history-aggressiveness decisions, consumed by nothing in this round).
 * Bounded at {@link ADVISOR_RECERTIFIED_LIMIT} with the same LRU eviction.
 */
export function recordRecertified(state: AdvisorState, seq: number, turn: number): void {
  state.recertified.delete(seq)
  state.recertified.set(seq, turn)
  if (state.recertified.size > ADVISOR_RECERTIFIED_LIMIT) {
    const oldest = state.recertified.keys().next()
    if (oldest.done !== true) state.recertified.delete(oldest.value)
  }
}

/**
 * Drop every cached artifact that depends on the task semantics: a changed
 * todo version invalidates the summary and makes all eligible candidates
 * rescore-worthy (the watermark alone would otherwise hide them).
 */
export function invalidateOnTaskChange(state: AdvisorState, todoVersion: string): boolean {
  if (state.todoVersion === todoVersion) return false
  state.todoVersion = todoVersion
  state.summary = undefined
  state.lastSummaryTurn = -1
  return true
}
