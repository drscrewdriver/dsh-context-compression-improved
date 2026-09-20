/**
 * Host-side guard for the advisory advisor's HTTP report route.
 *
 * Pins the read-only contract: the route registers under both prefixes only
 * when the row opts in, a session whose advisor never ran reports nulls and
 * empty arrays (not an error), a populated session reports its decay figure
 * and score distribution content-free, and every error path answers a
 * precise status — 400 for a missing sessionId, 404 for an unknown session,
 * 503 when no agents service can resolve sessions at all.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'
import { getAdvisorState, recordScore, recordRecertified } from '../src/runtime/tokenpilot/advisor-state.ts'

const REPORT_ROUTE = '/api/dsh-context-compression-improved/advisor-report'
const LEGACY_REPORT_ROUTE = '/endpoint/dsh-context-compression-improved/advisor-report'

interface RegisteredRoute {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => unknown
}

interface FakeResponse {
  status?: number
  body?: string
}

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20))

async function mountWebServer(runtime: Context, routes: RegisteredRoute[]): Promise<void> {
  await runtime.plugin({
    name: 'fake-webserver',
    apply(webCtx) {
      webCtx.provide('webServer', {
        tables: { exact: new Map<string, RegisteredRoute>() },
        register(this: { tables: { exact: Map<string, RegisteredRoute> } }, route: RegisteredRoute) {
          const table = this.tables.exact
          if (table.has(route.path)) {
            throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
          }
          table.set(route.path, route)
          routes.push(route)
          return () => {}
        },
      })
    },
  })
}

/** Mount an agents service that knows session 's1' (and nothing else). */
function mountAgents(runtime: Context): void {
  void runtime.plugin({
    name: 'fake-agents',
    apply(serviceCtx) {
      serviceCtx.provide('agents', {
        get: (id: unknown) => {
          if (id !== 's1') return undefined
          const session = { id: 's1' }
          const state = getAdvisorState(session as never)
          state.summary = {
            overallTask: 'migrate the auth module',
            activeSubtasks: ['port login flow'],
            keywords: ['auth'],
            todoVersion: 'aaaa1111',
            turn: 4,
          }
          state.lastDecay = { decay: 0.42, weightedChars: 10_000, turn: 4 }
          recordScore(state, 3, { score: 0.95, turn: 4 })
          recordScore(state, 5, { score: 0.10, turn: 4 })
          recordRecertified(state, 5, 4)
          return { session }
        },
      })
    },
  })
}

async function invoke(route: RegisteredRoute, req?: unknown): Promise<FakeResponse> {
  const captured: FakeResponse = {}
  const res = {
    writeHead(code: number) { captured.status = code },
    end(body?: string) { if (body !== undefined) captured.body = body },
  }
  await route.handler(req ?? { method: 'GET' }, res)
  await settle()
  return captured
}

describe('advisor report route registration', () => {
  it('registers both prefixes only when the row opts in', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    apply(runtime, { advisorReportRoute: true })
    await settle()
    const paths = routes.map(route => route.path)
    expect(paths).toContain(REPORT_ROUTE)
    expect(paths).toContain(LEGACY_REPORT_ROUTE)
  })

  it('registers nothing by default (advisor off adds zero behavior)', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    apply(runtime, {})
    await settle()
    expect(routes.map(route => route.path)).not.toContain(REPORT_ROUTE)
  })
})

describe('advisor report route responses', () => {
  async function mountedRoute(): Promise<RegisteredRoute> {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    apply(runtime, { advisorReportRoute: true })
    await settle()
    const route = routes.find(entry => entry.path === REPORT_ROUTE)
    expect(route).toBeDefined()
    return route as RegisteredRoute
  }

  it('answers 503 without an agents service', async () => {
    const route = await mountedRoute()
    const response = await invoke(route, { url: `${REPORT_ROUTE}?sessionId=s1` })
    expect(response.status).toBe(503)
  })

  it('answers 404 for an unknown session and 400 for a missing sessionId', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    mountAgents(runtime)
    apply(runtime, { advisorReportRoute: true })
    await settle()
    const route = routes.find(entry => entry.path === REPORT_ROUTE) as RegisteredRoute

    const unknown = await invoke(route, { url: `${REPORT_ROUTE}?sessionId=other` })
    expect(unknown.status).toBe(404)

    const missing = await invoke(route, { url: REPORT_ROUTE })
    expect(missing.status).toBe(400)
  })

  it('serves the decay figure, summary, and scores content-free', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    mountAgents(runtime)
    apply(runtime, { advisorReportRoute: true })
    await settle()
    const route = routes.find(entry => entry.path === REPORT_ROUTE) as RegisteredRoute

    const response = await invoke(route, { url: `${REPORT_ROUTE}?sessionId=s1` })
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body ?? '{}') as {
      ok: boolean
      sessionId: string
      advisor: {
        summary: { overallTask: string } | null
        decay: number | null
        weightedChars: number | null
        scores: { seq: number, score: number }[]
        lowRelevanceSeqs: number[]
      }
    }
    expect(body.ok).toBe(true)
    expect(body.sessionId).toBe('s1')
    expect(body.advisor.decay).toBeCloseTo(0.42, 12)
    expect(body.advisor.summary?.overallTask).toBe('migrate the auth module')
    expect(body.advisor.scores).toHaveLength(2)
    expect(body.advisor.lowRelevanceSeqs).toEqual([5])
    // Content-free: no message text ever rides along.
    expect(response.body).not.toContain('"text"')
    expect(response.body).not.toContain('"content"')
    expect(response.body).not.toContain('apiKey')
  })

  it('answers an empty report (nulls, not an error) for a session whose advisor never ran', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    void runtime.plugin({
      name: 'fake-agents-empty',
      apply(serviceCtx) {
        serviceCtx.provide('agents', {
          get: (id: unknown) => (id === 's1' ? { session: { id: 's1' } } : undefined),
        })
      },
    })
    apply(runtime, { advisorReportRoute: true })
    await settle()
    const route = routes.find(entry => entry.path === REPORT_ROUTE) as RegisteredRoute

    const response = await invoke(route, { url: `${REPORT_ROUTE}?sessionId=s1` })
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body ?? '{}') as {
      ok: boolean
      advisor: { summary: unknown, decay: unknown, scores: unknown[], lowRelevanceSeqs: unknown[] }
    }
    expect(body.ok).toBe(true)
    expect(body.advisor.summary).toBeNull()
    expect(body.advisor.decay).toBeNull()
    expect(body.advisor.scores).toEqual([])
    expect(body.advisor.lowRelevanceSeqs).toEqual([])
  })
})
