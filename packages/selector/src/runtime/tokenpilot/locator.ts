/**
 * TokenPilot-inspired A2: Exact Sources locator block appended to the Auto
 * Compact summary checkpoint AFTER compaction/end.
 *
 * The block carries three kinds of locators over the shadowed range — the seq
 * range itself, spill files named by the Harness spill notices, and files
 * touched by read/grep-style tool calls — so details removed by the LLM
 * summary remain recoverable through ordinary file reads, the recovery tool,
 * or session event references. The block is only a few hundred bytes and is
 * skipped entirely when it would locate nothing concrete.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** One resolved compaction transaction to annotate. */
export interface CompactionTrace {
  readonly compactionId: string
  readonly summarySeq: number
  readonly summaryShadowedRange: { readonly start: number, readonly end: number }
}

/** Files touched by read/grep-style tool calls inside the range. */
const TOUCHED_FILE_TOOL = /(?:^|[-_])?(?:read|write|edit|glob|grep|view|str_replace_editor)(?:$|[-_])/i
/** Spill notice paths emitted by the Harness output-retention policy. */
const SPILL_PATH = /stored at:\s*([^\s)\]]+)/g
/** Tool call arguments keys that commonly carry a file path. */
const PATH_KEYS = ['path', 'file_path'] as const

/**
 * Find the latest compaction/summary event matching the compaction id of a
 * compaction/end event. Returns undefined when the transaction cannot be
 * identified — the caller must skip rather than guess.
 */
export function findCompactionTrace(
  events: readonly SessionEvent[],
  compactionId: string,
): CompactionTrace | undefined {
  let trace: CompactionTrace | undefined
  for (const event of events) {
    if (event.type === 'compaction/summary' && event.data.compactionId === compactionId) {
      trace = {
        compactionId,
        summarySeq: event.seq,
        summaryShadowedRange: event.data.shadowedRange,
      }
    }
  }
  return trace
}

/** Extract spill file paths from one text chunk. */
export function extractSpillPaths(text: string): string[] {
  const paths: string[] = []
  for (const match of text.matchAll(SPILL_PATH)) {
    const path = match[1]?.replace(/[.,;]+$/, '')
    if (path !== undefined && path.length > 0) paths.push(path)
  }
  return paths
}

/** Extract touched file paths from one tool/call event's arguments. */
export function extractTouchedPath(name: string, argumentsText: string): string | undefined {
  if (!TOUCHED_FILE_TOOL.test(name)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsText)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  for (const key of PATH_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** Result of one locator block build: text plus locator census for auditing. */
export interface LocatorBlock {
  readonly text: string
  readonly spillFiles: number
  readonly touchedFiles: number
}

/**
 * Build the Exact Sources block for one shadowed range, or null when the
 * range locates nothing concrete (no spill files and no touched files).
 */
export function buildLocatorBlock(
  events: readonly SessionEvent[],
  shadowedRange: { readonly start: number, readonly end: number },
): LocatorBlock | null {
  const spillFiles = new Set<string>()
  const touchedFiles = new Set<string>()
  for (let seq = shadowedRange.start; seq <= shadowedRange.end && seq < events.length; seq += 1) {
    const event = events[seq]
    if (event === undefined) continue
    if (event.type === 'tool/call') {
      const path = extractTouchedPath(event.data.name, event.data.arguments)
      if (path !== undefined) touchedFiles.add(path)
      continue
    }
    if (event.type === 'tool/result' || event.type === 'user/message') {
      // tool/result nests content under data.message; user/message carries it directly.
      const data = event.data as { content?: unknown, message?: { content?: unknown } }
      const content = Array.isArray(data.content) ? data.content : data.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === 'text') {
          for (const path of extractSpillPaths(block.text)) spillFiles.add(path)
        }
      }
    }
  }
  if (spillFiles.size === 0 && touchedFiles.size === 0) return null
  const lines = [
    '## Exact Sources (locators)',
    `- seq range: ${String(shadowedRange.start)}-${String(shadowedRange.end)}`,
    ...[...spillFiles].map(path => `- spill file: ${path}`),
    ...[...touchedFiles].map(path => `- file touched: ${path}`),
    '(Use `read <spill file>` or `context_compression_retrieve` with a `session://` source to restore exact text.)',
  ]
  return {
    text: lines.join('\n'),
    spillFiles: spillFiles.size,
    touchedFiles: touchedFiles.size,
  }
}
