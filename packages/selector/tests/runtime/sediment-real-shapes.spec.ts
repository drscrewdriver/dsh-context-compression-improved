/**
 * Real-host event-shape landing guard (T3.8 evidence, plan cci-sedimentation-triage).
 *
 * The unit harness in sediment-orchestrator.spec.ts uses a minimal event shape.
 * This spec pins landing against the EXACT durable envelope captured from a real
 * `dsh --profile headless` LAN-Qwen session (verified field set: tool/result rides
 * `data.{turn,step,message,meta}` with `message.content[]` + `message.toolCallId` +
 * `message.isError`; the turn closes with `data.reason.kind === 'completed'`).
 * It is the contract proof that the looseData/looseContent accessors and the span
 * planner consume genuine host events, so a real-machine run only has to flip the
 * settings gate — no shape surprises.
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
    id: 'real-shapes',
    appends: [],
    append(type: never, data: never, options?: never): { seq: number } {
      session.appends.push({ type, data, options })
      return { seq: session.appends.length + 100 }
    },
  }
  return session
}

// A read large enough to clear the mask threshold so the whole tool round is
// shadow-able (real durable reads run 25-60K chars; a few hundred lines suffices).
const largeRead = Array.from(
  { length: 400 },
  (_, i) => `${i + 1}  const settled = commit(i) // sediment span probe line ${i + 1}`,
).join('\n')

const CALL1 = 'call_1206d7a550f54ec1bfbd5701'
const CALL2 = 'call_e6ecf1b89a3d436284c1399a'

/** Events cloned from the observed real envelope — same nesting, same field names. */
function realShapedEvents(): OrchestratorOptions['eventsFor'] {
  return () => [
    {
      seq: 12,
      type: 'user/message',
      data: {
        turn: 1,
        step: 1,
        message: { role: 'user', content: [{ type: 'text', text: 'do exactly two sequential tool calls then answer' }], id: 'u1' },
      },
    },
    {
      seq: 16,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 2,
        message: {
          role: 'assistant',
          content: [{ type: 'tool-call', id: CALL1, name: 'read', arguments: JSON.stringify({ file_path: 'src/big.ts', offset: 1, limit: 1000 }) }],
          id: 'a1',
        },
      },
    },
    {
      seq: 18,
      type: 'tool/result',
      data: {
        turn: 1,
        step: 2,
        message: { role: 'tool', source: { kind: 'tool-result' }, toolCallId: CALL1, content: [{ type: 'text', text: largeRead }], isError: false, id: 'r1' },
        meta: { duration: 12 },
      },
    },
    {
      seq: 22,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 3,
        message: {
          role: 'assistant',
          content: [{ type: 'tool-call', id: CALL2, name: 'read', arguments: JSON.stringify({ file_path: 'src/big.ts', offset: 1001, limit: 5 }) }],
          id: 'a2',
        },
      },
    },
    {
      seq: 23,
      type: 'tool/result',
      data: {
        turn: 1,
        step: 3,
        message: { role: 'tool', source: { kind: 'tool-result' }, toolCallId: CALL2, content: [{ type: 'text', text: '1001  tail line one\n1002  tail line two' }], isError: false, id: 'r2' },
        meta: { duration: 3 },
      },
    },
    {
      seq: 26,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 4,
        message: { role: 'assistant', content: [{ type: 'text', text: `收尾：两次顺序读取完成，第一块大块内容已沉降，尾部只保留了最后五行的验证行。${'结论。'.repeat(30)}` }], id: 'a3' },
      },
    },
    { seq: 28, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

function harness(settings: SedimentSettings): { session: Recorded; orchestrator: SedimentOrchestrator } {
  const session = recordedSession()
  const options: OrchestratorOptions = {
    settingsFor: () => settings,
    eventsFor: realShapedEvents(),
    callInfoFor: () => (callId: string | undefined) => {
      if (callId === CALL1) return { name: 'read', argsJson: JSON.stringify({ file_path: 'src/big.ts', offset: 1, limit: 1000 }) }
      if (callId === CALL2) return { name: 'read', argsJson: JSON.stringify({ file_path: 'src/big.ts', offset: 1001, limit: 5 }) }
      return undefined
    },
    // The tail after the cut (tiny second read + closing) stays small in tokens,
    // mirroring the big-then-small real session that motivated this fixture.
    tailTokensFor: () => 60,
  }
  return { session, orchestrator: new SedimentOrchestrator(options) }
}

const ON: SedimentSettings = { ...DEFAULT_SEDIMENT_SETTINGS, enabled: true, minClosingTokens: 40 }

describe('SedimentOrchestrator real-host event shapes (T3.8)', () => {
  it('lands manifest + replace over the captured durable envelope', async () => {
    const { session, orchestrator } = harness(ON)
    const outcome = await orchestrator.handleTurnEnd(session, 1, {
      lastEventType: 'turn/end',
      inFlightRequest: false,
      compactionOpen: false,
      officialCheckpointSeq: undefined,
      resumeFirstBatch: false,
    })
    expect(outcome.committed).toBe(true)
    const types = session.appends.map(entry => entry.type)
    expect(types).toEqual(['compaction/prune', 'user/message'])
    const manifest = session.appends[0]
    const manifestData = manifest?.data as { shadowedSeqs: number[]; shadowedRange: { start: number; end: number } }
    // The first big read round (16,18) must be shadowed; the tail round (22,23) kept.
    expect(manifestData.shadowedSeqs).toContain(18)
    expect(manifestData.shadowedSeqs).not.toContain(23)
    expect(manifestData.shadowedRange.start).toBeLessThanOrEqual(16)
    expect(manifestData.shadowedRange.end).toBeLessThan(22)
    const replacement = session.appends[1]
    const surfaceOp = (replacement?.options as { surfaceOp: { op: string } }).surfaceOp
    expect(surfaceOp.op).toBe('replace')
  })
})
