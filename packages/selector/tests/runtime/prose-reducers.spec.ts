import { describe, expect, it } from 'vitest'
import { codePointLength } from '../../src/runtime/config.ts'
import { reduceFreshToolResult, type ReducerInput } from '../../src/runtime/reducers.ts'

function input(overrides: Partial<ReducerInput> = {}): ReducerInput {
  return {
    toolName: 'mcp_remote_fetch',
    argumentsText: '{}',
    text: '',
    budgetChars: 4_000,
    sourceRef: 'session://s/event/1',
    isError: false,
    ...overrides,
  }
}

function markdownDoc(sections: number): string {
  const parts: string[] = ['# User Guide', 'Intro paragraph with orientation prose.']
  for (let index = 1; index <= sections; index++) {
    parts.push(`## Section ${String(index)}: Installation`)
    for (let line = 0; line < 12; line++) {
      parts.push(`Section ${String(index)} line ${String(line)} with ordinary documentation prose content.`)
    }
  }
  return parts.join('\n')
}

describe('document skeleton (R8)', () => {
  it('keeps every H1-H3 heading and at least one sentence per section', () => {
    const output = reduceFreshToolResult(input({ text: markdownDoc(8) }))
    expect(output).not.toBeNull()
    expect(output!.reducer).toBe('doc-skeleton')
    for (let index = 1; index <= 8; index++) {
      expect(output!.text).toContain(`## Section ${String(index)}: Installation`)
      // 每节 ≥1 句：the section's first line survives.
      expect(output!.text).toContain(`Section ${String(index)} line 0`)
    }
    expect(output!.text).toContain('# User Guide')
  })

  it('cites original-event line ranges in elision markers (R9 spec)', () => {
    const output = reduceFreshToolResult(input({ text: markdownDoc(6) }))
    expect(output).not.toBeNull()
    // Every elision marker carries an original line range and a line count.
    const markers = output!.text.match(/\[\.\.\. lines \d+-\d+ elided \(\d+ lines\)[^\]]*\]/g) ?? []
    expect(markers.length).toBeGreaterThan(0)
    for (const marker of markers) {
      const [, start, end, count] = /\[\.\.\. lines (\d+)-(\d+) elided \((\d+) lines\)/.exec(marker) ?? []
      expect(Number(end) - Number(start) + 1).toBe(Number(count))
    }
  })

  it('misjudgment guard: logs and build output are not documents', () => {
    // Realistic build/log output carries no Markdown heading lines at all —
    // timestamps, INFO frames, and stack locations never match `^#\\s`.
    const log = [
      'INFO 2026-01-01 starting build',
      'WARN 2026-01-01 deprecated flag --legacy',
      'INFO compiling modules',
      'ERROR TS2345: cannot find name elsewhere',
      ...Array.from({ length: 40 }, (_, i) => `at /pkg/src/module${String(i)}.ts:12:5`),
    ].join('\n')
    const output = reduceFreshToolResult(input({ text: log, toolName: 'bash', argumentsText: '{"command":"pnpm build"}' }))
    expect(output?.reducer).not.toBe('doc-skeleton')
  })
})

describe('prose head+tail keep (R8b)', () => {
  const prose = [
    ...Array.from({ length: 60 }, (_, i) => `Early paragraph ${String(i)} with orientation prose for the reader.`),
    ...Array.from({ length: 60 }, (_, i) => `Middle paragraph ${String(i)} carries ordinary filler content.`),
    ...Array.from({ length: 60 }, (_, i) => `Final paragraph ${String(i)} holds the decisive conclusion about quotas.`),
  ].join('\n')

  it('keeps head AND tail non-empty with an elision marker in between', () => {
    const output = reduceFreshToolResult(input({ text: prose }))
    expect(output).not.toBeNull()
    expect(output!.reducer).toBe('prose-keep')
    const lines = output!.text.split('\n')
    expect(lines[0]).toContain('Early paragraph 0')
    expect(lines.at(-1)).toContain('Final paragraph 59')
    expect(output!.text).toMatch(/\[\.\.\. lines \d+-\d+ elided \(\d+ lines\)/)
    // The tail keeps conclusions the old head-only reducer dropped.
    expect(output!.text).toContain('decisive conclusion')
  })

  it('counter-proof: head-only retention provably loses the tail keyword', () => {
    // The old landing spots for prose were head-only (pi-head) or a salience
    // pass whose middle list is empty for prose. A head-only slice of B chars
    // can never contain a keyword that starts after char B: the prose is
    // ~11k chars and the decisive sentence sits in the last third, so any
    // head-only output within a 4k budget drops it by construction.
    const keywordIndex = prose.indexOf('decisive conclusion')
    expect(codePointLength(prose)).toBeGreaterThan(2 * 4_000)
    expect(keywordIndex).toBeGreaterThan(4_000)
    // The R8b output keeps it anyway (also asserted above).
  })

  it('misjudgment guard: source code still stays off the prose path', () => {
    const code = [
      'import { createHash } from \'node:crypto\'',
      '',
      ...Array.from({ length: 40 }, (_, i) => `export function handler${String(i)}(input: string): string {`),
      ...Array.from({ length: 40 }, (_, i) => `  return hash(input, ${String(i)})`),
      '}',
    ].join('\n')
    const output = reduceFreshToolResult(input({ text: code }))
    expect(output?.reducer).not.toBe('prose-keep')
    expect(output?.reducer).not.toBe('doc-skeleton')
  })
})
