import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseContextCompressionSettings, DEFAULT_CONTEXT_COMPRESSION_SETTINGS } from '../../src/runtime/config.ts'
import { SavingsLedger } from '../../src/runtime/savings.ts'
import {
  applySessionOverride,
  observeContextUsage,
  buildMonitorSnapshot,
  estimateSavingsPricing,
  isSessionOverrideAction,
} from '../../src/runtime/monitor.ts'
import { getSummaryOverride } from '../../src/runtime/tokenpilot/advisor-state.ts'

/** 每用例独立 sessionId:advisor-state 的覆盖表是模块级,防用例间串扰。 */
let seq = 0
const uniqueSession = (): string => `monitor-spec-${++seq}`

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildMonitorSnapshot', () => {
  it('savings aggregate plus the intent control block, defaults lossless', () => {
    const snap = buildMonitorSnapshot(undefined, new SavingsLedger())
    expect(snap.gross.exact).toBe(0)
    expect(snap.sessionScope).toBeNull()
    expect(snap.intent.override).toBeUndefined()
    expect(snap.intent.observedEnabled).toBeUndefined()
    expect(snap.intent.gate).toEqual({ floorFraction: 0.45, growthTokens: 50_000 })
    expect(snap.intent.lastFold).toBeUndefined()
  })

  it('session filter scopes the savings rows and the control block', () => {
    const ledger = new SavingsLedger()
    ledger.recordSaving({
      sessionId: 's1',
      component: 'fresh',
      tokensBefore: 10_000,
      tokensAfter: 2_000,
      basis: 'exact-tokenizer',
      sourceSeq: 1,
    })
    const scoped = buildMonitorSnapshot('s1', ledger)
    expect(scoped.sessionScope).toBe('s1')
    expect(scoped.gross.exact).toBe(8_000)
    const other = buildMonitorSnapshot('s2', ledger)
    expect(other.gross.exact).toBe(0)
  })

  it('reuses the ledger verbatim — no second accounting', () => {
    const ledger = new SavingsLedger()
    ledger.recordSaving({
      sessionId: 's1',
      component: 'fresh',
      tokensBefore: 1_000,
      tokensAfter: 100,
      basis: 'exact-tokenizer',
      sourceSeq: 2,
      originalText: 'x\n'.repeat(400),
    })
    const monitor = buildMonitorSnapshot('s1', ledger)
    expect(monitor).toMatchObject(ledger.snapshot('s1'))
  })
})

describe('applySessionOverride (the /ctx-summary state machine)', () => {
  it('pins on/off and echoes the post-action truth', () => {
    const sessionId = uniqueSession()
    expect(applySessionOverride(sessionId, 'on').override).toBe('on')
    expect(getSummaryOverride(sessionId)).toBe('on')
    expect(applySessionOverride(sessionId, 'off').override).toBe('off')
    expect(getSummaryOverride(sessionId)).toBe('off')
  })

  it('clear returns the session to settings-driven', () => {
    const sessionId = uniqueSession()
    applySessionOverride(sessionId, 'off')
    expect(applySessionOverride(sessionId, 'clear').override).toBeUndefined()
    expect(getSummaryOverride(sessionId)).toBeUndefined()
  })

  it('isSessionOverrideAction narrows exactly the three actions', () => {
    expect(isSessionOverrideAction('on')).toBe(true)
    expect(isSessionOverrideAction('off')).toBe(true)
    expect(isSessionOverrideAction('clear')).toBe(true)
    expect(isSessionOverrideAction('status')).toBe(false)
    expect(isSessionOverrideAction(42)).toBe(false)
  })
})

describe('estimateSavingsPricing (moved from the entry — shared by savings and monitor routes)', () => {
  const snapshot = {
    startedAt: new Date().toISOString(),
    net: { exact: 4_200, estimated: 0 },
    usage: { requests: 3, inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 100 },
  }

  it('third-party routes fail closed to no pricing', () => {
    const readService = (): unknown => ({ currentSelection: () => ({ provider: 'local-35b', model: 'Qwen3.6-35B-A3B' }) })
    expect(estimateSavingsPricing(readService, snapshot)).toBeUndefined()
  })

  it('official routes carry actual cost and the labeled saved-cost estimate', () => {
    const readService = (): unknown => ({ currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) })
    const pricing = estimateSavingsPricing(readService, snapshot)
    expect(pricing?.currency).toBe('USD')
    expect(typeof pricing?.actualCost).toBe('string')
    expect(typeof pricing?.estimatedSavedCost).toBe('string')
  })

  it('an empty ledger prices nothing', () => {
    const readService = (): unknown => ({ currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) })
    expect(estimateSavingsPricing(readService, {
      startedAt: new Date().toISOString(),
      net: { exact: 0, estimated: 0 },
      usage: { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })).toBeUndefined()
  })
})


import type { Context } from '@deepseek-ai/cordis'
import { registerMonitorRoute } from '../../src/index.ts'

/** Fake webServer: captures exact-path handlers; fake ctx wires direct arrival. */
function mountMonitorRoute(): { handler: (req: unknown, res: unknown) => void } {
  let handler: (req: unknown, res: unknown) => void = () => {}
  const webServer = { register: (def: { path: string, handler: typeof handler }) => { handler = def.handler; return () => undefined } }
  const ctx = {
    get: (name: string) => (name === 'webServer' ? webServer : undefined),
    inject: (deps: string[], cb: (injected: Record<string, unknown>) => void) => cb({ webServer }),
    effect: () => undefined,
  } as unknown as Context
  registerMonitorRoute(ctx)
  return { handler }
}

interface CapturedResponse {
  status: number
  body: Record<string, unknown>
}

