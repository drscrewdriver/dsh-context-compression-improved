import { describe, expect, it } from 'vitest'
import { normalizeTerminalLines, normalizeTerminalText } from '../../src/runtime/reducers.ts'

describe('non-adjacent frequency folding (R11)', () => {
  it('folds a line repeated 400 times but separated into first + one counted marker', () => {
    // The adjacent fold only collapses CONSECUTIVE runs (0.03-0.32% of real
    // duplicate content); separated repeats grew to 8.37% in large results.
    const lines: string[] = ['start']
    for (let index = 0; index < 400; index++) {
      lines.push('same polling line', `interleaved ${String(index)}`)
    }
    lines.push('end')
    const folded = normalizeTerminalLines(lines.join('\n')).folded
    const texts = folded.map(line => line.text)
    const sameCount = texts.filter(text => text === 'same polling line').length
    expect(sameCount).toBe(1)
    const marker = texts.find(text => text.startsWith('[×') && text.includes('same as line 2'))
    expect(marker).toBeDefined()
    expect(marker).toMatch(/\[× 400 total/)
    // The marker cites the original-event lines it covers.
    expect(marker).toMatch(/original lines? \d+/)
    expect(texts[0]).toBe('start')
    expect(texts.at(-1)).toBe('end')
  })

  it('leaves pairs alone (below the fold threshold)', () => {
    const folded = normalizeTerminalLines(['a', 'b', 'a', 'c'].join('\n')).folded
    expect(folded.map(line => line.text)).toEqual(['a', 'b', 'a', 'c'])
  })

  it('counter-proof: pure consecutive repeats stay byte-identical with adjacent-only folding', () => {
    // Adjacent folding runs first; the frequency pass must not re-fold its
    // output (double folding would corrupt the counts).
    const input = ['run', 'run', 'run', 'run', 'other'].join('\n')
    const folded = normalizeTerminalLines(input).folded
    expect(folded.map(line => line.text)).toEqual([
      'run',
      '[previous line repeated 3 more times]',
      'other',
    ])
    expect(normalizeTerminalText(input)).toBe('run\n[previous line repeated 3 more times]\nother')
  })
})

describe('long-string placeholder (R12)', () => {
  it('replaces long base64, long hex, and UUIDs with length summaries', () => {
    const base64 = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpabcdeg'.repeat(9).slice(0, 300)
    const hex = 'deadbeefcafebabe0123456789abcdef'.repeat(2)
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    const text = `token: ${base64}\nhash: ${hex}\nid: ${uuid}`
    const folded = normalizeTerminalLines(text).folded
    expect(folded[0]!.text).toContain(`[base64 300 chars: ${base64.slice(0, 16)}`)
    expect(folded[1]!.text).toContain('[hex 64 chars: deadbeefcafebabe')
    expect(folded[2]!.text).toContain('[uuid]')
  })

  it('counter-proof: short strings are never replaced', () => {
    const shortishBase64 = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo='.repeat(5).slice(0, 150)
    const shortHex = 'deadbeefcafebabe0123456789abcdef'
    const text = `${shortishBase64}\n${shortHex}`
    const joined = normalizeTerminalLines(text).folded.map(line => line.text).join('\n')
    expect(joined).toContain(shortishBase64)
    expect(joined).toContain(shortHex)
  })

  it('keeps the line count and original line numbers intact', () => {
    const base64 = 'x'.repeat(260)
    const text = `before ${base64} after\nnext line`
    const folded = normalizeTerminalLines(text).folded
    expect(folded).toHaveLength(2)
    expect(folded[0]!.originalLine).toBe(1)
    expect(folded[1]!.originalLine).toBe(2)
  })
})
