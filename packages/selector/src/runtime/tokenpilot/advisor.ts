/**
 * Advisory relevance advisor: LLM relevance statistics and suggestions bound
 * to the session todolist.
 *
 * The advisor is NOT a reviewer or gate. Every output — tail-task summaries,
 * per-candidate relevance scores, the prefix-decay figure, recertification
 * marks — is observational: it must never suppress, delay, or rewrite any
 * reduction that would land, and nothing here is consulted by any decision
 * path this round. Failures are fail-open; every call is fire-and-forget from
 * the turn-stopping boundary.
 *
 * Task semantics come from the most recent `todo/write` session event
 * (defensively parsed — the payload carries no public type), falling back to
 * recent user/message text when no todolist exists.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { charsForTokens, codePointLength } from '../config.ts'
import type { CompressionProfile } from '../types.ts'
import type { AdvisorOutcomeAuditRecord } from '../audit.ts'
import {
  getAdvisorState,
  invalidateOnTaskChange,
  recordRecertified,
  recordScore,
  type AdvisorState,
} from './advisor-state.ts'
import type { SideChannel } from './sidechannel.ts'
import {
  buildAdvisorScoringSystemPrompt,
  buildAdvisorScoringUserPrompt,
  buildAdvisorSummarySystemPrompt,
  buildAdvisorSummaryUserPrompt,
  parseAdvisorScores,
  parseAdvisorSummary,
} from './advisor-prompt.ts'

/** Character cap for the recent-text fallback and the tail-text summary input. */
export const TAIL_TEXT_CHAR_BUDGET = 4_000
/** Score the advisor assigns to candidates it has no answer for. */
const NEUTRAL_RELEVANCE = 0.5

/** Task semantics harvested from the session log, bound to the todolist. */
export interface TaskSemantics {
  /** `todos`: structured todo/write payload; `raw-todo`: degraded JSON string; `messages`: recent user text. */
  readonly source: 'todos' | 'raw-todo' | 'messages'
  /** Stable version token of the task semantics (scores/summaries invalidate on change). */
  readonly todoVersion: string
  /** Human-readable task description fed to the summary and scoring prompts. */
  readonly taskText: string
}

/** Minimal candidate face the advisor needs; satisfied by SnapshotCandidate. */
export interface AdvisorCandidate {
  readonly seq: number
  readonly characterPressure: number
  /** Short content sample for the scoring prompt (tool-call name + text head). */
  readonly preview: string
}

/** One scoring-pass candidate with its local keyword-overlap prescreen rank. */
interface ScoredCandidateView extends AdvisorCandidate {
  readonly overlap: number
}

/** Deterministic djb2-derived hex digest for task-semantics versioning. */
function versionDigest(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Truncate on the character basis (Unicode code points), never UTF-16 units. */
function truncateChars(text: string, budget: number): string {
  if (codePointLength(text) <= budget) return text
  return Array.from(text).slice(0, budget).join('')
}

/** Character cap of one candidate preview line offered to the scoring prompt. */
const PREVIEW_CHAR_BUDGET = 200

/**
 * One candidate face for the scoring prompt: tool-call name plus the head of
 * the result text. Pure and shape-defensive.
 */
export function advisorCandidatePreview(callName: string, blocks: unknown): string {
  const text = textBlocks(blocks)
  return truncateChars(`${callName} ${text}`.trim(), PREVIEW_CHAR_BUDGET)
}

/**
 * Collect the recent assistant narration tail (bounded, oldest-first join) as
 * summary-prompt context. Pure.
 */
export function collectTailText(events: readonly SessionEvent[], budget: number = TAIL_TEXT_CHAR_BUDGET): string {
  const parts: string[] = []
  let size = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const text = textBlocks(event.data).trim()
    if (text.length === 0) continue
    parts.unshift(text)
    size += codePointLength(text)
    if (size >= budget) break
  }
  return truncateChars(parts.join('\n'), budget)
}

