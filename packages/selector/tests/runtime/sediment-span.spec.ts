/**
 * T3.2 (span half) red tests: reason gate, tail-kept rounds, span bounds,
 * and end-to-end triage over a projected turn (plan Phase 3).
 */
import { describe, expect, it } from 'vitest'
import { planTurnSpan, triageSpanBlocks, type SurfaceEvent } from '../../src/runtime/sediment-span.ts'
import { mergeExtraPatterns } from '../../src/runtime/triage/signals.ts'

const RULES = mergeExtraPatterns([])

function turn(events: SurfaceEvent[]): SurfaceEvent[] {
  return [...events, { seq: 99, type: 'turn/end', text: '', reasonKind: 'completed' }]
}

const a = (seq: number, toolCalls = 0, text = ''): SurfaceEvent =>
  ({ seq, type: 'assistant/message', text, toolCalls })
const t = (seq: number, text: string, toolName?: string, argsJson?: string, isError = false): SurfaceEvent =>
  ({ seq, type: 'tool/result', text, toolName, argsJson, isError })

describe('planTurnSpan (T3.3)', () => {
  const bigRead = `import fs from "node:fs"\n${'  const x = compute(i)\n'.repeat(120)}`

  const threeRoundTurn: SurfaceEvent[] = turn([
    { seq: 1, type: 'user/message', text: 'fix the build' },
    a(2, 1), t(3, 'no errors yet', 'pwsh', '{"command":"npm run build"}'),
    a(4, 1), t(5, bigRead, 'read', JSON.stringify({ file_path: 'src/big.ts' })),
    a(6, 1), t(7, 'Error: TS2345 not assignable', 'pwsh', '{"command":"tsc"}', false),
    a(8, 0, '修好了：tsc 的 TS2345 由类型收窄解决，构建通过。'.repeat(6)),
  ])

  it('tail-kept: last round and closing stay out of the span', () => {
    const plan = planTurnSpan(threeRoundTurn)
    expect(plan.completed).toBe(true)
    expect(plan.startSeq).toBe(2)
    expect(plan.endSeq).toBe(5) // round2 end; round3 (6,7) kept
    expect(plan.blocks.map(block => block.seq)).toEqual([2, 3, 4, 5])
    expect(plan.keptSeqs).toEqual(expect.arrayContaining([1, 6, 7, 8]))
    expect(plan.closingText).toContain('修好了')
  })

  it('reason gate: non-completed turns are flagged not-replaceable', () => {
    const interrupted = threeRoundTurn.map(event =>
      event.type === 'turn/end' ? { ...event, reasonKind: 'interrupted' } : event)
    expect(planTurnSpan(interrupted).completed).toBe(false)
  })

  it('single-round turns leave an empty span (nothing to cut before the kept round)', () => {
    const single = turn([
      { seq: 1, type: 'user/message', text: 'hi' },
      a(2, 1), t(3, 'output', 'pwsh', '{"command":"ls"}'),
      a(4, 0, 'listed.'),
    ])
    const plan = planTurnSpan(single)
    expect(plan.startSeq).toBeNull()
    expect(plan.blocks).toHaveLength(0)
  })

  it('tailRoundsKept=0 puts every round into the span', () => {
    const plan = planTurnSpan(threeRoundTurn, { tailRoundsKept: 0 })
    expect(plan.endSeq).toBe(7)
  })
})

describe('triageSpanBlocks (end-to-end line assignment)', () => {
  it('assigns manifest to write results, skeleton to big reads, pool lines to failures', () => {
    const bigRead = `import fs from "node:fs"\n${'  const x = compute(i)\n'.repeat(200)}`
    const events = [
      { seq: 1, type: 'user/message', text: 'go' },
      { seq: 2, type: 'assistant/message', text: '', toolCalls: 1 },
      { seq: 3, type: 'tool/result', text: 'File written', toolName: 'write', argsJson: JSON.stringify({ file_path: 'src/a.ts' }) },
      { seq: 4, type: 'assistant/message', text: '', toolCalls: 1 },
      { seq: 5, type: 'tool/result', text: bigRead, toolName: 'read', argsJson: JSON.stringify({ file_path: 'src/big.ts' }) },
      { seq: 6, type: 'assistant/message', text: '', toolCalls: 1 },
      { seq: 7, type: 'tool/result', text: 'Error: TS2345 failed\n[exit code: 2]', toolName: 'pwsh', argsJson: '{"command":"tsc"}' },
      { seq: 8, type: 'assistant/message', text: 'fixed: narrowed the union type at the call site, tsc passes now.', toolCalls: 0 },
      { seq: 99, type: 'turn/end', text: '', reasonKind: 'completed' },
    ] as const satisfies SurfaceEvent[]
    const plan = planTurnSpan([...events], { tailRoundsKept: 0 })
    const triage = triageSpanBlocks(plan, RULES)
    const bySeq = new Map(triage.map(result => [result.poolLines[0]?.seq ?? result.mask?.seq ?? -1, result]))
    const writeBlock = triage.find(result => result.mask?.kind === 'manifest')
    expect(writeBlock?.mask?.kind).toBe('manifest')
    const readBlock = triage.find(result => result.mask?.kind === 'skeleton')
    expect(readBlock?.mask?.kind).toBe('skeleton')
    const failBlock = triage.find(result => result.poolLines.some(line => line.text.includes('TS2345')))
    expect(failBlock).toBeDefined()
    expect(failBlock?.poolLines[0].hardFailure).toBe(true)
    expect(bySeq.size).toBeGreaterThan(0)
  })
})
