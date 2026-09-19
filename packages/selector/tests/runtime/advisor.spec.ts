import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  collectTaskSemantics,
  prefixDecay,
  selectScoringCandidates,
  type AdvisorCandidate,
} from '../../src/runtime/tokenpilot/advisor.ts'
import {
  ADVISOR_RECERTIFIED_LIMIT,
  ADVISOR_SCORES_LIMIT,
  getAdvisorState,
  invalidateOnTaskChange,
  recordRecertified,
  recordScore,
} from '../../src/runtime/tokenpilot/advisor-state.ts'
import {
  buildAdvisorScoringUserPrompt,
  parseAdvisorScores,
  parseAdvisorSummary,
} from '../../src/runtime/tokenpilot/advisor-prompt.ts'

function todoWriteEvent(data: unknown): SessionEvent {
  return { type: 'todo/write', seq: 1, time: 0, data } as unknown as SessionEvent
}

function userMessageEvent(text: string): SessionEvent {
  return {
    type: 'user/message',
    seq: 2,
    time: 0,
    data: { content: [{ type: 'text', text }] },
  } as unknown as SessionEvent
}

describe('collectTaskSemantics (K5)', () => {
  it('parses a structured todo/write payload', () => {
    const semantics = collectTaskSemantics([
      todoWriteEvent({ todos: [{ content: 'migrate gates', status: 'in_progress' }, 'write tests'] }),
    ])
    expect(semantics).toBeDefined()
    expect(semantics?.source).toBe('todos')
    expect(semantics?.taskText).toContain('migrate gates')
    expect(semantics?.taskText).toContain('write tests')
    // Same content ⇒ same version token (deterministic).
    const again = collectTaskSemantics([todoWriteEvent({ todos: [{ content: 'migrate gates', status: 'in_progress' }, 'write tests'] })])
    expect(again?.todoVersion).toBe(semantics?.todoVersion)
  })

  it('degrades a malformed todo payload to its raw JSON string', () => {
    const semantics = collectTaskSemantics([todoWriteEvent({ todos: 'not-an-array' })])
    expect(semantics).toBeDefined()
    expect(semantics?.source).toBe('raw-todo')
    expect(semantics?.taskText).toContain('not-an-array')
  })

  it('falls back to recent user/message text when no todo/write exists', () => {
    const semantics = collectTaskSemantics([
      userMessageEvent('earlier request'),
      userMessageEvent('please refactor the pruner gates'),
    ])
    expect(semantics).toBeDefined()
    expect(semantics?.source).toBe('messages')
    expect(semantics?.taskText).toContain('refactor the pruner gates')
  })

  it('picks the most recent todo/write event', () => {
    const semantics = collectTaskSemantics([
      todoWriteEvent({ todos: ['old task'] }),
      userMessageEvent('something else'),
      todoWriteEvent({ todos: ['new task'] }),
    ])
    expect(semantics?.taskText).toBe('new task')
  })

  it('returns undefined for an empty log', () => {
    expect(collectTaskSemantics([])).toBeUndefined()
  })
})

describe('prefixDecay (K6)', () => {
  const candidates: AdvisorCandidate[] = [
    { seq: 1, characterPressure: 3_000, preview: 'a' },
    { seq: 2, characterPressure: 1_000, preview: 'b' },
  ]
  // prefixDecay takes the weight face only; previews are scoring-prompt inputs.
  const weights = candidates.map(({ seq, characterPressure }) => ({ seq, characterPressure }))

  it('is deterministic and weights by character pressure', () => {
    const scores = new Map([[1, { score: 0 }], [2, { score: 1 }]])
    const first = prefixDecay(weights, scores)
    const second = prefixDecay(weights, scores)
    expect(first).toEqual(second)
    // weight 3000×0 + 1000×1 over 4000 ⇒ relevance 0.25 ⇒ decay 0.75.
    expect(first.decay).toBeCloseTo(0.75, 12)
    expect(first.weightedChars).toBe(4_000)
  })

  it('counts unscored candidates as neutral 0.5', () => {
    const decay = prefixDecay(weights, new Map())
    expect(decay.decay).toBeCloseTo(0.5, 12)
  })

  it('is 0 with no candidates and ignores zero-pressure candidates', () => {
    expect(prefixDecay([], new Map()).decay).toBe(0)
    expect(prefixDecay([{ seq: 9, characterPressure: 0 }], new Map()).decay).toBe(0)
  })
})

