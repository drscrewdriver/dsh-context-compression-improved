/**
 * T3.6 red tests: orchestrator pipeline and the disabled short-circuit.
 * The M1 guarantee is asserted structurally: with `enabled=false` the
 * event reader is NEVER invoked — no accumulation, no card, no append.
 */
import { describe, expect, it } from 'vitest'
import { SedimentOrchestrator, type OrchestratorOptions, type SedimentSession } from '../../src/runtime/sediment.ts'
import { DEFAULT_SEDIMENT_SETTINGS } from '../../src/runtime/config.ts'
import type { SedimentSettings } from '../../src/runtime/types.ts'

interface Recorded extends SedimentSession {
  appends: Array<{ type: string; data: unknown; options?: unknown }>
}

function recordedSession(): Recorded {
  const session: Recorded = {
    id: 's1',
    appends: [],
    append(type: never, data: never, options?: never): { seq: number } {
      session.appends.push({ type, data, options })
      return { seq: session.appends.length + 100 }
    },
  }
  return session
}

const bigRead = `import fs from "node:fs"\n${'  const x = compute(i)\n'.repeat(300)}`

function turnEvents(completed = true): OrchestratorOptions['eventsFor'] {
  return () => [
    { seq: 1, type: 'user/message', data: { content: [{ type: 'text', text: 'do it' }] } },
    { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', id: 'c1' }] } } },
    { seq: 3, type: 'tool/result', data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: bigRead }] } } },
    { seq: 4, type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', id: 'c2' }] } } },
    { seq: 5, type: 'tool/result', data: { message: { toolCallId: 'c2', content: [{ type: 'text', text: 'Error: TS2345 failed\n[exit code: 2]' }] } } },
    { seq: 6, type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', id: 'c3' }] } } },
    { seq: 7, type: 'tool/result', data: { message: { toolCallId: 'c3', content: [{ type: 'text', text: 'fixed now' }] } } },
    { seq: 8, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `收尾：读过大文件并修复 TS2345，构建现在通过。${'总结。'.repeat(40)}` }] } } },
    { seq: 9, type: 'turn/end', data: { reason: { kind: completed ? 'completed' : 'interrupted' } } },
  ]
}

function harness(settings: SedimentSettings | undefined, tailTokens = 10, eventsFor = turnEvents()) {
  const session = recordedSession()
  let eventsCalled = 0
  const orchestrator = new SedimentOrchestrator({
    settingsFor: () => settings,
    eventsFor: (s, turn) => {
      eventsCalled += 1
      return eventsFor(s, turn)
    },
    callInfoFor: () => callId => callId === 'c1'
      ? { name: 'read', argsJson: JSON.stringify({ file_path: 'src/big.ts' }) }
      : callId === 'c2' || callId === 'c3'
        ? { name: 'pwsh', argsJson: '{"command":"tsc"}' }
        : undefined,
    tailTokensFor: () => tailTokens,
  })
  const context = {
    lastEventType: 'turn/end',
    inFlightRequest: false,
    compactionOpen: false,
    officialCheckpointSeq: undefined,
    resumeFirstBatch: false,
  }
  return { session, orchestrator, context, eventsCalled: () => eventsCalled }
}

const ON: SedimentSettings = { ...DEFAULT_SEDIMENT_SETTINGS, enabled: true, minClosingTokens: 40 }

describe('SedimentOrchestrator (T3.6)', () => {
  it('disabled settings short-circuit BEFORE touching events (M1 structural)', () => {
    const { session, orchestrator, context, eventsCalled } = harness({ ...DEFAULT_SEDIMENT_SETTINGS })
    const outcome = orchestrator.handleTurnEnd(session, 1, context)
    expect(outcome).toEqual({ committed: false, reason: 'disabled' })
    expect(eventsCalled()).toBe(0)
    expect(session.appends).toHaveLength(0)
  })

  it('undefined settings (session not yet snapped) behaves like disabled', () => {
    const { orchestrator, context, eventsCalled, session } = harness(undefined)
    expect(orchestrator.handleTurnEnd(session, 1, context).reason).toBe('disabled')
    expect(eventsCalled()).toBe(0)
  })

  it('enabled completed turn lands manifest + replacement', () => {
    const { session, orchestrator, context } = harness(ON)
    const outcome = orchestrator.handleTurnEnd(session, 1, context)
    expect(outcome.committed).toBe(true)
    expect(session.appends.map(entry => entry.type)).toEqual(['compaction/prune', 'user/message'])
    const options = session.appends[1].options as Record<string, any>
    expect(options.surfaceOp.op).toBe('replace')
    expect(options.surfaceOp.startSeq).toBe(2)
    // tail round (6,7) kept: span ends at seq 5
    expect(options.surfaceOp.endSeq).toBe(5)
  })

  it('reason gate: interrupted turns never publish', () => {
    const { session, orchestrator, context } = harness(ON, 10, turnEvents(false))
    const outcome = orchestrator.handleTurnEnd(session, 1, context)
    expect(outcome).toEqual({ committed: false, reason: 'reason-gate' })
    expect(session.appends).toHaveLength(0)
  })

  it('rewrite guard: a fat cached tail refuses the cut (1:15 defense)', () => {
    const { session, orchestrator, context } = harness(ON, 500_000)
    const outcome = orchestrator.handleTurnEnd(session, 1, context)
    expect(outcome).toEqual({ committed: false, reason: 'rewrite-guard' })
    expect(session.appends).toHaveLength(0)
  })

  it('official checkpoint yield: skip once, consume, proceed next seam', () => {
    const { session, orchestrator, context } = harness(ON)
    const first = orchestrator.handleTurnEnd(session, 1, { ...context, officialCheckpointSeq: 60 })
    expect(first.committed).toBe(false)
    expect(first.reason).toContain('yield-official-checkpoint-60')
    const second = orchestrator.handleTurnEnd(session, 2, { ...context, officialCheckpointSeq: 60 })
    expect(second.committed).toBe(true)
  })
})
