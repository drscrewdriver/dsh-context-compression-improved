import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  classifyIntentRole,
  extractErrorLines,
  extractTarget,
  maskCandidateForSummary,
} from '../../src/runtime/tokenpilot/intent-input-mask.ts'
import { computeIntentRange, INTENT_RANGE_MAX_CANDIDATES } from '../../src/runtime/tokenpilot/intent-range.ts'
import { INTENT_FOLD_MARKER, renderIntentFoldBlock, type PendingIntentFold } from '../../src/runtime/tokenpilot/intent-fold.ts'
import { buildIntentSummarySystemPrompt, buildIntentSummaryUserPrompt, parseIntentSummaryAnswer } from '../../src/runtime/tokenpilot/advisor-prompt.ts'
import type { SnapshotCandidate } from '../../src/pruner/types.ts'

describe('intent input mask roles (toolclass reuse)', () => {
  it('read/search/path-listing classes mask to a single line', () => {
    expect(classifyIntentRole('read_file', '', 'x'.repeat(100))).toBe('read-mask')
    expect(classifyIntentRole('grep', '', 'x'.repeat(100))).toBe('read-mask')
    expect(classifyIntentRole('glob', '', 'x'.repeat(100))).toBe('read-mask')
  })

  it('toolclass fixed edges do not regress: mcp generic, web_search not search, execute_sql not shell', () => {
    // generic → conservative (never a blind read-mask)
    expect(classifyIntentRole('mcp', '', 'x')).toBe('conservative')
    // search-shaped names that toolclass deliberately refuses → conservative
    expect(classifyIntentRole('web_search', '', 'x'.repeat(50))).toBe('conservative')
    expect(classifyIntentRole('memory_search', '', 'x'.repeat(50))).toBe('conservative')
    expect(classifyIntentRole('execute_sql', '', 'x'.repeat(50))).toBe('conservative')
  })

  it('write layer wins before the shared classifier', () => {
    expect(classifyIntentRole('edit', '', 'x')).toBe('write-keep')
    expect(classifyIntentRole('multi_edit', '', 'x')).toBe('write-keep')
    expect(classifyIntentRole('apply_patch', '', 'x')).toBe('write-keep')
    expect(classifyIntentRole('page-write', '', 'x')).toBe('write-keep')
  })

  it('read-mask record contains zero body lines, only target and scale', () => {
    const body = 'SECRET_LINE_ONE\nSECRET_LINE_TWO\nSECRET_LINE_THREE'
    const masked = maskCandidateForSummary(7, 'read_file', '{"path":"src/a.ts"}', body)
    expect(masked.role).toBe('read-mask')
    expect(masked.record).toContain('src/a.ts')
    expect(masked.record).toContain('3 lines')
    expect(masked.record).not.toContain('SECRET')
  })

  it('extractTarget picks path/query/url-ish arguments', () => {
    expect(extractTarget('{"path":"a/b.ts"}')).toBe('a/b.ts')
    expect(extractTarget('{"query":"compile error"}')).toBe('compile error')
    expect(extractTarget('not json')).toBe('(unparsed target)')
  })

  it('extractErrorLines collects verbatim error lines, capped', () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i} Error ${i === 5 ? 'boom' : ''}`).join('\n')
    const lines = extractErrorLines(text)
    expect(lines.length).toBeLessThanOrEqual(10)
    expect(lines.some(line => line.includes('boom'))).toBe(true)
  })
})

describe('intent fold range selection', () => {
  const candidate = (seq: number): SnapshotCandidate => ({ seq } as SnapshotCandidate)

  it('excludes protected and folded seqs, orders oldest-first, caps the batch', () => {
    const candidates = [candidate(30), candidate(10), candidate(20), candidate(40)]
    const out = computeIntentRange({
      candidates,
      protectedSeqs: new Set([20]),
      foldedSeqs: new Set([40]),
      maxCandidates: INTENT_RANGE_MAX_CANDIDATES,
    })
    expect(out.seqs).toEqual([10, 30])
    expect(out.skippedProtected).toBe(1)
    expect(out.skippedFolded).toBe(1)
  })

  it('caps at maxCandidates keeping the oldest', () => {
    const candidates = Array.from({ length: 30 }, (_, i) => candidate(i + 1))
    const out = computeIntentRange({ candidates, protectedSeqs: new Set(), foldedSeqs: new Set(), maxCandidates: 5 })
    expect(out.seqs).toEqual([1, 2, 3, 4, 5])
  })
})

describe('intent fold block rendering', () => {
  const pending: PendingIntentFold = {
    createdAt: 1,
    turn: 3,
    startSeq: 10,
    endSeq: 12,
    summary: 'Explored the auth module; token refresh path identified.',
    errorLines: ['Error: EACCES at /var/log'],
    records: [
      { seq: 10, role: 'read-mask', toolName: 'read_file', line: 'read_file src/auth.ts -> masked (200 lines / 4000 chars)' },
      { seq: 11, role: 'write-keep', toolName: 'edit', line: 'edit (seq 11)\nhead' },
      { seq: 12, role: 'read-mask', toolName: 'grep', line: 'grep refresh -> masked (5 lines / 90 chars)' },
    ],
    summaryCallChars: 320,
  }

  it('first block carries the summary, consulted list, verbatim error lines and provenance', () => {
    const block = renderIntentFoldBlock(pending, 10)
    expect(block).toContain(INTENT_FOLD_MARKER)
    expect(block).toContain('seq 10..12')
    expect(block).toContain(pending.summary)
    expect(block).toContain('read_file src/auth.ts -> masked')
    expect(block).toContain('Error: EACCES at /var/log')
    expect(block).toContain('session log')
  })

  it('subsequent blocks point at the batch summary and carry their mask line', () => {
    const block = renderIntentFoldBlock(pending, 12)
    expect(block).toContain('folded into the batch summary above')
    expect(block).toContain('grep refresh -> masked')
    expect(block).not.toContain('Explored the auth module')
  })
})

describe('intent summary writer prompts', () => {
  it('system prompt pins the JSON contract and cap', () => {
    const system = buildIntentSummarySystemPrompt()
    expect(system).toContain('"summary"')
    expect(system).toContain('Never')
  })

  it('user prompt packs task, records and tail', () => {
    const user = buildIntentSummaryUserPrompt('fix login', ['read_file a.ts -> masked (1 lines / 10 chars)'], 'tail text')
    expect(user).toContain('task: fix login')
    expect(user).toContain('read_file a.ts -> masked')
    expect(user).toContain('recent tail:')
  })

  it('parse is fail-open and caps oversized summaries', () => {
    expect(parseIntentSummaryAnswer('chatter {"summary":"did stuff"} trailing')).toEqual({ summary: 'did stuff' })
    expect(parseIntentSummaryAnswer('no json')).toBeUndefined()
    expect(parseIntentSummaryAnswer('{"summary":""}')).toBeUndefined()
    const big = 'x'.repeat(10_000)
    expect(parseIntentSummaryAnswer(`{"summary":"${big}"}`)).toBeUndefined()
  })
})

describe('fold-once marker discipline', () => {
  it('marker is stable and used by renderIntentFoldBlock on every block', () => {
    const pending: PendingIntentFold = {
      createdAt: 1, turn: 1, startSeq: 1, endSeq: 2, summary: 's', errorLines: [],
      records: [
        { seq: 1, role: 'read-mask', toolName: 'read_file', line: 'r' },
        { seq: 2, role: 'conservative', toolName: 'bash', line: 'b' },
      ],
      summaryCallChars: 10,
    }
    const source = readFileSync(fileURLToPath(new URL('../../src/pruner.ts', import.meta.url)), 'utf8')
    expect(source.includes('INTENT_FOLD_MARKER')).toBe(true)
    expect(renderIntentFoldBlock(pending, 1)).toContain(INTENT_FOLD_MARKER)
    expect(renderIntentFoldBlock(pending, 2)).toContain(INTENT_FOLD_MARKER)
  })
})