function fakeRes(): { res: unknown, captured: CapturedResponse } {
  const captured = {} as CapturedResponse
  const res = {
    writeHead: (status: number) => { captured.status = status },
    end: (body?: string) => { captured.body = JSON.parse(body ?? '{}') as Record<string, unknown> },
  }
  return { res, captured }
}

function fakeReq(url: string, method: string, body?: string): unknown {
  return {
    url,
    method,
    on: (event: string, cb: (chunk?: Buffer) => void) => {
      if (event === 'data' && body !== undefined) cb(Buffer.from(body, 'utf8'))
      if (event === 'end') cb()
    },
  }
}

describe('monitor route (GET snapshot / POST override)', () => {
  const PATH = '/api/dsh-context-compression-improved/monitor'
  const { handler } = mountMonitorRoute()

  it('GET returns ok + savings + intent block scoped to the query session', () => {
    const { res, captured } = fakeRes()
    handler(fakeReq(`${PATH}?sessionId=route-s1`, 'GET'), res)
    expect(captured.status).toBe(200)
    expect(captured.body.ok).toBe(true)
    expect(captured.body.sessionScope).toBe('route-s1')
    expect((captured.body.intent as Record<string, unknown>).gate).toEqual({ floorFraction: 0.45, growthTokens: 50_000 })
  })

  it('POST drives the /ctx-summary override state machine', () => {
    const sessionId = `route-${uniqueSession()}`
    const { res, captured } = fakeRes()
    handler(fakeReq(`${PATH}?sessionId=${sessionId}`, 'POST', '{"action":"off"}'), res)
    expect(captured.status).toBe(200)
    expect(captured.body).toEqual({ ok: true, override: 'off', sessionScope: sessionId })
    expect(getSummaryOverride(sessionId)).toBe('off')
  })

  it('POST rejects an unknown action with 400 and touches no state', () => {
    const sessionId = uniqueSession()
    const { res, captured } = fakeRes()
    handler(fakeReq(`${PATH}?sessionId=${sessionId}`, 'POST', '{"action":"boom"}'), res)
    expect(captured.status).toBe(400)
    expect(captured.body.ok).toBe(false)
    expect(getSummaryOverride(sessionId)).toBeUndefined()
  })

  it('POST rejects a non-JSON body with 400', () => {
    const { res, captured } = fakeRes()
    handler(fakeReq(PATH, 'POST', 'not-json'), res)
    expect(captured.status).toBe(400)
    expect(captured.body.ok).toBe(false)
  })
})

describe('monitorPanel settings parsing (schema surface, mirrors intentSummary cases)', () => {
  const base = {
    profile: 'balanced' as const,
    custom: structuredClone(DEFAULT_CONTEXT_COMPRESSION_SETTINGS.custom),
  }

  it('defaults to hidden', () => {
    expect(DEFAULT_CONTEXT_COMPRESSION_SETTINGS.monitorPanel).toEqual({ enabled: false })
  })

  it('absent section inherits the default', () => {
    const parsed = parseContextCompressionSettings({ ...base, autoCompact: { thresholdPercent: 80 } })
    expect(parsed.monitorPanel).toEqual({ enabled: false })
  })

  it('accepts exactly { enabled: boolean }', () => {
    const parsed = parseContextCompressionSettings({ ...base, monitorPanel: { enabled: true } })
    expect(parsed.monitorPanel).toEqual({ enabled: true })
  })

  it('rejects extra keys (present-but-invalid is never silently defaulted)', () => {
    expect(() => parseContextCompressionSettings({
      ...base, monitorPanel: { enabled: true, position: 'left' },
    })).toThrow(/expected exactly "enabled"/)
  })

  it('rejects non-boolean enabled', () => {
    expect(() => parseContextCompressionSettings({
      ...base, monitorPanel: { enabled: 'yes' },
    })).toThrow(/monitorPanel\.enabled must be a boolean/)
  })

  it('rejects non-object section', () => {
    expect(() => parseContextCompressionSettings({ ...base, monitorPanel: 'yes' }))
      .toThrow(/monitorPanel must be a plain object/)
  })
})

describe('context occupancy observation (task_6.2)', () => {
  it('scoped snapshot carries the observed occupancy block', () => {
    const sessionId = uniqueSession()
    observeContextUsage(sessionId, 60_000, 128_000)
    const snap = buildMonitorSnapshot(sessionId, new SavingsLedger())
    expect(snap.context).toEqual({ liveTokens: 60_000, contextWindow: 128_000, pct: 0.469, sessionId })
  })

  it('aggregate snapshot carries the most recently observed session', () => {
    const a = uniqueSession()
    const b = uniqueSession()
    observeContextUsage(a, 10_000, 100_000)
    observeContextUsage(b, 90_000, 100_000)
    const snap = buildMonitorSnapshot(undefined, new SavingsLedger())
    expect(snap.context?.sessionId).toBe(b)
    expect(snap.context?.pct).toBe(0.9)
  })

  it('no observation yet — context block absent', () => {
    const snap = buildMonitorSnapshot(uniqueSession(), new SavingsLedger())
    expect(snap.context).toBeUndefined()
  })

  it('observation cap keeps the newest 64 sessions', () => {
    for (let i = 0; i < 70; i++) observeContextUsage(`cap-${i}`, i, 1000)
    const snap = buildMonitorSnapshot('cap-69', new SavingsLedger())
    expect(snap.context?.sessionId).toBe('cap-69')
  })

  it('empty session id and non-finite tokens are ignored', () => {
    observeContextUsage('', 5, 100)
    observeContextUsage('fin-check', Number.NaN, 100)
    expect(buildMonitorSnapshot('fin-check', new SavingsLedger()).context).toBeUndefined()
  })
})

