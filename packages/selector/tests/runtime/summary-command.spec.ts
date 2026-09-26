import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONTEXT_COMPRESSION_SETTINGS,
  parseContextCompressionSettings,
} from '../../src/runtime/config.ts'
import {
  getLastIntentFold,
  getObservedIntentEnabled,
  getSummaryOverride,
  recordIntentFold,
  setSummaryOverride,
  observeIntentEnabled,
} from '../../src/runtime/tokenpilot/advisor-state.ts'
import {
  formatSummaryStatus,
  parseSummaryCommandArgs,
  registerSummaryCommand,
} from '../../src/runtime/summary-command.ts'

describe('intentSummary settings parsing', () => {
  it('defaults to lossless off', () => {
    expect(DEFAULT_CONTEXT_COMPRESSION_SETTINGS.intentSummary).toEqual({ enabled: false })
  })

  it('absent section inherits the default', () => {
    const parsed = parseContextCompressionSettings({
      profile: 'balanced',
      custom: structuredClone(DEFAULT_CONTEXT_COMPRESSION_SETTINGS.custom),
      autoCompact: { thresholdPercent: 80 },
      codeSkeleton: { enabled: false },
    })
    expect(parsed.intentSummary).toEqual({ enabled: false })
  })

  it('accepts exactly { enabled: boolean }', () => {
    const parsed = parseContextCompressionSettings({
      profile: 'balanced',
      custom: structuredClone(DEFAULT_CONTEXT_COMPRESSION_SETTINGS.custom),
      intentSummary: { enabled: true },
    })
    expect(parsed.intentSummary).toEqual({ enabled: true })
  })

  it('rejects extra keys (present-but-invalid is never silently defaulted)', () => {
    expect(() => parseContextCompressionSettings({
      profile: 'balanced',
      custom: structuredClone(DEFAULT_CONTEXT_COMPRESSION_SETTINGS.custom),
      intentSummary: { enabled: true, gate: 1 },
    })).toThrow(/expected exactly "enabled"/)
  })

  it('rejects non-boolean enabled', () => {
    expect(() => parseContextCompressionSettings({
      profile: 'balanced',
      custom: structuredClone(DEFAULT_CONTEXT_COMPRESSION_SETTINGS.custom),
      intentSummary: { enabled: 'yes' },
    })).toThrow(/intentSummary\.enabled must be a boolean/)
  })

  it('rejects non-object section', () => {
    expect(() => parseContextCompressionSettings({
      profile: 'balanced',
      custom: structuredClone(DEFAULT_CONTEXT_COMPRESSION_SETTINGS.custom),
      intentSummary: true,
    })).toThrow(/intentSummary must be a plain object/)
  })
})

describe('session-scoped summary override state', () => {
  it('round-trips and clears per session id, isolated across sessions', () => {
    expect(getSummaryOverride('s1')).toBeUndefined()
    setSummaryOverride('s1', 'off')
    setSummaryOverride('s2', 'on')
    expect(getSummaryOverride('s1')).toBe('off')
    expect(getSummaryOverride('s2')).toBe('on')
    setSummaryOverride('s1', undefined)
    expect(getSummaryOverride('s1')).toBeUndefined()
    expect(getSummaryOverride('s2')).toBe('on')
  })

  it('observed enabled flag round-trips independently', () => {
    expect(getObservedIntentEnabled('sx')).toBeUndefined()
    observeIntentEnabled('sx', true)
    expect(getObservedIntentEnabled('sx')).toBe(true)
  })

  it('last fold record is newest-wins per session', () => {
    expect(getLastIntentFold('sy')).toBeUndefined()
    recordIntentFold('sy', { turn: 3, startSeq: 10, endSeq: 20, liveTokensBefore: 100_000, at: 1 })
    recordIntentFold('sy', { turn: 5, startSeq: 30, endSeq: 40, liveTokensBefore: 150_000, at: 2 })
    expect(getLastIntentFold('sy')).toMatchObject({ turn: 5, startSeq: 30 })
  })
})

describe('/ctx-summary command surface', () => {
  it('parses exactly off|on|status (case-insensitive, trimmed)', () => {
    expect(parseSummaryCommandArgs(' off ')).toBe('off')
    expect(parseSummaryCommandArgs('ON')).toBe('on')
    expect(parseSummaryCommandArgs('Status')).toBe('status')
    expect(parseSummaryCommandArgs('')).toBeUndefined()
    expect(parseSummaryCommandArgs('now')).toBeUndefined()
    expect(parseSummaryCommandArgs('off extra')).toBeUndefined()
  })

  it('handler sets and clears the override for the invocation session', async () => {
    let registered: { name: string, handler: (invocation: { agent?: unknown, rawInput?: unknown }) => Promise<{ kind: string, text: string }> } | undefined
    const commands = { register: (definition: unknown): void => { registered = definition as typeof registered } }
    const ctx = {
      inject: (deps: readonly string[], callback: (injected: Record<string, unknown>) => void): void => {
        if (deps.includes('commands')) callback({ commands })
      },
    }
    registerSummaryCommand(ctx as never)
    await vi.waitFor(() => expect(registered).toBeDefined())
    expect(registered?.name).toBe('ctx-summary')

    const agent = { session: { id: 'sess-1' } }
    const off = await registered!.handler({ agent, rawInput: 'off' })
    expect(off.kind).toBe('success')
    expect(getSummaryOverride('sess-1')).toBe('off')

    const on = await registered!.handler({ agent, rawInput: 'on' })
    expect(on.kind).toBe('success')
    expect(getSummaryOverride('sess-1')).toBe('on')

    const bad = await registered!.handler({ agent, rawInput: 'wat' })
    expect(bad.kind).toBe('error')
  })

  it('status reports override, gate and last fold', async () => {
    let registered: { handler: (invocation: { agent?: unknown, rawInput?: unknown }) => Promise<{ kind: string, text: string }> } | undefined
    const commands = { register: (definition: unknown): void => { registered = definition as typeof registered } }
    registerSummaryCommand({
      inject: (_deps: readonly string[], callback: (injected: Record<string, unknown>) => void) => callback({ commands }),
    } as never)
    await vi.waitFor(() => expect(registered).toBeDefined())
    recordIntentFold('sess-9', { turn: 7, startSeq: 5, endSeq: 9, liveTokensBefore: 120_000, at: 42 })
    const out = await registered!.handler({ agent: { session: { id: 'sess-9' } }, rawInput: 'status' })
    expect(out.kind).toBe('success')
    expect(out.text).toContain('override: default')
    expect(out.text).toContain('seq 5..9')
    expect(out.text).toContain('45% of window')
  })

  it('stays quiet when the commands service never mounts', () => {
    const ctx = {
      inject: (deps: readonly string[], callback: (injected: Record<string, unknown>) => void) => {
        // cordis semantics: the callback never runs when a dependency is absent.
        void deps
        void callback
      },
    }
    expect(() => registerSummaryCommand(ctx as never)).not.toThrow()
  })
})