function textBlocks(data: unknown): string {
  const content = (data as { content?: { type?: unknown, text?: unknown }[] } | undefined)?.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/** Structured probe of one `todo/write` payload: the list of task strings, or undefined. */
function extractTodoItems(data: unknown): string[] | undefined {
  const todos = (data as { todos?: unknown } | undefined)?.todos
  const list = Array.isArray(todos) ? todos : Array.isArray(data) ? data : undefined
  if (list === undefined || list.length === 0) return undefined
  const items: string[] = []
  for (const entry of list) {
    if (typeof entry === 'string') {
      if (entry.trim().length > 0) items.push(entry.trim())
      continue
    }
    if (entry !== null && typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      const text = [record.content, record.text, record.title, record.name]
        .find(candidate => typeof candidate === 'string' && candidate.trim().length > 0)
      if (typeof text === 'string') {
        items.push(text.trim())
        continue
      }
      // Structured shape the advisor does not recognize: keep the item visible
      // as its raw JSON so the LLM still sees the todolist instead of nothing.
      items.push(JSON.stringify(record))
    }
  }
  return items.length > 0 ? items : undefined
}

/**
 * Harvest task semantics for the summary/scoring prompts: the most recent
 * `todo/write` event (structured probe first, then the raw JSON string),
 * falling back to recent user/message text. Pure — log in, semantics out.
 */
export function collectTaskSemantics(events: readonly SessionEvent[]): TaskSemantics | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    // `todo/write` is plugin-merged into the runtime event vocabulary but not
    // the static SessionEventMap union, so the probe compares widened types.
    if (event === undefined || (event.type as string) !== 'todo/write') continue
    const data: unknown = (event as { data?: unknown }).data
    const items = extractTodoItems(data)
    if (items !== undefined) {
      const taskText = truncateChars(items.join('\n'), TAIL_TEXT_CHAR_BUDGET)
      return { source: 'todos', todoVersion: versionDigest(taskText), taskText }
    }
    const raw = truncateChars(JSON.stringify(event.data) ?? '', TAIL_TEXT_CHAR_BUDGET)
    if (raw.length > 2) {
      return { source: 'raw-todo', todoVersion: versionDigest(raw), taskText: raw }
    }
  }
  // No usable todolist: fall back to the most recent user/message text.
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const text = truncateChars(textBlocks(event.data).trim(), TAIL_TEXT_CHAR_BUDGET)
    if (text.length === 0) continue
    return { source: 'messages', todoVersion: versionDigest(text), taskText: text }
  }
  return undefined
}

/**
 * Prefix-decay figure: 1 minus the character-pressure-weighted mean relevance
 * of the prefix candidates. Unscored candidates count as neutral 0.5. Pure,
 * deterministic, no LLM and no I/O.
 */
export function prefixDecay(
  candidates: readonly { readonly seq: number, readonly characterPressure: number }[],
  scores: ReadonlyMap<number, { readonly score: number }>,
): { readonly decay: number, readonly weightedChars: number } {
  let totalWeight = 0
  let weightedRelevance = 0
  for (const candidate of candidates) {
    const weight = candidate.characterPressure > 0 ? candidate.characterPressure : 0
    if (weight === 0) continue
    totalWeight += weight
    weightedRelevance += weight * (scores.get(candidate.seq)?.score ?? NEUTRAL_RELEVANCE)
  }
  if (totalWeight === 0) return { decay: 0, weightedChars: 0 }
  return {
    decay: 1 - weightedRelevance / totalWeight,
    weightedChars: totalWeight,
  }
}

/** Lowercase word tokens used by the local keyword-overlap prescreen. */
function keywordsOf(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? []
  return new Set(matches)
}

function overlapCount(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0
  for (const token of right) {
    if (left.has(token)) count += 1
  }
  return count
}

/**
 * Incremental scoring selection: candidates newer than the watermark whose
 * character pressure reaches the token-named floor, ranked by local keyword
 * overlap with the task semantics and cut at the sample limit. When the task
 * semantics changed, the watermark is ignored so every eligible candidate can
 * rescore. Pure.
 */