describe('selectScoringCandidates', () => {
  const candidates: AdvisorCandidate[] = [
    { seq: 1, characterPressure: 8_000, preview: 'auth module login handling' },
    { seq: 2, characterPressure: 2_000, preview: 'tiny fragment' },
    { seq: 3, characterPressure: 9_000, preview: 'login auth token refresh' },
    { seq: 4, characterPressure: 12_000, preview: 'unrelated weather report' },
  ]

  it('applies the watermark, the character floor, and the sample limit', () => {
    const state = { watermarkSeq: 1 }
    const picked = selectScoringCandidates(candidates, state, {
      taskKeywords: new Set(['login', 'auth', 'token']),
      minChars: 4_000,
      sampleLimit: 1,
      taskChanged: false,
    })
    // seq 2 below floor, seq 1 at/below watermark; overlap ranks seq 3 first.
    expect(picked.map(item => item.seq)).toEqual([3])
  })

  it('ignores the watermark when the task semantics changed', () => {
    const picked = selectScoringCandidates(candidates, { watermarkSeq: 4 }, {
      taskKeywords: new Set(['login']),
      minChars: 4_000,
      sampleLimit: 16,
      taskChanged: true,
    })
    // Overlap ties (seq 1 and 3 both match "login") break by character pressure.
    expect(picked.map(item => item.seq)).toEqual([3, 1, 4])
  })
})

describe('advisor-state bounds (K8)', () => {
  it('evicts the oldest score beyond the LRU limit', () => {
    const session = {} as Parameters<typeof getAdvisorState>[0]
    const state = getAdvisorState(session)
    for (let seq = 0; seq < ADVISOR_SCORES_LIMIT + 10; seq += 1) {
      recordScore(state, seq, { score: 0.5, turn: seq })
    }
    expect(state.scores.size).toBe(ADVISOR_SCORES_LIMIT)
    expect(state.scores.has(0)).toBe(false)
    expect(state.scores.has(ADVISOR_SCORES_LIMIT + 9)).toBe(true)
    // Re-touching a seq moves it to the newest position.
    recordScore(state, 10, { score: 0.9, turn: 999 })
    recordScore(state, ADVISOR_SCORES_LIMIT + 10, { score: 0.1, turn: 1_000 })
    expect(state.scores.has(10)).toBe(true)
    expect(state.scores.size).toBe(ADVISOR_SCORES_LIMIT)
  })

  it('bounds recertified marks the same way', () => {
    const session = {} as Parameters<typeof getAdvisorState>[0]
    const state = getAdvisorState(session)
    for (let seq = 0; seq < ADVISOR_RECERTIFIED_LIMIT + 5; seq += 1) {
      recordRecertified(state, seq, seq)
    }
    expect(state.recertified.size).toBe(ADVISOR_RECERTIFIED_LIMIT)
    expect(state.recertified.has(0)).toBe(false)
  })

  it('invalidates the summary when the task version changes', () => {
    const session = {} as Parameters<typeof getAdvisorState>[0]
    const state = getAdvisorState(session)
    state.summary = { overallTask: 'x', activeSubtasks: [], keywords: [], todoVersion: 'aaa', turn: 1 }
    state.lastSummaryTurn = 1
    expect(invalidateOnTaskChange(state, 'bbb')).toBe(true)
    expect(state.summary).toBeUndefined()
    expect(state.lastSummaryTurn).toBe(-1)
    expect(invalidateOnTaskChange(state, 'bbb')).toBe(false)
  })
})

describe('advisor prompts (K7)', () => {
  it('parses a well-formed summary answer', () => {
    const parsed = parseAdvisorSummary(
      'Sure! {"overallTask":"migrate gates","activeSubtasks":["port fresh gate"],"keywords":["gates","pruner"]}',
    )
    expect(parsed?.overallTask).toBe('migrate gates')
    expect(parsed?.keywords).toEqual(['gates', 'pruner'])
  })

  it('fails open on a malformed summary answer', () => {
    expect(parseAdvisorSummary(undefined)).toBeUndefined()
    expect(parseAdvisorSummary('')).toBeUndefined()
    expect(parseAdvisorSummary('not json at all')).toBeUndefined()
    expect(parseAdvisorSummary('{"overallTask":""}')).toBeUndefined()
    expect(parseAdvisorSummary('{"overallTask":"x"}')).toBeUndefined()
  })

  it('parses JSON-lines scoring answers and drops invalid rows', () => {
    const parsed = parseAdvisorScores(
      '{"seq":1,"score":0.9,"reason":"current task"}\n'
      + 'noise line {"seq":2,"score":1.5}\n'
      + '{"seq":99,"score":0.5}\n'
      + '{"seq":3,"score":0.1}\n',
      new Set([1, 2, 3]),
    )
    expect(parsed?.size).toBe(2)
    expect(parsed?.get(1)?.score).toBe(0.9)
    expect(parsed?.get(3)?.score).toBe(0.1)
    expect(parsed?.has(2)).toBe(false)
    expect(parsed?.has(99)).toBe(false)
  })

  it('fails open on empty or all-garbage scoring answers', () => {
    expect(parseAdvisorScores(undefined, new Set([1]))).toBeUndefined()
    expect(parseAdvisorScores('', new Set([1]))).toBeUndefined()
    expect(parseAdvisorScores('garbage only', new Set([1]))).toBeUndefined()
  })

  it('builds a scoring prompt that keeps previews one-per-line', () => {
    const prompt = buildAdvisorScoringUserPrompt('task text', ['sub'], [
      { seq: 7, preview: 'some\npreview' },
    ])
    expect(prompt).toContain('task: task text')
    expect(prompt).toContain('seq=7 | some preview')
  })
})
