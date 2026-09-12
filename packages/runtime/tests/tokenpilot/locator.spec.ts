/**
 * TokenPilot-inspired A2 unit coverage: compaction trace resolution, spill and
 * touched-file extraction, and the Exact Sources block shape.
 */
import { describe, expect, it } from 'vitest'
import {
  buildLocatorBlock,
  extractSpillPaths,
  extractTouchedPath,
  findCompactionTrace,
} from '../../src/tokenpilot/locator.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Minimal event literal; the locator only reads seq/type/data fields. */
function event(seq: number, data: Record<string, unknown>): SessionEvent {
  return { seq, type: 'tool/call', data } as unknown as SessionEvent
}

const SHADOWED = { start: 3, end: 9 }

const EVENTS: SessionEvent[] = [
  event(0, {}),
  event(1, {}),
  { seq: 2, type: 'compaction/start', data: { compactionId: 'c1' } } as unknown as SessionEvent,
  event(3, { name: 'read', arguments: '{"path":"src/a.ts"}' }),
  { seq: 4, type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'omitted 100 bytes. Full formatted result stored at: /tmp/spill/a.txt. Use read to restore.' }] } } } as unknown as SessionEvent,
  event(5, { name: 'grep', arguments: '{"path":"src/a.ts"}' }),
  event(6, { name: 'edit', arguments: '{"file_path":"src/a.ts"}' }),
  { seq: 7, type: 'user/message', data: { content: [{ type: 'text', text: 'stored at: /tmp/spill/b.txt' }] } } as unknown as SessionEvent,
  event(8, { name: 'bash', arguments: '{"command":"ls"}' }),
  { seq: 9, type: 'compaction/summary', data: { compactionId: 'c1', shadowedRange: SHADOWED, shadowedTokenCount: 100, provider: 'deepseek', model: 'v4' } } as unknown as SessionEvent,
  { seq: 10, type: 'compaction/end', data: { compactionId: 'c1' } } as unknown as SessionEvent,
]

describe('tokenpilot summary locator helpers', () => {
  it('resolves the latest compaction/summary trace for one compaction id', () => {
    const trace = findCompactionTrace(EVENTS, 'c1')
    expect(trace?.summarySeq).toBe(9)
    expect(trace?.summaryShadowedRange).toEqual(SHADOWED)
    expect(findCompactionTrace(EVENTS, 'unknown')).toBeUndefined()
  })

  it('extracts spill paths, stripping trailing punctuation and deduplicating', () => {
    expect(extractSpillPaths('stored at: /tmp/a.txt. Use read')).toEqual(['/tmp/a.txt'])
    expect(extractSpillPaths('stored at: /tmp/a.txt, stored at: /tmp/a.txt')).toEqual(['/tmp/a.txt', '/tmp/a.txt'])
    expect(extractSpillPaths('nothing here')).toEqual([])
  })

  it('extracts touched paths only from read/grep-style calls', () => {
    expect(extractTouchedPath('read', '{"path":"src/a.ts"}')).toBe('src/a.ts')
    expect(extractTouchedPath('str_replace_editor', '{"file_path":"src/b.ts"}')).toBe('src/b.ts')
    expect(extractTouchedPath('bash', '{"path":"src/a.ts"}')).toBeUndefined()
    expect(extractTouchedPath('read', 'not json')).toBeUndefined()
  })

  it('builds an Exact Sources block over the shadowed range', () => {
    const block = buildLocatorBlock(EVENTS, SHADOWED)
    expect(block).not.toBeNull()
    expect(block?.text).toContain('## Exact Sources (locators)')
    expect(block?.text).toContain('- seq range: 3-9')
    expect(block?.text).toContain('- spill file: /tmp/spill/a.txt')
    expect(block?.text).toContain('- file touched: src/a.ts')
    expect(block?.text).toContain('context_compression_retrieve')
    expect(block?.spillFiles).toBeGreaterThanOrEqual(1)
    expect(block?.touchedFiles).toBeGreaterThanOrEqual(1)
  })

  it('returns null when the range locates nothing concrete', () => {
    const empty: SessionEvent[] = [
      { seq: 0, type: 'compaction/summary', data: { compactionId: 'c1', shadowedRange: { start: 1, end: 2 }, shadowedTokenCount: 1, provider: 'p', model: 'm' } } as unknown as SessionEvent,
      event(1, { name: 'bash', arguments: '{"command":"ls"}' }),
      event(2, {}),
    ]
    expect(buildLocatorBlock(empty, { start: 1, end: 2 })).toBeNull()
  })
})
