/**
 * T4.2/T4.4 red tests: fold tier table, queue discipline, endpoint policy,
 * and input hygiene (plan cci-sedimentation-triage Phase 4).
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  FOLD_MAX_TOKENS,
  FoldRouter,
  buildFoldPrompt,
  foldTier,
} from '../../src/runtime/fold-router.ts'
import type { SedimentSettings } from '../../src/runtime/types.ts'
import type { NarrativeSpan, VerbatimLine } from '../../src/runtime/triage/types.ts'

describe('foldTier (S1 tier table)', () => {
  it('routes by input size with the 2K/8K walls', () => {
    expect(foldTier(2_048)).toBe('strata')
    expect(foldTier(2_049)).toBe('local35')
    expect(foldTier(8_192)).toBe('local35')
    expect(foldTier(8_193)).toBe('skip')
  })
})

const poolLine = (text: string): VerbatimLine => ({
  seq: 1, role: 'tool', text, ruleId: 'line:failure-classic', truncated: false, hardFailure: true,
})
const span = (text: string, role: NarrativeSpan['role'] = 'assistant'): NarrativeSpan => ({
  seq: 2, role, tokens: Math.ceil(text.length / 4), text,
})

describe('buildFoldPrompt (S4 input hygiene)', () => {
  it('excludes protected lines by construction', () => {
    const protectedText = 'Error: TS2345 failed'
    const prompt = buildFoldPrompt(
      [span(protectedText, 'tool'), span('we refactored the loader and tests pass now')],
      [poolLine(protectedText)],
      [],
    )
    expect(prompt).not.toBeNull()
    expect(prompt?.user).not.toContain(protectedText)
    expect(prompt?.user).toContain('refactored the loader')
  })
  it('residue-only material: empty residue yields null (no call made)', () => {
    expect(buildFoldPrompt([span('Error: dup')], [poolLine('Error: dup')], [])).toBeNull()
  })
  it('system prompt forbids reconstituting withheld output', () => {
    const prompt = buildFoldPrompt([span('narrative')], [], [])
    expect(prompt?.system).toContain('Never restate, guess, or reconstitute withheld output')
  })
})

function settingsWith(overrides: Partial<SedimentSettings>): SedimentSettings {
  return {
    enabled: true, granularity: 'turn', minClosingTokens: 120, rewriteGuardRatio: 3, maxTurnSpanTokens: 32_000,
    foldMode: 'direct', foldBaseUrl: 'http://192.168.100.158:8081/v1',
    foldStrataModel: 'qwen3.8-flash', foldStrataProvider: 'strata',
    foldLocal35Model: 'qwen3.6-35b', foldLocal35Provider: 'local-35',
    ...overrides,
  }
}

function ctxStub(): Context {
  return { get: () => undefined } as unknown as Context
}

describe('FoldRouter (S1/S2/S3 + queue depth 1)', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const promptSmall = { system: 's', user: 'u'.repeat(400), inputTokens: 100 }

  it('refuses >8K inputs without touching the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const router = new FoldRouter(ctxStub(), settingsWith({}))
    const outcome = await router.fold('s1', { ...promptSmall, inputTokens: 9_000 }, new AbortController().signal)
    expect(outcome.audit.reason).toBe('fold-input-over-8k-refused')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('unconfigured channel fails open with a reason', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const router = new FoldRouter(ctxStub(), settingsWith({ foldMode: '' }))
    const outcome = await router.fold('s1', promptSmall, new AbortController().signal)
    expect(outcome.audit.reason).toBe('fold-unconfigured')
  })

  it('missing endpoint mapping for the tier refuses with tier identity', async () => {
    vi.stubGlobal('fetch', vi.fn())
    // local-35 tier without its model configured: omit the key entirely.
    const noLocal35 = settingsWith({})
    delete (noLocal35 as { foldLocal35Model?: string }).foldLocal35Model
    const router = new FoldRouter(ctxStub(), noLocal35)
    const outcome = await router.fold('s1', { ...promptSmall, inputTokens: 4_000 }, new AbortController().signal)
    expect(outcome.audit.reason).toBe('fold-endpoint-missing:local35')
  })

  it('direct call carries max_tokens=400 and the tier endpoint model', async () => {
    let capturedBody: Record<string, unknown> = {}
    const fetchMock = vi.fn(async (_url: unknown, init?: unknown) => {
      capturedBody = JSON.parse((init as { body: string }).body) as Record<string, unknown>
      return new Response(JSON.stringify({ choices: [{ message: { content: '- folded narrative' } }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const router = new FoldRouter(ctxStub(), settingsWith({}))
    const outcome = await router.fold('s1', promptSmall, new AbortController().signal)
    expect(outcome.text).toContain('folded narrative')
    expect(capturedBody.max_tokens).toBe(FOLD_MAX_TOKENS)
    expect(capturedBody.model).toBe('qwen3.8-flash')
    // enable_thinking must never be toggled on for LAN fold calls (S2 hard rule):
    // the direct transport sends no thinking field at all.
    expect(capturedBody.enable_thinking).toBeUndefined()
  })

  it('queue depth 1: a second concurrent fold skips instead of stacking', async () => {
    let release: ((value: Response) => void) | undefined
    const gate = new Promise<Response>(resolve => { release = resolve })
    const fetchMock = vi.fn(async () => await gate)
    vi.stubGlobal('fetch', fetchMock)
    const router = new FoldRouter(ctxStub(), settingsWith({}))
    const first = router.fold('s1', promptSmall, new AbortController().signal)
    await Promise.resolve()
    expect(router.isBusy('s1')).toBe(true)
    const second = await router.fold('s1', promptSmall, new AbortController().signal)
    expect(second.audit.reason).toBe('fold-busy-skip')
    release?.(new Response(JSON.stringify({ choices: [{ message: { content: '- done' } }] }), { status: 200 }))
    const firstOutcome = await first
    expect(firstOutcome.text).toContain('done')
    expect(router.isBusy('s1')).toBe(false)
  })

  it('failure leaves no text (tier 3 mechanical card) and never retries', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    const router = new FoldRouter(ctxStub(), settingsWith({}))
    const outcome = await router.fold('s1', promptSmall, new AbortController().signal)
    expect(outcome.text).toBeUndefined()
    expect(outcome.audit.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1) // retries=0
  })
})
