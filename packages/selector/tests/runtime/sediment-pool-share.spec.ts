/**
 * T1.6 pool-share guard: over a sampled fixture corpus copied from the real
 * replay cuts (trial-3 source data), the verbatim pool must stay a tiny
 * fraction of total bytes — the "0.4% of tokens buys 100% error recall"
 * property. Sampled subset uses a generous 2% ceiling; the full-corpus 0.5%
 * gate lives in the S5 script run at Phase 5.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { linePool } from '../../src/runtime/triage/signals.ts'
import type { TriageRole } from '../../src/runtime/triage/types.ts'

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/sediment-pool', import.meta.url))

/** Split a cut fixture into `[role] body` segments (replay dump format). */
function segments(text: string): Array<{ role: TriageRole; body: string }> {
  return text.split('\n===\n').map(chunk => {
    const match = /^\[(\w+)\] ([\s\S]*)$/.exec(chunk)
    if (match === null) return { role: 'tool' as const, body: chunk }
    const role = match[1]
    return {
      role: role === 'user' || role === 'assistant' || role === 'tool' ? role : 'tool',
      body: match[2],
    }
  })
}

describe('pool share over real-cut fixtures (T1.6)', () => {
  const files = readdirSync(FIXTURE_DIR).filter(name => name.endsWith('.orig.txt'))

  it('fixture corpus is present and non-trivial', () => {
    expect(files.length).toBeGreaterThanOrEqual(10)
  })

  it('verbatim pool stays under 2% of corpus bytes (sampled ceiling; S5 guards 0.5% full)', () => {
    let totalChars = 0
    let poolChars = 0
    let poolLines = 0
    for (const name of files) {
      const raw = readFileSync(`${FIXTURE_DIR}/${name}`, 'utf8')
      for (const [index, seg] of segments(raw).entries()) {
        totalChars += seg.body.length
        const pool = linePool(seg.body, { seq: index, role: seg.role, hardFailure: false })
        poolLines += pool.length
        poolChars += pool.reduce((sum, line) => sum + line.text.length, 0)
      }
    }
    // Every pool line must be a substring of its source segment (copy, never paraphrase).
    expect(poolChars / Math.max(1, totalChars)).toBeLessThanOrEqual(0.02)
    expect(poolLines).toBeGreaterThan(0) // corpus does contain failure signals
  })

  it('every pooled line is verbatim-contained in its source segment', () => {
    for (const name of files) {
      const raw = readFileSync(`${FIXTURE_DIR}/${name}`, 'utf8')
      for (const [index, seg] of segments(raw).entries()) {
        for (const line of linePool(seg.body, { seq: index, role: seg.role, hardFailure: false })) {
          const body = line.text.replace(/ …$/, '')
          expect(seg.body.includes(body)).toBe(true)
        }
      }
    }
  })
})
