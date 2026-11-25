/**
 * F2: Per-cut index tests.
 *
 * @module dsh-context-compression-improved/tests/runtime/cut-index
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendCut, readCuts, MAX_LINES_PER_SESSION, type CutEntry } from '../../src/runtime/cut-index.ts'

let testDir: string
const SESSION_ID = 'test-session-cut-index'

function makeEntry(overrides: Partial<CutEntry> = {}): CutEntry {
  return {
    ts: new Date().toISOString(),
    sessionId: SESSION_ID,
    strategy: 'small-knife',
    component: 'fresh',
    eventSeqs: [42],
    tokensBefore: 5000,
    tokensAfter: 1200,
    netGain: 3720,
    cacheRecomputeEst: 500,
    cardRef: 'session://test/event/42',
    profile: 'balanced',
    ...overrides,
  }
}

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'cci-cut-test-'))
  // Point DSH_HOME to our test directory
  process.env.DSH_HOME = testDir
})

afterAll(async () => {
  delete process.env.DSH_HOME
  await rm(testDir, { recursive: true, force: true })
})

describe('F2: appendCut + readCuts roundtrip', () => {
  it('appends one entry and reads it back', () => {
    const entry = makeEntry()
    appendCut(entry)
    const result = readCuts(SESSION_ID, { limit: 10 })
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0]!.sessionId).toBe(SESSION_ID)
    expect(result[0]!.strategy).toBe('small-knife')
    expect(result[0]!.netGain).toBe(3720)
  })

  it('reads most recent first (reverse order)', () => {
    appendCut(makeEntry({ netGain: 100 }))
    appendCut(makeEntry({ netGain: 999 }))
    const result = readCuts(SESSION_ID, { limit: 2 })
    expect(result[0]!.netGain).toBe(999) // newest first
  })

  it('filters by strategy', () => {
    appendCut(makeEntry({ strategy: 'big-knife', netGain: 5000 }))
    const big = readCuts(SESSION_ID, { strategy: 'big-knife', limit: 10 })
    expect(big.every(e => e.strategy === 'big-knife')).toBe(true)
  })

  it('limit caps returned entries', () => {
    for (let i = 0; i < 5; i++) appendCut(makeEntry({ netGain: i }))
    const limited = readCuts(SESSION_ID, { limit: 3 })
    expect(limited).toHaveLength(3)
  })

  it('readCuts on nonexistent session returns empty', () => {
    const result = readCuts('nonexistent-session-xyz')
    expect(result).toHaveLength(0)
  })
})

describe('F2: fire-and-forget safety', () => {
  it('appendCut does not throw on bad entry (catches internally)', () => {
    // Should not throw even with weird data
    expect(() => {
      appendCut(makeEntry({ eventSeqs: [] as unknown as number[] }))
    }).not.toThrow()
  })
})

describe('F2: MAX_LINES_PER_SESSION', () => {
  it('is 2000', () => {
    expect(MAX_LINES_PER_SESSION).toBe(2000)
  })
})
