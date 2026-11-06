/**
 * Whole-turn span planning (plan cci-sedimentation-triage, Phase 3, T3.3).
 *
 * Pure function over a minimal projected event list (the wiring site adapts
 * real session events to `SurfaceEvent`). Decisions made here:
 * - reason gate (R13①): only turns that ended `completed` are replaceable;
 * - tail-kept region (R13③): the last `tailRoundsKept` tool rounds stay
 *   verbatim on the surface — the replacement span ends before them;
 * - closing extraction: the last tool-call-free assistant text is the
 *   candidate closing body for the qualification gate;
 * - the span covers contiguous assistant/tool events after the turn's user
 *   message; a span with no maskable/replaceable block returns null.
 *
 * Turn boundaries make cross-turn pairing checks unnecessary (rounds close
 * inside their turn), which is the whole-turn granularity's main simplification.
 */
import type { TriageResult } from './triage/types.ts'
import { blockFailureVerdict, linePool, type LineRule } from './triage/signals.ts'
import { manifestFromCall, skeletonFromRead } from './triage/masks.ts'
import { estimateTokens } from './sediment-card.ts'

/** Minimal projected event the wiring site must provide per surface node. */
export interface SurfaceEvent {
  readonly seq: number
  readonly type: 'user/message' | 'assistant/message' | 'tool/result' | 'turn/end'
  readonly text: string
  /** tool-call block count on an assistant message (0 otherwise). */
  readonly toolCalls?: number
  /** Resolved tool name for a tool/result (call-id lookup done by the wiring site). */
  readonly toolName?: string
  /** Raw arguments JSON for the call owning a tool/result. */
  readonly argsJson?: string
  readonly isError?: boolean
  /** `turn/end` reason kind, e.g. 'completed' | 'interrupted'. */
  readonly reasonKind?: string
}

export interface TurnSpanPlan {
  readonly completed: boolean
  /** Inclusive replacement span; null when nothing is replaceable. */
  readonly startSeq: number | null
  readonly endSeq: number | null
  /** Events inside the span (assistant/tool), in order. */
  readonly blocks: readonly SurfaceEvent[]
  /** The turn's closing body (last tool-call-free assistant text after the span). */
  readonly closingText: string
  /** Kept-verbatim seqs: user messages, tail rounds, closing — never in the span. */
  readonly keptSeqs: readonly number[]
}

export interface TurnSpanOptions {
  readonly tailRoundsKept?: number
}

interface Round { readonly start: number; readonly end: number }

/** Close tool rounds over the projected events (open-stack, same shape as the replay harness). */
function closeRounds(events: readonly SurfaceEvent[]): Round[] {
  const rounds: Round[] = []
  let open = 0
  let start = -1
  for (const event of events) {
    const calls = event.type === 'assistant/message' ? event.toolCalls ?? 0 : 0
    if (calls > 0) {
      if (open === 0) start = events.indexOf(event)
      open += calls
      continue
    }
    if (event.type !== 'tool/result') continue
    if (open <= 0) continue
    open -= 1
    if (open === 0 && start >= 0) {
      rounds.push({ start, end: events.indexOf(event) })
      start = -1
    }
  }
  return rounds
}

/** Plan the replacement span for one turn's projected events. */
export function planTurnSpan(events: readonly SurfaceEvent[], options: TurnSpanOptions = {}): TurnSpanPlan {
  const tailRoundsKept = options.tailRoundsKept ?? 1
  const turnEnd = events.find(event => event.type === 'turn/end')
  const completed = turnEnd?.reasonKind === 'completed'
  const body = events.filter(event => event.type !== 'turn/end')
  const keptSeqs: number[] = body.filter(event => event.type === 'user/message').map(event => event.seq)

  const rounds = closeRounds(body)
  // Closing body: last assistant text without tool-calls, after the last closed round.
  const lastRoundEnd = rounds.length > 0 ? (rounds[rounds.length - 1] as Round).end : -1
  let closingText = ''
  let closingIndex = -1
  for (let index = body.length - 1; index > lastRoundEnd; index -= 1) {
    const event = body[index]
    if (event === undefined) continue
    if (event.type === 'assistant/message' && (event.toolCalls ?? 0) === 0 && event.text.trim() !== '') {
      closingText = event.text.trim()
      closingIndex = index
      keptSeqs.push(event.seq)
      break
    }
  }

  // Tail-kept rounds: last `tailRoundsKept` rounds stay verbatim.
  const keptRounds = tailRoundsKept > 0 ? rounds.slice(Math.max(0, rounds.length - tailRoundsKept)) : []
  for (const round of keptRounds) {
    for (let index = round.start; index <= round.end; index += 1) {
      const event = body[index]
      if (event !== undefined) keptSeqs.push(event.seq)
    }
  }

  // Replacement span: from the first replaceable event up to the kept boundary.
  // The closing body is never inside the span (it stays verbatim on the surface).
  const firstIndex = body.findIndex(event => event.type === 'assistant/message' || event.type === 'tool/result')
  const keptStartIndex = keptRounds.length > 0
    ? (keptRounds[0] as Round).start
    : closingIndex >= 0 ? closingIndex : body.length
  const spanEndIndex = Math.max(firstIndex, keptStartIndex) - 1
  const replaceable = firstIndex >= 0 && spanEndIndex >= firstIndex
  const blocks = replaceable ? body.slice(firstIndex, spanEndIndex + 1) : []

  return {
    completed,
    startSeq: replaceable ? (blocks[0] as SurfaceEvent).seq : null,
    endSeq: replaceable ? (blocks[blocks.length - 1] as SurfaceEvent).seq : null,
    blocks,
    closingText,
    keptSeqs,
  }
}

/** Triage every block of a planned span into the frozen TriageResult shape. */
export function triageSpanBlocks(
  plan: TurnSpanPlan,
  rules: readonly LineRule[],
): TriageResult[] {
  return plan.blocks.map(event => {
    const sourceTokens = estimateTokens(event.text)
    if (event.type === 'tool/result') {
      const verdict = blockFailureVerdict(event.text, event.isError === true)
      const poolLines = linePool(event.text, {
        seq: event.seq,
        role: 'tool',
        hardFailure: verdict.hard,
        extraPatterns: rules,
      })
      const mask = manifestFromCall(event.toolName ?? '', event.argsJson ?? '', event.text, event.seq)
        ?? (event.toolName !== undefined && /^(read|read_file|view)$/i.test(event.toolName)
          ? skeletonFromRead(event.text, event.seq)
          : null)
      const residualNarrative = poolLines.length === 0 && mask === null && event.text.trim() !== ''
        ? [{ seq: event.seq, role: 'tool' as const, tokens: sourceTokens, text: event.text }]
        : []
      return { poolLines, ...(mask === null ? {} : { mask }), residualNarrative, sourceTokens }
    }
    // Assistant text inside the span: pool-check it (assertion lines occur here too).
    const verdict = blockFailureVerdict(event.text, false)
    const poolLines = linePool(event.text, {
      seq: event.seq,
      role: 'assistant',
      hardFailure: verdict.hard,
      extraPatterns: rules,
    })
    const residualNarrative = poolLines.length === 0
      ? [{ seq: event.seq, role: 'assistant' as const, tokens: sourceTokens, text: event.text }]
      : []
    return { poolLines, residualNarrative, sourceTokens }
  })
}