export function selectScoringCandidates(
  candidates: readonly AdvisorCandidate[],
  state: Pick<AdvisorState, 'watermarkSeq'>,
  input: {
    readonly taskKeywords: ReadonlySet<string>
    readonly minChars: number
    readonly sampleLimit: number
    readonly taskChanged: boolean
  },
): AdvisorCandidate[] {
  const eligible: ScoredCandidateView[] = []
  for (const candidate of candidates) {
    if (!input.taskChanged && candidate.seq <= state.watermarkSeq) continue
    if (candidate.characterPressure < input.minChars) continue
    eligible.push({
      ...candidate,
      overlap: overlapCount(input.taskKeywords, keywordsOf(candidate.preview)),
    })
  }
  eligible.sort((left, right) => right.overlap - left.overlap || right.characterPressure - left.characterPressure)
  return eligible.slice(0, input.sampleLimit).map(({ overlap: _overlap, ...candidate }) => candidate)
}

/** Advisor inputs the pruner owns; the advisor never reaches into pruner state. */
export interface AdvisorPassInput {
  readonly profile: CompressionProfile
  readonly sessionId: string
  readonly turn: number
  readonly candidates: readonly AdvisorCandidate[]
  readonly task: TaskSemantics | undefined
  readonly advisor: {
    readonly refreshTurns: number
    readonly scoreThreshold: number
    readonly sampleLimit: number
    readonly minTokens: number
  }
  /** Tail assistant text offered to the summary prompt (already char-bounded). */
  readonly tailText: string
  readonly signal: AbortSignal
}

/** One ask-shaped LLM channel; satisfied by SideChannel.ask. */
export type AdvisorChannel = Pick<SideChannel, 'ask' | 'identity'>

export interface AdvisorPassOutcome {
  readonly decay: number
  readonly weightedChars: number
  readonly sampled: number
}

function advisorAudit(
  input: AdvisorPassInput,
  phase: AdvisorOutcomeAuditRecord['phase'],
  fields: Partial<AdvisorOutcomeAuditRecord> & { ok: boolean, latencyMs: number },
): AdvisorOutcomeAuditRecord {
  return {
    schemaVersion: 1,
    kind: 'advisor-outcome',
    sessionId: input.sessionId,
    phase,
    turnIndex: input.turn,
    ...fields,
  }
}

/**
 * One full advisor pass: summary refresh (todo change or every refreshTurns),
 * incremental batch scoring with recertification marks, then the decay
 * figure. State is written only on success; any failure leaves state
 * untouched, emits ok:false audits with reason codes, and never throws.
 */
