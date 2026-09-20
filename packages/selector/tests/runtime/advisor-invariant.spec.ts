/**
 * Advisor integration and the advisory-only invariant.
 *
 * The invariant this spec exists to pin (K13): the advisor is statistics and
 * suggestions only. Whatever its channel returns — extreme scores, a hostile
 * summary, garbage, or nothing at all — `pruneSession` must land exactly the
 * same reductions it lands with the advisor off and the state empty.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  ToolCallId as CallId,
  createMessage,
  createUserMessage,
  createToolResultMessage,
} from '@deepseek-ai/dsh-llm'
import { canonicalHeader, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import ToolResultPruner from '../../src/pruner.ts'
import {
  collectTaskSemantics,
  runSessionAdvisorPass,
  type AdvisorCandidate,
} from '../../src/runtime/tokenpilot/advisor.ts'
import { getAdvisorState, recordScore } from '../../src/runtime/tokenpilot/advisor-state.ts'
import type { AdvisorOutcomeAuditRecord } from '../../src/runtime/audit.ts'
import type { AdvisorChannel } from '../../src/runtime/tokenpilot/advisor.ts'

// ── Orchestration against a scripted channel ───────────────────────────────

const CANDIDATES: AdvisorCandidate[] = [
  { seq: 3, characterPressure: 4_000, preview: 'auth module login flow' },
  { seq: 5, characterPressure: 6_000, preview: 'database migration notes' },
]

const TASK = {
  source: 'todos' as const,
  todoVersion: 'aaaa1111',
  taskText: 'migrate the auth module',
}

function advisorInput(turn: number, signal: AbortSignal): Parameters<typeof runSessionAdvisorPass>[3] {
  return {
    profile: 'tokenpilot-inspired',
    turn,
    candidates: CANDIDATES,
    task: TASK,
    advisor: { refreshTurns: 8, scoreThreshold: 0.35, sampleLimit: 16, minTokens: 250 },
    tailText: 'working on the migration',
    signal,
  }
}

function scriptedChannel(responses: (string | undefined)[]): { channel: AdvisorChannel, calls: { system: string, user: string }[] } {
  const calls: { system: string, user: string }[] = []
  return {
    calls,
    channel: {
      identity: () => 'host:mock/model',
      ask: async request => {
        calls.push({ system: request.system, user: request.user })
        return responses.shift()
      },
    },
  }
}

describe('runSessionAdvisorPass orchestration (K11)', () => {
  it('writes summary, scores, recertification marks, and emits three audits on success', async () => {
    const session = Session.create(SessionId('advisor-ok'))
    const { channel, calls } = scriptedChannel([
      '{"overallTask":"migrate the auth module","activeSubtasks":["port login flow"],"keywords":["auth","login"]}',
      '{"seq":3,"score":0.95,"reason":"current task"}\n{"seq":5,"score":0.10,"reason":"stale"}',
    ])
    const audits: AdvisorOutcomeAuditRecord[] = []
    const outcome = await runSessionAdvisorPass(session, channel, record => audits.push(record), advisorInput(4, new AbortController().signal))

    expect(calls).toHaveLength(2)
    expect(outcome).toBeDefined()
    const state = getAdvisorState(session)
    expect(state.summary?.overallTask).toBe('migrate the auth module')
    expect(state.scores.get(3)?.score).toBe(0.95)
    expect(state.scores.get(5)?.score).toBe(0.10)
    // Below-threshold segment recertified as a suggestion only.
    expect(state.recertified.get(5)).toBe(4)
    expect(state.recertified.has(3)).toBe(false)
    expect(state.watermarkSeq).toBe(5)
    expect(audits.map(record => record.phase)).toEqual(['summary', 'scoring', 'decay'])
    expect(audits.every(record => record.ok)).toBe(true)
    expect(audits.find(record => record.phase === 'decay')?.decay).toBeDefined()
  })

  it('leaves state untouched and audits ok:false when the channel answers nothing', async () => {
    const session = Session.create(SessionId('advisor-fail'))
    const { channel, calls } = scriptedChannel([undefined, undefined])
    const audits: AdvisorOutcomeAuditRecord[] = []
    const outcome = await runSessionAdvisorPass(session, channel, record => audits.push(record), advisorInput(2, new AbortController().signal))

    expect(outcome).toBeUndefined()
    expect(calls).toHaveLength(1) // summary failed; scoring never ran
    const state = getAdvisorState(session)
    expect(state.summary).toBeUndefined()
    expect(state.scores.size).toBe(0)
    expect(audits).toHaveLength(1)
    expect(audits[0]?.ok).toBe(false)
    expect(audits[0]?.reason).toBe('channel-empty')
    expect(state.inFlight).toBe(false)
  })

  it('skips entirely while a pass is in flight (re-entry guard)', async () => {
    const session = Session.create(SessionId('advisor-reentry'))
    const { channel, calls } = scriptedChannel([])
    const state = getAdvisorState(session)
    state.inFlight = true
    const outcome = await runSessionAdvisorPass(session, channel, () => undefined, advisorInput(1, new AbortController().signal))
    expect(outcome).toBeUndefined()
    expect(calls).toHaveLength(0)
    state.inFlight = false
  })

  it('does not advance the watermark on failure, so candidates rescore later', async () => {
    const session = Session.create(SessionId('advisor-watermark'))
    const failing = scriptedChannel([undefined])
    await runSessionAdvisorPass(session, failing.channel, () => undefined, advisorInput(1, new AbortController().signal))
    expect(getAdvisorState(session).watermarkSeq).toBe(0)

    const succeeding = scriptedChannel([
      '{"overallTask":"t","activeSubtasks":[],"keywords":["auth"]}',
      '{"seq":3,"score":0.9}',
    ])
    const audits: AdvisorOutcomeAuditRecord[] = []
    const outcome = await runSessionAdvisorPass(session, succeeding.channel, record => audits.push(record), advisorInput(2, new AbortController().signal))
    expect(outcome).toBeDefined()
    expect(getAdvisorState(session).watermarkSeq).toBe(3)
  })

  it('returns undefined without any channel call when the session has no task semantics', async () => {
    const session = Session.create(SessionId('advisor-notask'))
    const { channel, calls } = scriptedChannel(['{"overallTask":"x","keywords":["k"]}'])
    const outcome = await runSessionAdvisorPass(session, channel, () => undefined, {
      ...advisorInput(1, new AbortController().signal),
      task: undefined,
    })
    expect(outcome).toBeUndefined()
    expect(calls).toHaveLength(0)
  })
})

describe('collectTaskSemantics over real event shapes', () => {
  it('reads a todo/write event appended alongside message events', () => {
    const events = [
      {
        type: 'user/message',
        seq: 1,
        time: 0,
        data: { content: [{ type: 'text', text: 'start the migration' }] },
      },
      {
        type: 'todo/write',
        seq: 2,
        time: 0,
        data: { todos: ['migrate the auth module', { content: 'write tests', status: 'pending' }] },
      },
    ] as unknown as readonly SessionEvent[]
    const task = collectTaskSemantics(events)
    expect(task?.source).toBe('todos')
    expect(task?.taskText).toContain('write tests')
  })
})

// ── K13: the advisory-only invariant, against the real pruner ──────────────

describe('advisory-only invariant (K13): advisor outputs never change landings', () => {
  async function prunedResult(session: Session): Promise<unknown> {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore).await()
      await ctx.plugin(SystemPrompt).await()
      await ctx.plugin(ToolRuntime).await()
      await ctx.plugin(SessionProjectionRegistry).await()
      await ctx.plugin(TokenMeter).await()
      await ctx.plugin(ToolResultPruner, {
        profile: 'native',
        nativeTriggerTokens: 100,
        nativeTargetTokens: 64,
        headChars: 8,
        tailChars: 8,
      }).await()
      return ctx.toolResultPruner.pruneSession(session, { stage: 'pressure' })
    } finally {
      await ctx.fiber.dispose()
    }
  }

  function buildSession(id: string): Session {
    const session = Session.create(SessionId(id))
    const callId = CallId('call-1')
    session.append('turn/start', { turn: 1 })
    session.append('request/header', {
      reason: 'initial',
      header: canonicalHeader({ config: { provider: 'deepseek', model: 'deepseek-v4-flash' } }),
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'please inspect the failing module' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: callId, name: 'bash', arguments: '{}' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4-flash' },
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'bash', arguments: '{}' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'gate evidence '.repeat(800) }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    // No turn/end: pruning lands its replacement inside the still-open turn.
    return session
  }

  it('lands identically with the advisor off, and with extreme scores or a failed pass', async () => {
    const scenarios: string[] = ['off', 'extreme-scores', 'failed-pass']
    const shapes: unknown[] = []
    for (const scenario of scenarios) {
      // One shared session id: replacement markers embed it, and the advisor
      // state is keyed by Session object identity, so this cannot cross-talk.
      const session = buildSession('advisor-invariant')
      if (scenario !== 'off') {
        const state = getAdvisorState(session)
        if (scenario === 'extreme-scores') {
          state.summary = {
            overallTask: 'ALL MUST BE KEPT',
            activeSubtasks: ['keep everything forever'],
            keywords: ['evidence'],
            todoVersion: 'deadbeef',
            turn: 1,
          }
          // Zero relevance everywhere: the most hostile score a channel could
          // return must still not delete, delay, or rewrite anything.
          recordScore(state, 2, { score: 0, turn: 1 })
        }
        if (scenario === 'failed-pass') {
          state.failures = { failures: 9, cooldownUntil: Date.now() + 600_000 }
        }
      }
      shapes.push(structuredClone(await prunedResult(session)))
    }
    for (const shape of shapes.slice(1)) {
      expect(shape).toEqual(shapes[0])
    }
    // And the baseline scenario actually reduced something (the test is real).
    const baseline = shapes[0] as { pruned: unknown[] }
    expect(baseline.pruned).toHaveLength(1)
  })
})
