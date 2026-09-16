/**
 * Pure content-analysis functions extracted from ToolResultPruner.
 *
 * Every function here has ZERO `this` dependency — they receive all inputs
 * as explicit arguments. Grouped by natural cohesion (content blocks →
 * token counting → recovery helpers).
 *
 * @module dsh-context-compression-improved/pruner/content
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {
  CompactionTokenView,
  ProviderMeasurementKey,
  TokenCount,
} from '../runtime/measurement.ts'
import { countExactCanonicalTextFields } from '../runtime/token-count.ts'
import { codePointLength, PRUNE_MARKER } from '../runtime/config.ts'
import type { PrunedEntry, PruneResult } from '../runtime/types.ts'
import { RICH_BLOCK_PRESSURE_COST } from './tuning.ts'

// ── Content-block predicates ────────────────────────────────────────────

function onlyTextBlock(blocks: readonly ContentBlock[]): Extract<ContentBlock, { type: 'text' }> | null {
  return blocks.length === 1 && blocks[0]?.type === 'text' ? blocks[0] : null
}

function onlyTextBlocks(blocks: readonly ContentBlock[]): readonly Extract<ContentBlock, { type: 'text' }>[] | null {
  return blocks.every((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    ? blocks
    : null
}

// ── Token counting ──────────────────────────────────────────────────────

function countToolContent(blocks: readonly ContentBlock[], view: CompactionTokenView): TokenCount {
  const text = onlyTextBlocks(blocks)
  if (text === null) return unavailableCount('tool result contains unsupported rich content')
  return countExactCanonicalTextFields(
    text.map(block => block.text),
    candidate => view.countCanonicalText(candidate),
    'tool result replacement',
  )
}

function exactTokens(count: TokenCount): number | undefined {
  return count.kind === 'exact-tokenizer' ? count.tokens : undefined
}

// ── Provider measurement key comparison ─────────────────────────────────

function sameProviderMeasurementKey(
  left: Readonly<ProviderMeasurementKey>,
  right: Readonly<ProviderMeasurementKey>,
): boolean {
  return left.provider === right.provider
    && left.baseUrlClass === right.baseUrlClass
    && left.apiRoute === right.apiRoute
    && left.modelId === right.modelId
    && left.requestTemplateRevision === right.requestTemplateRevision
    && left.tokenizerRevision === right.tokenizerRevision
    && left.modality === right.modality
}

// ── Token helpers ───────────────────────────────────────────────────────

function unavailableCount(reason: string): TokenCount {
  return Object.freeze({ kind: 'unavailable', reason })
}

// ── Recovery markers ────────────────────────────────────────────────────

function recoveryMarker(sourceRef: string, label: string): string {
  return `\n\n[... ${label}; source=${sourceRef}; use context_compression_retrieve if needed ...]\n\n`
}

// ── Content measurement ─────────────────────────────────────────────────

/**
 * Measure text content in Unicode code points; non-text blocks cost zero.
 * @param blocks - tool-result content to measure.
 * @returns total Unicode code points across text blocks.
 */
function measureContent(blocks: readonly ContentBlock[]): number {
  let chars = 0
  for (const block of blocks) {
    if (block.type === 'text') chars += codePointLength(block.text)
  }
  return chars
}

function pressureCost(blocks: readonly ContentBlock[]): number {
  let cost = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        cost += codePointLength(block.text)
        break
      case 'tool-call':
        cost += RICH_BLOCK_PRESSURE_COST
          + codePointLength(block.name)
          + codePointLength(block.arguments)
        break
      case 'tool-result':
        cost += RICH_BLOCK_PRESSURE_COST + pressureCost(block.content)
        break
      default: {
        // ContentBlockMap is merge-extensible. Unknown model-visible blocks
        // scale with their durable JSON payload instead of receiving a fixed
        // token that a large provider block could bypass.
        const serialized = JSON.stringify(block)
        cost += Math.max(RICH_BLOCK_PRESSURE_COST, codePointLength(serialized))
      }
    }
  }
  return cost
}

// ── Native content pruning ──────────────────────────────────────────────

function nativePruneContent(
  blocks: readonly ContentBlock[],
  thresholdChars: number,
  headChars: number,
  tailChars: number,
  marker: string = PRUNE_MARKER,
): ContentBlock[] | null {
  const totalChars = measureContent(blocks)
  if (totalChars <= thresholdChars) return null
  const markerChars = codePointLength(marker)
  const safeHead = Math.max(0, Math.min(headChars, thresholdChars - markerChars))
  const safeTail = Math.max(0, Math.min(tailChars, thresholdChars - markerChars - safeHead))
  const removedStart = safeHead
  const removedEnd = totalChars - safeTail
  const pruned: ContentBlock[] = []
  let consumed = 0
  let markerInserted = false
  for (const block of blocks) {
    if (block.type !== 'text') {
      pruned.push(block)
      continue
    }
    const points = Array.from(block.text)
    const blockStart = consumed
    const blockEnd = blockStart + points.length
    const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart))
    const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart))
    const intersectsRemoved = blockStart < removedEnd && blockEnd > removedStart
    const insertion = intersectsRemoved && !markerInserted ? marker : ''
    if (insertion !== '') markerInserted = true
    const text = points.slice(0, headEnd).join('') + insertion + points.slice(tailStart).join('')
    if (text !== '') pruned.push({ ...block, text })
    consumed = blockEnd
  }
  if (!markerInserted) return null
  const charsAfter = measureContent(pruned)
  return charsAfter <= thresholdChars && charsAfter < totalChars ? pruned : null
}

// ── Result aggregation ──────────────────────────────────────────────────

function summarize(entries: readonly PrunedEntry[]): PruneResult {
  return {
    pruned: entries,
    charsRemoved: entries.reduce((sum, entry) => sum + entry.charsBefore - entry.charsAfter, 0),
    tokensRemoved: entries.reduce((sum, entry) => sum + entry.tokensBefore - entry.tokensAfter, 0),
  }
}

function emptyResult(): PruneResult {
  return { pruned: [], charsRemoved: 0, tokensRemoved: 0 }
}

export {
  onlyTextBlock,
  onlyTextBlocks,
  countToolContent,
  exactTokens,
  sameProviderMeasurementKey,
  unavailableCount,
  recoveryMarker,
  summarize,
  emptyResult,
  measureContent,
  pressureCost,
  nativePruneContent,
}
