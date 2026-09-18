import { describe, expect, it } from 'vitest'
import { reduceFreshToolResult } from '../../src/runtime/reducers.ts'

const SOURCE_REF = 'session://s1/event/7'

function searchInput(text: string, budgetChars = 16_000): Parameters<typeof reduceFreshToolResult>[0] {
  return {
    toolName: 'grep_search',
    argumentsText: '{"pattern":"config"}',
    text,
    budgetChars,
    sourceRef: SOURCE_REF,
    isError: false,
  }
}

describe('search L1 locator (R10)', () => {
  it('reports the complete line-number set for a 592-hit file (count == hits)', () => {
    // 实测 upper bound: one real session had a 592-hit file; the old reducer
    // reported only "(592 matches)" and dropped every line number (21.2% of
    // all hits across sessions were silently unlocatable).
    const lines = Array.from({ length: 592 }, (_, i) =>
      `src/deep/module.ts:${String(i + 1)}: export const config${String(i)} = configure(${String(i)})`)
    const output = reduceFreshToolResult(searchInput(lines.join('\n')))
    expect(output).not.toBeNull()
    const locator = output!.text.split('\n').find(line => line.startsWith('## src/deep/module.ts'))
    expect(locator).toBeDefined()
    const numbers = [...locator!.matchAll(/L(\d+)/g)].map(match => Number(match[1]))
    expect(numbers).toHaveLength(592)
    expect(numbers[0]).toBe(1)
    expect(numbers[591]).toBe(592)
  })

  it('keeps L1 free of content rows (pure locator)', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `a.ts:${String(i + 1)}: content row ${String(i)}`)
    const output = reduceFreshToolResult(searchInput(lines.join('\n'), 700))
    expect(output).not.toBeNull()
    const locatorLine = output!.text.split('\n').find(line => line.startsWith('## a.ts'))
    expect(locatorLine).toBeDefined()
    expect(locatorLine).not.toContain('content row')
  })

  it('announces withheld locators visibly instead of silently truncating', () => {
    // Budget too small for the full L1 set: the header must state how much
    // was withheld rather than quietly shrinking the list.
    const lines = [
      ...Array.from({ length: 300 }, (_, i) => `big.ts:${String(i + 1)}: hit ${String(i)}`),
      ...Array.from({ length: 5 }, (_, i) => `small.ts:${String(i + 1)}: hit ${String(i)}`),
    ].join('\n')
    const output = reduceFreshToolResult(searchInput(lines, 900))
    expect(output).not.toBeNull()
    expect(output!.text).toMatch(/withheld|more (?:files|matches)/i)
  })
})

describe('search L2 water-filling (R10)', () => {
  it('serves every file one round before any file takes a second row', () => {
    const fat = Array.from({ length: 500 }, (_, i) => `fat.ts:${String(i + 1)}: fat file row ${String(i)}`)
    const mid = Array.from({ length: 10 }, (_, i) => `mid.ts:${String(i + 1)}: mid file row ${String(i)}`)
    const thin = Array.from({ length: 5 }, (_, i) => `thin.ts:${String(i + 1)}: thin file row ${String(i)}`)
    // Tight content quota: only ~15 rows fit after L1. Round-robin must give
    // each file a row per round — the old "fill from index 0" let the first
    // file eat the whole quota.
    const output = reduceFreshToolResult(searchInput([...fat, ...mid, ...thin].join('\n'), 1_600))
    expect(output).not.toBeNull()
    const counts = new Map<string, number>()
    for (const line of output!.text.split('\n')) {
      const match = /^(fat|mid|thin)\.ts:\d+:/.exec(line)
      if (match !== null) counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1)
    }
    expect(counts.get('fat')!).toBeGreaterThan(0)
    expect(counts.get('mid')!).toBeGreaterThan(0)
    expect(counts.get('thin')!).toBeGreaterThan(0)
  })

  it('exhausts small files before the big file takes the remaining quota', () => {
    const fat = Array.from({ length: 500 }, (_, i) => `fat.ts:${String(i + 1)}: fat file row ${String(i)}`)
    const mid = Array.from({ length: 10 }, (_, i) => `mid.ts:${String(i + 1)}: mid file row ${String(i)}`)
    const thin = Array.from({ length: 5 }, (_, i) => `thin.ts:${String(i + 1)}: thin file row ${String(i)}`)
    // Generous quota after L1: mid and thin end up FULLY covered (100% of
    // their rows) while fat takes only what is left.
    const output = reduceFreshToolResult(searchInput([...fat, ...mid, ...thin].join('\n'), 6_000))
    const counts = new Map<string, number>()
    for (const line of output!.text.split('\n')) {
      const match = /^(fat|mid|thin)\.ts:\d+:/.exec(line)
      if (match !== null) counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1)
    }
    expect(counts.get('thin')).toBe(5)
    expect(counts.get('mid')).toBe(10)
    expect(counts.get('fat')!).toBeGreaterThan(0)
  })

  it('keeps error rows available to the quota', () => {
    const rows = Array.from({ length: 40 }, (_, i) => `app.ts:${String(i + 1)}: ordinary row ${String(i)}`)
    rows.push('app.ts:99: FATAL: unhandled rejection in loader')
    // Tight quota: round 0 must reach the important row (offered first within
    // the file) even though 40 ordinary rows outrank it by line number.
    const output = reduceFreshToolResult(searchInput(rows.join('\n'), 900))
    expect(output).not.toBeNull()
    expect(output!.text).toContain('FATAL: unhandled rejection in loader')
  })

  it('falls back to salience when no path:line form exists', () => {
    const output = reduceFreshToolResult(searchInput([
      ...Array.from({ length: 60 }, (_, i) => `ordinary output line ${String(i)} without any locators at all`),
      'FATAL: something exploded without a path prefix',
    ].join('\n'), 1_200))
    expect(output?.reducer).toBe('search-salience')
  })
})
