/**
 * Production-shaped guard for the review routes' pruner resolution.
 *
 * The older suite provided `toolResultPruner` at the TOP LEVEL, which is a shape
 * production never has: `canonicalCompressionRows()` mounts every pruner inside
 * an agent preset's isolated group, so a top-level `ctx.get('toolResultPruner')`
 * resolves nothing and the queue route answered 503 "review pipeline
 * unavailable" for every request while the pipeline itself ran normally.
 *
 * These cases mount NO top-level service and publish through the review registry
 * from a CHILD fiber instead — the path the fix relies on.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'
import { registerReviewPruner, type ReviewPrunerFace } from '../src/runtime/tokenpilot/review-registry.ts'

const QUEUE_ROUTE = '/api/dsh-context-compression-improved/review-queue'

interface RegisteredRoute {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => unknown
}

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20))

/** A pruner face carrying one pending proposal for session `s1`. */
const SAMPLE = {
  id: 'abc123def456',
  kind: 'read-state',
  items: [{ seq: 6, kind: 'read-state', component: 'history', tokensBefore: 2401, tokensAfter: 134 }],
  benefit: { recoveredTokens: 400, penaltyTokens: 900, paybackTurns: 2.25 },
  enqueuedTurn: 3,
  lastTurnIndex: 3,
} as const

function samplePruner(): ReviewPrunerFace {
  return {
    listReviewProposals: (session: unknown) => ((session as { id?: string }).id === 's1' ? [SAMPLE] : []),
    listAllReviewProposals: () => [{ sessionId: 's1', proposals: [SAMPLE] }],
    reviewSummary: () => ({ autoApplied: 2, reviewApplied: 1, expired: 3, voided: 0 }),
    decideReviewProposal: (_session: unknown, proposalId: string) => (proposalId === SAMPLE.id
      ? { ok: true }
      : { ok: false, reason: 'unknown-proposal' }),
  }
}

/** Mount the fake web server the routes register against. */
async function mountWebServer(runtime: Context, routes: RegisteredRoute[]): Promise<void> {
  await runtime.plugin({
    name: 'fake-webserver',
    apply(webCtx) {
      webCtx.provide('webServer', {
        tables: { exact: new Map<string, RegisteredRoute>() },
        register(this: { tables: { exact: Map<string, RegisteredRoute> } }, route: RegisteredRoute) {
          const table = this.tables.exact
          if (table.has(route.path)) throw new Error(`webserver: duplicate ${route.path}`)
          table.set(route.path, route)
          routes.push(route)
          return () => {}
        },
      })
    },
  })
}

/** Boot the host plugin with both routes opted in, as the Bundle row does. */
async function bootWithRoutes(): Promise<RegisteredRoute[]> {
  const routes: RegisteredRoute[] = []
  ctx = new Context()
  await mountWebServer(ctx, routes)
  apply(ctx, { estimatorCatalogRoute: true, reviewQueueRoute: true })
  await settle()
  return routes
}

async function readQueue(routes: RegisteredRoute[]): Promise<{ status: number, body: string }> {
  const route = routes.find(candidate => candidate.path === QUEUE_ROUTE)
  expect(route, `route ${QUEUE_ROUTE} must be registered`).toBeDefined()
  const captured: { status?: number, body?: string } = {}
  const res = {
    writeHead(code: number) { captured.status = code },
    end(body?: string) { captured.body = body },
  }
  await route!.handler({ url: QUEUE_ROUTE }, res)
  return { status: captured.status ?? 0, body: captured.body ?? '' }
}

describe('review routes resolve a preset-scoped pruner', () => {
  it('answers 503 while no pruner has been published', async () => {
    const routes = await bootWithRoutes()
    const { status, body } = await readQueue(routes)
    expect(status).toBe(503)
    expect(body).toContain('review pipeline unavailable')
  })

  it('reaches a pruner published from a CHILD fiber with no top-level service', async () => {
    const routes = await bootWithRoutes()
    // Production shape: the pruner is mounted in a preset's isolated group.
    await ctx!.plugin({
      name: 'preset-scoped-pruner',
      apply(childCtx) {
        childCtx.effect(() => registerReviewPruner(samplePruner()), 'test-preset-pruner')
      },
    })
    await settle()

    const { status, body } = await readQueue(routes)
    expect(status).toBe(200)
    const parsed = JSON.parse(body) as { ok: boolean, total: number, pending: readonly { id: string }[] }
    expect(parsed.ok).toBe(true)
    expect(parsed.total).toBe(1)
    expect(parsed.pending[0]?.id).toBe(SAMPLE.id)
  })

  it('drops back to 503 once the publishing fiber disposes', async () => {
    const routes = await bootWithRoutes()
    const fork = await ctx!.plugin({
      name: 'preset-scoped-pruner',
      apply(childCtx) {
        childCtx.effect(() => registerReviewPruner(samplePruner()), 'test-preset-pruner')
      },
    })
    await settle()
    expect((await readQueue(routes)).status).toBe(200)

    await fork.dispose()
    await settle()
    expect((await readQueue(routes)).status).toBe(503)
  })
})
