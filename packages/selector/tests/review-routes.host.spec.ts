/**
 * Host-side guard for the review pipeline's HTTP transport (R4).
 *
 * Pins the client↔runtime contract: the two routes (queue read, decide write)
 * register under both prefixes, the happy path answers a sanitized payload
 * (ids/seqs/counts, never digests or content), and every error path answers a
 * precise status — 400 for malformed input, 404 for unknown session/proposal,
 * 503 when the review pipeline is not serving the session.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

const QUEUE_ROUTE = '/api/dsh-context-compression-improved/review-queue'
const DECIDE_ROUTE = '/api/dsh-context-compression-improved/review-decide'
const LEGACY_QUEUE_ROUTE = '/endpoint/dsh-context-compression-improved/review-queue'
const LEGACY_DECIDE_ROUTE = '/endpoint/dsh-context-compression-improved/review-decide'

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

interface PrunerBehavior {
  readonly reviewOn: boolean
  decideOutcome?: { ok: true } | { ok: false, reason: string } | undefined
}

function mountReviewServices(runtime: Context, behavior: PrunerBehavior): void {
  void runtime.plugin({
    name: 'fake-review-services',
    apply(serviceCtx) {
      serviceCtx.provide('agents', {
        get: (id: unknown) => (id === 's1' ? { session: { id: 's1' } } : undefined),
      })
      const sampleProposal = {
        id: 'abc123def456',
        kind: 'read-state',
        status: 'pending',
        items: [{
          seq: 6, kind: 'read-state', component: 'history', tokensBefore: 2401, tokensAfter: 134,
          digest: 'dd'.repeat(32),
        }],
        benefit: { recoveredTokens: 400, penaltyTokens: 900, paybackTurns: 2.25 },
        enqueuedTurn: 3,
        lastTurnIndex: 3,
      }
      serviceCtx.provide('toolResultPruner', {
        listReviewProposals: (session: unknown) => {
          const id = (session as { id?: string }).id
          return id === 's1' && behavior.reviewOn ? [sampleProposal] : []
        },
        listAllReviewProposals: () => (behavior.reviewOn
          ? [{ sessionId: 's1', proposals: [sampleProposal] }]
          : []),
        reviewSummary: () => ({ autoApplied: 2, reviewApplied: 1, expired: 3, voided: 0 }),
        decideReviewProposal: (_session: unknown, proposalId: string) => {
          if (behavior.reviewOn === false) return undefined
          if (proposalId !== 'abc123def456') return { ok: false, reason: 'unknown-proposal' }
          return behavior.decideOutcome ?? { ok: true }
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

describe('review queue route registration', () => {
  it('registers both route prefixes only when the row opts in', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)

    apply(runtime, { reviewQueueRoute: true })
    await settle()

    expect(routes.map(route => route.path)).toEqual([
      LEGACY_QUEUE_ROUTE, QUEUE_ROUTE, LEGACY_DECIDE_ROUTE, DECIDE_ROUTE,
    ])

    const routesAfterOptOut: RegisteredRoute[] = []
    const plain = new Context()
    ctx = plain
    await mountWebServer(plain, routesAfterOptOut)
    apply(plain, { presetOverlay: false })
    await settle()
    expect(routesAfterOptOut).toHaveLength(0)
  })

  it('answers the queue read with a sanitized payload', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    mountReviewServices(runtime, { reviewOn: true })
    apply(runtime, { reviewQueueRoute: true })
    await settle()

    const route = routes.find(candidate => candidate.path === QUEUE_ROUTE)
    const response = await invoke(route as RegisteredRoute, { url: `${QUEUE_ROUTE}?sessionId=s1` })

    expect(response.status).toBe(200)
    const body = JSON.parse(String(response.body)) as {
      ok: boolean
      summary?: Record<string, number>
      pending: readonly { id: string, items: readonly Record<string, unknown>[] }[]
    }
    expect(body.ok).toBe(true)
    expect(body.pending).toHaveLength(1)
    expect(body.pending[0]!.id).toBe('abc123def456')
    expect(body.summary).toEqual({ autoApplied: 2, reviewApplied: 1, expired: 3, voided: 0 })
    // Digests never leave the runtime: the client only needs ids and counts.
    expect(String(response.body)).not.toContain('digest')
    expect(String(response.body)).not.toContain('"content"')
  })

  it('aggregates every live session when the read carries no sessionId', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    mountReviewServices(runtime, { reviewOn: true })
    apply(runtime, { reviewQueueRoute: true })
    await settle()

    const route = routes.find(candidate => candidate.path === QUEUE_ROUTE) as RegisteredRoute
    const response = await invoke(route, { url: QUEUE_ROUTE })

    expect(response.status).toBe(200)
    const body = JSON.parse(String(response.body)) as {
      ok: boolean
      total: number
      pending: readonly { sessionId: string, id: string }[]
    }
    expect(body).toMatchObject({ ok: true, total: 1 })
    expect(body.pending[0]).toMatchObject({ sessionId: 's1', id: 'abc123def456' })
  })

  it('rejects a queue read for an unknown session', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    mountReviewServices(runtime, { reviewOn: true })
    apply(runtime, { reviewQueueRoute: true })
    await settle()
    const route = routes.find(candidate => candidate.path === QUEUE_ROUTE) as RegisteredRoute

    const unknown = await invoke(route, { url: `${QUEUE_ROUTE}?sessionId=nope` })
    expect(unknown.status).toBe(404)
  })

  it('answers 503 when the pruner is not serving review proposals', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    apply(runtime, { reviewQueueRoute: true })
    await settle()

    const route = routes.find(candidate => candidate.path === QUEUE_ROUTE) as RegisteredRoute
    const response = await invoke(route, { url: `${QUEUE_ROUTE}?sessionId=s1` })
    expect(response.status).toBe(503)
  })

  it('rejects malformed decide bodies with 400', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    mountReviewServices(runtime, { reviewOn: true })
    apply(runtime, { reviewQueueRoute: true })
    await settle()
    const route = routes.find(candidate => candidate.path === DECIDE_ROUTE) as RegisteredRoute

    const notJson = await invoke(route, { on: (event: string, listener: (chunk?: Buffer) => void) => {
      if (event === 'end') listener()
    } })
    expect(notJson.status).toBe(400)

    const missingDecision = await invoke(route, { on: (event: string, listener: (chunk?: Buffer) => void) => {
      if (event === 'data') listener(Buffer.from(JSON.stringify({ sessionId: 's1', proposalId: 'abc123def456' })))
      if (event === 'end') listener()
    } })
    expect(missingDecision.status).toBe(400)

    const badDecision = await invoke(route, { on: (event: string, listener: (chunk?: Buffer) => void) => {
      if (event === 'data') listener(Buffer.from(JSON.stringify({ sessionId: 's1', proposalId: 'abc123def456', decision: 'maybe' })))
      if (event === 'end') listener()
    } })
    expect(badDecision.status).toBe(400)
  })

  it('maps decide outcomes to 200, 404, and 503', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    mountReviewServices(runtime, { reviewOn: true })
    apply(runtime, { reviewQueueRoute: true })
    await settle()
    const route = routes.find(candidate => candidate.path === DECIDE_ROUTE) as RegisteredRoute

    const post = (body: unknown): unknown => ({
      on: (event: string, listener: (chunk?: Buffer) => void) => {
        if (event === 'data') listener(Buffer.from(JSON.stringify(body)))
        if (event === 'end') listener()
      },
    })

    const ok = await invoke(route, post({ sessionId: 's1', proposalId: 'abc123def456', decision: 'approved' }))
    expect(ok.status).toBe(200)
    expect(JSON.parse(String(ok.body))).toMatchObject({ ok: true, decision: 'approved' })

    const unknownProposal = await invoke(route, post({ sessionId: 's1', proposalId: 'nope', decision: 'approved' }))
    expect(unknownProposal.status).toBe(404)

    const unknownSession = await invoke(route, post({ sessionId: 'nope', proposalId: 'abc123def456', decision: 'approved' }))
    expect(unknownSession.status).toBe(404)
  })

  it('answers 503 when review mode is off for the session', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)
    mountReviewServices(runtime, { reviewOn: false })
    apply(runtime, { reviewQueueRoute: true })
    await settle()

    const queueRoute = routes.find(candidate => candidate.path === QUEUE_ROUTE) as RegisteredRoute
    expect((await invoke(queueRoute, { url: `${QUEUE_ROUTE}?sessionId=s1` })).status).toBe(200)

    const decideRoute = routes.find(candidate => candidate.path === DECIDE_ROUTE) as RegisteredRoute
    const response = await invoke(decideRoute, {
      on: (event: string, listener: (chunk?: Buffer) => void) => {
        if (event === 'data') listener(Buffer.from(JSON.stringify({ sessionId: 's1', proposalId: 'abc123def456', decision: 'approved' })))
        if (event === 'end') listener()
      },
    })
    expect(response.status).toBe(503)
  })
})
