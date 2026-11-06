/**
 * Sediment publication (plan cci-sedimentation-triage, Phase 3, T3.5/T3.6).
 *
 * The commit transaction mirrors the proven TailTrim publication shape
 * (pruner.ts L2386-2406): a `compaction/prune` manifest event, then ONE
 * `user/message` replacement carrying `surfaceOp: replace` and
 * `sourceEventSeqs`, through the generation-gated message builder so 0.1.x
 * and 0.2.x hosts accept the same code path. The shortening proof (M7) runs
 * BEFORE any append — a card that does not shrink the span is refused, and
 * nothing half-committed can exist.
 *
 * The session is injected as a minimal interface so the transaction is
 * unit-testable without a host; the wiring site passes the real session.
 */
import { tailTrimMessage } from './tail-trim.ts'
import { renderTurnCard } from './sediment-card.ts'
import type { TurnCardDraft } from './triage/types.ts'

export interface PublishTarget {
  append(type: 'compaction/prune', data: Record<string, unknown>): { seq: number }
  append(type: 'user/message', message: unknown, options?: Record<string, unknown>): { seq: number }
}

export interface PublishResult {
  readonly ok: boolean
  readonly reason: string
  readonly manifestSeq?: number
  readonly replacementSeq?: number
}

export interface PublishSpan {
  readonly startSeq: number
  readonly endSeq: number
  readonly shadowedSeqs: readonly number[]
}

/** Commit one card over the span. Never throws; every failure is a reason code. */
export function publishSettledCard(
  session: PublishTarget,
  draft: TurnCardDraft,
  span: PublishSpan,
): PublishResult {
  if (draft.retainedTokens >= draft.sourceTokens) {
    return { ok: false, reason: `shortening-proof-failed:${draft.retainedTokens}>=${draft.sourceTokens}` }
  }
  if (span.shadowedSeqs.length === 0) {
    return { ok: false, reason: 'empty-span' }
  }
  const manifest = session.append('compaction/prune', {
    shadowedRange: { start: span.startSeq, end: span.endSeq },
    shadowedSeqs: [...span.shadowedSeqs],
    shadowedTokenCount: draft.sourceTokens,
  })
  let replacementSeq: number
  try {
    const message = tailTrimMessage(renderTurnCard(draft))
    replacementSeq = session.append('user/message', message, {
      surfaceOp: { op: 'replace', startSeq: span.startSeq, endSeq: span.endSeq },
      sourceEventSeqs: [manifest.seq, ...span.shadowedSeqs],
    }).seq
  } catch (error) {
    // The manifest stands alone (same tolerated state as TailTrim publication
    // failure: an append without replacement is inert on the surface).
    return { ok: false, reason: `publication-failed:${error instanceof Error ? error.message : String(error)}`, manifestSeq: manifest.seq }
  }
  return { ok: true, reason: 'landed', manifestSeq: manifest.seq, replacementSeq }
}

/**
 * Rewrite guard (T3.3 accounting, findings F2 community 1:15 evidence):
 * a cut may only land when its saving clears the estimated cached-tail
 * rewrite cost by the configured ratio. Pure function over token counts.
 */
export function passesRewriteGuard(
  draft: TurnCardDraft,
  rewriteTailTokens: number,
  ratio: number,
): boolean {
  const saving = draft.sourceTokens - draft.retainedTokens
  return saving > 0 && saving >= rewriteTailTokens * ratio
}

/**
 * Project a host session event into the minimal `SurfaceEvent` the span
 * planner consumes. Kept separate from the planner so the planner stays
 * host-type-free; the wiring site supplies the call-id → name/args map.
 */
export function projectSurfaceEvent(
  seq: number,
  event: {
    type: string
    data?: {
      message?: { content?: unknown; toolCallId?: string; isError?: boolean }
      content?: unknown
      reason?: { kind?: string }
    }
  },
  callInfo: { name: string; argsJson: string } | undefined,
): import('./sediment-span.ts').SurfaceEvent | null {
  const text = flattenText(event.data?.message?.content ?? event.data?.content)
  switch (event.type) {
    case 'user/message':
      return { seq, type: 'user/message', text }
    case 'assistant/message': {
      const toolCalls = countToolCallBlocks(event.data?.message?.content)
      return { seq, type: 'assistant/message', text: stripToolCallBlocks(text), toolCalls }
    }
    case 'tool/result':
      return {
        seq,
        type: 'tool/result',
        text,
        ...(callInfo === undefined ? {} : { toolName: callInfo.name, argsJson: callInfo.argsJson }),
        isError: event.data?.message?.isError === true,
      }
    case 'turn/end': {
      const reasonKind = event.data?.reason?.kind
      return { seq, type: 'turn/end', text: '', ...(reasonKind === undefined ? {} : { reasonKind }) }
    }
    default:
      return null
  }
}

function blockText(block: unknown): string {
  if (block === null || typeof block !== 'object') return ''
  const record = block as Record<string, unknown>
  return typeof record.text === 'string' ? record.text : ''
}

function flattenText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(blockText).filter(entry => entry !== '').join('\n')
  return ''
}

function countToolCallBlocks(content: unknown): number {
  if (!Array.isArray(content)) return 0
  return content.filter(block => (block as Record<string, unknown> | null)?.type === 'tool-call').length
}

function stripToolCallBlocks(text: string): string {
  return text // blocks already filtered by blockText (tool-call blocks carry no .text)
}
