/**
 * Turn-tail intent summary: pending-fold types and pure block builders
 * (task_2.4/2.5). The pass orchestration lives in the pruner (it owns the
 * channel, gate inputs, and landing machinery); this module owns the data
 * contract and the deterministic intent-block rendering. The model writes
 * ONLY the summary segment — block rendering here is fully deterministic.
 */
import type { IntentRole } from './intent-input-mask.ts'

/** One staged fold awaiting the next pressure round. */
export interface PendingIntentFold {
  readonly createdAt: number
  readonly turn: number
  /** Inclusive seq span of the folded candidates. */
  readonly startSeq: number
  readonly endSeq: number
  /** LLM-written summary segment (fail-open parsed, char-capped). */
  readonly summary: string
  /** Verbatim error lines collected across the batch (never LLM-revoiced). */
  readonly errorLines: readonly string[]
  /** Per-candidate faces: read-mask single lines ride the block, keep-class lines prompt-only. */
  readonly records: ReadonlyArray<{ readonly seq: number, readonly role: IntentRole, readonly toolName: string, readonly line: string }>
  /** Characters consumed by the summary-writer call (credit accounting). */
  readonly summaryCallChars: number
}

/** Marker written into every folded block; its presence makes a seq unfoldable again (fold-once). */
export const INTENT_FOLD_MARKER = '[Intent summary'

/** Render the replacement text for one folded candidate. Pure. */
export function renderIntentFoldBlock(pending: PendingIntentFold, seq: number): string {
  const start = pending.startSeq
  const end = pending.endSeq
  if (seq === start) {
    const readLines = pending.records
      .filter(record => record.role === 'read-mask')
      .map(record => record.line)
    const consulted = readLines.length > 0 ? `Consulted: ${readLines.join('; ')}` : ''
    const errorBlock = pending.errorLines.length > 0
      ? `\nError lines (verbatim):\n${pending.errorLines.join('\n')}`
      : ''
    return [
      `${INTENT_FOLD_MARKER} of folded tool results seq ${start}..${end}]`,
      pending.summary,
      consulted,
      errorBlock,
      '[Original content remains in the session log at the listed seq values.]',
    ].filter(part => part.length > 0).join('\n')
  }
  const record = pending.records.find(entry => entry.seq === seq)
  const face = record === undefined ? `${seq}` : record.role === 'read-mask' ? record.line : `${record.toolName} result folded into the batch intent summary`
  return `${INTENT_FOLD_MARKER} folded into the batch summary above (seq ${start}..${end})] ${face}`
}
