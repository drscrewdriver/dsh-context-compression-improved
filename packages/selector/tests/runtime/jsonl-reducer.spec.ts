import { describe, expect, it } from 'vitest'
import { reduceFreshToolResult, type ReducerInput } from '../../src/runtime/reducers.ts'

const SOURCE_REF = 'session://s1/event/7'

function input(text: string, budgetChars: number, toolName = 'bash'): ReducerInput {
  return {
    toolName,
    argumentsText: toolName === 'read_file' ? '{"path":"logs.jsonl"}' : '{"command":"cat logs.jsonl"}',
    text,
    budgetChars,
    sourceRef: SOURCE_REF,
    isError: false,
  }
}

function jsonlStream(count: number, pad = 120): string {
  return Array.from({ length: count }, (_, index) =>
    JSON.stringify({ seq: index, status: 'ok', payload: 'x'.repeat(pad), note: `record ${String(index)}` }))
    .join('\n')
}

describe('JSONL / NDJSON reducer (jsonl-structure-preview)', () => {
  it('samples head + tail records and collapses the middle into an omitted count', () => {
    const output = reduceFreshToolResult(input(jsonlStream(50), 2_000))
    expect(output).not.toBeNull()
    expect(output!.reducer).toBe('jsonl-structure-preview')
    expect(output!.text).toContain(SOURCE_REF)
    expect(output!.text).toContain('"$dsh_omitted_records"')
    expect(output!.text).toContain('"seq": 0')
    expect(output!.text).toContain('"seq": 49')
    expect(output!.text).not.toContain('"seq": 25')
  })

  it('still fires through the host read gutter (N: prefix) via the content view', () => {
    const gutted = jsonlStream(40)
      .split('\n')
      .map((line, index) => `${String(index + 1)}: ${line}`)
      .join('\n')
    const output = reduceFreshToolResult(input(gutted, 2_000, 'read_file'))
    expect(output).not.toBeNull()
    expect(output!.reducer).toBe('jsonl-structure-preview')
    expect(output!.text).toContain('"seq": 0')
    expect(output!.text).toContain('"seq": 39')
  })

  it('does not steal a pretty-printed single JSON (regression: json-* branch intact)', () => {
    // Unique-key lines so the adjacent/non-adjacent fold leaves the blob intact
    // and reduceJson actually parses it (repeating structural lines would fold
    // into markers and is a pre-existing, unrelated bail).
    const record: Record<string, string> = { fetched_at: '2026-10-15T15:26:14Z' }
    for (let index = 0; index < 200; index += 1) record[`field_${String(index)}`] = 'v'.repeat(60)
    const pretty = JSON.stringify(record, null, 2)
    const output = reduceFreshToolResult(input(pretty, 2_000))
    expect(output).not.toBeNull()
    expect(output!.reducer).not.toBe('jsonl-structure-preview')
    expect(output!.reducer).toMatch(/^json-/)
  })

  it('treats a multi-record stream as JSONL but a one-line array as single JSON', () => {
    const many = jsonlStream(20)
    expect(reduceFreshToolResult(input(many, 2_000))?.reducer).toBe('jsonl-structure-preview')
    const oneLine = JSON.stringify(Array.from({ length: 20 }, (_, index) => ({ seq: index, payload: 'x'.repeat(120) })))
    expect(reduceFreshToolResult(input(oneLine, 2_000))?.reducer).not.toBe('jsonl-structure-preview')
  })

  it('fails open (no jsonl preview) when the sampled envelope cannot fit the budget', () => {
    const wide = jsonlStream(30, 900)
    const output = reduceFreshToolResult(input(wide, 1_200))
    // Must not throw, and must never land a jsonl preview that busts the budget.
    expect(output === null || output.reducer !== 'jsonl-structure-preview' || output.text.length <= 1_200).toBe(true)
  })

  it('leaves a two-record stream alone (nothing to omit) rather than inflating it', () => {
    const two = `${JSON.stringify({ a: 'x'.repeat(200) })}\n${JSON.stringify({ b: 'y'.repeat(200) })}`
    const output = reduceFreshToolResult(input(two, 1_200))
    expect(output?.reducer ?? 'none').not.toBe('jsonl-structure-preview')
  })
})