export async function runAdvisorPass(
  state: AdvisorState,
  channel: AdvisorChannel,
  emit: (record: AdvisorOutcomeAuditRecord) => void,
  input: AdvisorPassInput,
): Promise<AdvisorPassOutcome | undefined> {
  if (input.task === undefined) return undefined
  const taskChanged = invalidateOnTaskChange(state, input.task.todoVersion)
  const turn = input.turn
  const needSummary = state.summary === undefined || turn - state.lastSummaryTurn >= input.advisor.refreshTurns

  // 1. Tail-task summary: bound to the todolist, refreshed on change or interval.
  if (needSummary) {
    const summaryStarted = Date.now()
    const summaryText = await channel.ask({
      system: buildAdvisorSummarySystemPrompt(),
      user: buildAdvisorSummaryUserPrompt(input.task.taskText, input.tailText),
      signal: input.signal,
    })
    const summaryLatencyMs = Date.now() - summaryStarted
    const summary = input.signal.aborted ? undefined : parseAdvisorSummary(summaryText)
    if (summary === undefined) {
      emit(advisorAudit(input, 'summary', {
        ok: false,
        latencyMs: summaryLatencyMs,
        ...(input.signal.aborted
          ? { reason: 'aborted' }
          : summaryText === undefined ? { reason: 'channel-empty' } : { reason: 'parse-failed' }),
      }))
      return undefined
    }
    state.summary = { ...summary, todoVersion: input.task.todoVersion, turn }
    state.lastSummaryTurn = turn
    emit(advisorAudit(input, 'summary', { ok: true, latencyMs: summaryLatencyMs }))
  }

  const summary = state.summary
  if (summary === undefined) return undefined

  // 2. Incremental batch scoring: prescreened candidates, one LLM call.
  const sampled = selectScoringCandidates(input.candidates, state, {
    taskKeywords: keywordsOf(`${input.task.taskText}\n${summary.keywords.join(' ')}`),
    minChars: charsForTokens(input.advisor.minTokens),
    sampleLimit: input.advisor.sampleLimit,
    taskChanged,
  })
    let scored = 0
    let highestScored = 0
    if (sampled.length > 0) {
    const scoringStarted = Date.now()
    const scoresText = await channel.ask({
      system: buildAdvisorScoringSystemPrompt(),
      user: buildAdvisorScoringUserPrompt(input.task.taskText, summary.activeSubtasks, sampled),
      signal: input.signal,
    })
    const scoringLatencyMs = Date.now() - scoringStarted
    const scores = input.signal.aborted ? undefined : parseAdvisorScores(scoresText, new Set(sampled.map(item => item.seq)))
    if (scores === undefined || scores.size === 0) {
      emit(advisorAudit(input, 'scoring', {
        ok: false,
        sampledCount: sampled.length,
        latencyMs: scoringLatencyMs,
        ...(input.signal.aborted
          ? { reason: 'aborted' }
          : scoresText === undefined ? { reason: 'channel-empty' } : { reason: 'parse-failed' }),
      }))
      return undefined
    }
    for (const candidate of sampled) {
      const answer = scores.get(candidate.seq)
      if (answer === undefined) continue
      recordScore(state, candidate.seq, { score: answer.score, turn })
      scored += 1
      if (candidate.seq > highestScored) highestScored = candidate.seq
      // R5: low-relevance segments are LLM-recertified as suggestions only —
      // nothing consumes the marks this round, and the caller is expected to
      // have filtered protected candidates out of `candidates`.
      if (answer.score < input.advisor.scoreThreshold) recordRecertified(state, candidate.seq, turn)
    }
    emit(advisorAudit(input, 'scoring', { ok: true, sampledCount: sampled.length, latencyMs: scoringLatencyMs }))
    // The watermark only moves past candidates that actually received a
    // score: rows the channel dropped stay eligible so a later pass can
    // rescore them instead of silently losing them behind the cut.
    if (highestScored > state.watermarkSeq) state.watermarkSeq = highestScored
  }

  // 3. Decay figure over the whole prefix: local, always emitted on a pass
  //    that got this far (even with zero samples this round). Stored on the
  //    state so the report route serves the exact same figure (J3).
  const decay = prefixDecay(input.candidates, state.scores)
  state.lastDecay = { decay: decay.decay, weightedChars: decay.weightedChars, turn }
  emit(advisorAudit(input, 'decay', {
    ok: true,
    sampledCount: scored,
    decay: decay.decay,
    weightedChars: decay.weightedChars,
    latencyMs: 0,
  }))
  return { decay: decay.decay, weightedChars: decay.weightedChars, sampled: sampled.length }
}

/**
 * Convenience entry used by the pruner: fetch-or-create the session state and
 * run one pass against it.
 */
export async function runSessionAdvisorPass(
  session: Parameters<typeof getAdvisorState>[0],
  channel: AdvisorChannel,
  emit: (record: AdvisorOutcomeAuditRecord) => void,
  input: Omit<AdvisorPassInput, 'sessionId'> & { readonly sessionId?: string },
): Promise<AdvisorPassOutcome | undefined> {
  const state = getAdvisorState(session)
  if (state.inFlight) return undefined
  state.inFlight = true
  try {
    return await runAdvisorPass(state, channel, emit, {
      ...input,
      sessionId: input.sessionId ?? String(session.id),
    })
  } finally {
    state.inFlight = false
  }
}
