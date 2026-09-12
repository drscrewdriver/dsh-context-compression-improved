/**
 * TokenPilot-inspired A1: byte-identical repeated tool-result dedup.
 *
 * Pure helpers behind the ToolResultPruner fresh pass. The per-session table
 * maps a canonical-content SHA-256 to the first surface seq that produced it;
 * later identical results may be replaced with a pointer placeholder that the
 * recovery tool can resolve back to the original full text via the append-only
 * session log. Only hash+seq metadata is stored — never content.
 */
import { createHash } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Canonicalization modes for content hashing. */
export type DedupeNormalization = 'trim-eol' | 'exact'

/** Entry stored per first-seen content hash. */
export interface DedupeTableEntry {
  /** First surface seq carrying this canonical content. */
  readonly seq: number
  /** Session source reference of the first occurrence. */
  readonly sourceRef: string
  /** Tool name of the first occurrence. */
  readonly toolName: string
  /** Original full-text code points of the first occurrence. */
  readonly originalChars: number
}

/** Per-session dedup index with insertion-order eviction. */
export class DedupeTable {
  private readonly entries = new Map<string, DedupeTableEntry>()

  constructor(private readonly maxEntries = 2_048) {}

  /** Look up the first occurrence for one canonical hash, if any. */
  get(hash: string): DedupeTableEntry | undefined {
    return this.entries.get(hash)
  }

  /** Record a first occurrence; existing hashes only refresh insertion order. */
  record(hash: string, entry: DedupeTableEntry): void {
    if (this.entries.has(hash)) return
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    this.entries.set(hash, entry)
  }
}

/** Canonicalize tool-result text for hashing. */
export function canonicalizeForDedupe(text: string, mode: DedupeNormalization): string {
  if (mode === 'exact') return text
  return text
    .replace(/[ \t]+\r?\n/g, '\n')
    .replace(/(^\s+)|(\s+$)/g, '')
}

/** SHA-256 hex of the canonicalized text. */
export function dedupeHash(text: string, mode: DedupeNormalization): string {
  return createHash('sha256').update(canonicalizeForDedupe(text, mode), 'utf8').digest('hex')
}

/** Concatenated text of an all-text content block list; null when rich. */
export function flattenPlainText(content: readonly ContentBlock[]): string | undefined {
  let text = ''
  for (const block of content) {
    if (block.type !== 'text') return undefined
    text += block.text
  }
  return text
}

/** Pointer placeholder pointing at the first occurrence's original event. */
export function dedupePlaceholder(entry: DedupeTableEntry, originalChars: number): string {
  return [
    `[... identical to the earlier ${entry.toolName} result; first seen at ${entry.sourceRef};`,
    `original_chars=${String(originalChars)};`,
    'use context_compression_retrieve with this source if the omitted evidence is necessary.]',
  ].join(' ')
}
