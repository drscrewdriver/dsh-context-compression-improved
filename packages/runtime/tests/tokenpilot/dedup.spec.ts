/**
 * TokenPilot-inspired A1 unit coverage: dedup hashing, canonicalization,
 * table eviction, and pointer placeholder shape.
 */
import { describe, expect, it } from 'vitest'
import {
  DedupeTable,
  canonicalizeForDedupe,
  dedupeHash,
  dedupePlaceholder,
  flattenPlainText,
} from '../../src/tokenpilot/dedup.ts'

describe('tokenpilot dedup helpers', () => {
  it('canonicalizes trim-eol without touching inner content', () => {
    expect(canonicalizeForDedupe('a \n b  \n\n', 'trim-eol')).toBe('a\n b')
    expect(canonicalizeForDedupe('a\nb', 'exact')).toBe('a\nb')
    expect(dedupeHash('a \n', 'trim-eol')).toBe(dedupeHash('a', 'trim-eol'))
    expect(dedupeHash('a \n', 'exact')).not.toBe(dedupeHash('a', 'exact'))
  })

  it('flattens all-text content and rejects rich blocks', () => {
    expect(flattenPlainText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab')
    expect(flattenPlainText([{ type: 'text', text: 'a' }, { type: 'image', source: {} } as never])).toBeUndefined()
  })

  it('records first occurrences, keeps them, and evicts oldest beyond the cap', () => {
    const table = new DedupeTable(2)
    table.record('h1', { seq: 10, sourceRef: 'session://s/event/10', toolName: 'bash', originalChars: 100 })
    expect(table.get('h1')?.seq).toBe(10)
    // Re-recording the same hash never replaces the first occurrence.
    table.record('h1', { seq: 99, sourceRef: 'session://s/event/99', toolName: 'bash', originalChars: 5 })
    expect(table.get('h1')?.seq).toBe(10)
    table.record('h2', { seq: 20, sourceRef: 'session://s/event/20', toolName: 'bash', originalChars: 1 })
    table.record('h3', { seq: 30, sourceRef: 'session://s/event/30', toolName: 'bash', originalChars: 1 })
    // Insertion-order eviction drops h1, the oldest.
    expect(table.get('h1')).toBeUndefined()
    expect(table.get('h2')?.seq).toBe(20)
    expect(table.get('h3')?.seq).toBe(30)
  })

  it('points the placeholder at the first occurrence with a retrieval hint', () => {
    const text = dedupePlaceholder(
      { seq: 10, sourceRef: 'session://s1/event/10', toolName: 'git_status', originalChars: 4096 },
      4096,
    )
    expect(text).toContain('identical to the earlier git_status result')
    expect(text).toContain('session://s1/event/10')
    expect(text).toContain('original_chars=4096')
    expect(text).toContain('context_compression_retrieve')
  })
})
