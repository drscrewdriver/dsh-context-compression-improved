/**
 * T3.4/T3.5 red tests: commit clock and publication transaction
 * (plan cci-sedimentation-triage Phase 3).
 */
import { describe, expect, it } from 'vitest'
import { SedimentClock, canCommitNow } from '../../src/runtime/sediment-clock.ts'
import { passesRewriteGuard, projectSurfaceEvent, publishSettledCard, type PublishTarget } from '../../src/runtime/sediment-publish.ts'
import type { TurnCardDraft } from '../../src/runtime/triage/types.ts'

function draft(retained: number, source: number): TurnCardDraft {
  return {
    head: 'h',
    pool: [],
    masks: [],
    omissionStats: 's',
    narrativeTier: 'closing',
    retainedTokens: retained,
    sourceTokens: source,
  }
}

describe('canCommitNow (T3.4 predicate)', () => {
  const open = {
    lastEventType: 'turn/end',
    inFlightRequest: false,
    compactionOpen: false,
    officialCheckpointSeq: undefined,
    seenOfficialCheckpointSeq: undefined,
    resumeFirstBatch: false,
  }

  it('passes in a clean quiet seam', () => {
    expect(canCommitNow(open)).toEqual({ ok: true, reason: 'quiet-seam' })
  })
  it('blocks outside the seam, in-flight, compaction, resume', () => {
    expect(canCommitNow({ ...open, lastEventType: 'step/start', }).reason).toBe('not-in-quiet-seam')
    expect(canCommitNow({ ...open, inFlightRequest: true }).reason).toBe('request-in-flight')
    expect(canCommitNow({ ...open, compactionOpen: true }).reason).toBe('compaction-in-progress')
    expect(canCommitNow({ ...open, resumeFirstBatch: true }).reason).toBe('resume-first-batch')
  })
  it('yields exactly once to a fresh official checkpoint (seen-seq cooldown)', () => {
    const withOfficial = { ...open, officialCheckpointSeq: 55 }
    expect(canCommitNow(withOfficial).reason).toBe('yield-official-checkpoint-55')
    expect(canCommitNow({ ...withOfficial, seenOfficialCheckpointSeq: 55 }).ok).toBe(true)
  })

  it('SedimentClock: re-entrance guard and one-time consumption', () => {
    const clock = new SedimentClock()
    expect(clock.begin()).toBe(true)
    expect(clock.begin()).toBe(false) // M11 single queue
    clock.end()
    expect(clock.begin()).toBe(true)
    clock.end()
    const base = { lastEventType: 'turn/end', inFlightRequest: false, compactionOpen: false, officialCheckpointSeq: 77, resumeFirstBatch: false }
    expect(clock.decide(base).reason).toBe('yield-official-checkpoint-77')
    clock.noteOfficialConsumed(77)
    expect(clock.decide(base).ok).toBe(true)
    // A newer checkpoint re-arms the yield.
    expect(clock.decide({ ...base, officialCheckpointSeq: 88 }).ok).toBe(false)
  })
})

interface RecordingSession extends PublishTarget {
  calls: Array<{ type: string; data: unknown; options?: unknown }>
}

function recordingSession(failSecond = false): RecordingSession {
  const session: RecordingSession = {
    calls: [],
    append(type: 'compaction/prune' | 'user/message', data: unknown, options?: unknown): { seq: number } {
      if (failSecond && type === 'user/message') throw new Error('disk locked')
      session.calls.push({ type, data, options })
      return { seq: session.calls.length + 10 }
    },
  }
  return session
}

describe('publishSettledCard (T3.5 transaction)', () => {
  it('shortening proof runs BEFORE any append — a non-shrinking card writes nothing (M7)', () => {
    const session = recordingSession()
    const result = publishSettledCard(session, draft(5_000, 4_000), { startSeq: 2, endSeq: 9, shadowedSeqs: [2, 3, 9] })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('shortening-proof-failed')
    expect(session.calls).toHaveLength(0)
  })

  it('lands manifest then replacement with replace surfaceOp and source seqs', () => {
    const session = recordingSession()
    const result = publishSettledCard(session, draft(1_000, 4_000), { startSeq: 2, endSeq: 9, shadowedSeqs: [2, 3, 9] })
    expect(result.ok).toBe(true)
    expect(session.calls.map(call => call.type)).toEqual(['compaction/prune', 'user/message'])
    const options = session.calls[1].options as Record<string, unknown>
    expect(options.surfaceOp).toEqual({ op: 'replace', startSeq: 2, endSeq: 9 })
    expect(options.sourceEventSeqs).toEqual([11, 2, 3, 9])
    const manifest = session.calls[0].data as Record<string, unknown>
    expect(manifest.shadowedTokenCount).toBe(4_000)
  })

  it('replacement failure surfaces as a reason with the manifest seq, never throws', () => {
    const session = recordingSession(true)
    const result = publishSettledCard(session, draft(1_000, 4_000), { startSeq: 2, endSeq: 9, shadowedSeqs: [2] })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('publication-failed')
    expect(result.manifestSeq).toBeDefined()
  })

  it('empty span refuses', () => {
    const session = recordingSession()
    expect(publishSettledCard(session, draft(10, 100), { startSeq: 1, endSeq: 1, shadowedSeqs: [] }).reason).toBe('empty-span')
  })
})

describe('passesRewriteGuard (community 1:15 defense)', () => {
  it('rejects a cut whose saving drowns in tail rewrite', () => {
    // saving 5k vs tail rewrite 30k × ratio 3 → refuse (the 1:15 shape)
    expect(passesRewriteGuard(draft(5_000, 10_000), 30_000, 3)).toBe(false)
    // saving 5k vs tail 1k × ratio 3 → pass
    expect(passesRewriteGuard(draft(5_000, 10_000), 1_000, 3)).toBe(true)
    // zero saving never passes
    expect(passesRewriteGuard(draft(10_000, 10_000), 0, 1)).toBe(false)
  })
})

describe('projectSurfaceEvent', () => {
  it('maps the four event shapes and drops the rest', () => {
    const assistant = projectSurfaceEvent(5, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'running' }, { type: 'tool-call', id: 'c1' }, { type: 'tool-call', id: 'c2' }] } },
    }, undefined)
    expect(assistant).toMatchObject({ seq: 5, type: 'assistant/message', toolCalls: 2, text: 'running' })
    const result = projectSurfaceEvent(6, { type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'out' }], isError: true } } }, { name: 'pwsh', argsJson: '{}' })
    expect(result).toMatchObject({ type: 'tool/result', toolName: 'pwsh', isError: true })
    const end = projectSurfaceEvent(7, { type: 'turn/end', data: { reason: { kind: 'completed' } } }, undefined)
    expect(end).toMatchObject({ type: 'turn/end', reasonKind: 'completed' })
    expect(projectSurfaceEvent(8, { type: 'workspace/changes', data: {} }, undefined)).toBeNull()
  })
})
