/**
 * Host-side guard for the estimator catalog route.
 *
 * The defect this pins is a route that never exists: the plugin reached for the
 * raw `webServer` service, which the host never intended a plugin to resolve,
 * and an unsatisfied `ctx.inject` callback fails silently — so the plugin simply
 * had no HTTP API and every request fell through to the host 404.
 *
 * These cases assert the two properties that failure violated: the route
 * appears whenever `connection` is usable, in either arrival order, and its
 * absence is never silent.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

const CATALOG_ROUTE = '/api/dsh-context-compression-improved/estimator-catalog'

interface RegisteredRoute {
  path: string
  methods: readonly string[]
  fetch: (request: Request) => Promise<Response> | Response
}

interface RouteOutcome {
  status: number
  body: string
}

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

/** Settle one macrotask so a deferred activation callback can run. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20))

/**
 * Mount a host Connection stand-in that records routes and reproduces the real
 * service's duplicate-path contract, so a double registration is a failure
 * rather than a silent overwrite.
 */
async function mountConnection(runtime: Context, routes: RegisteredRoute[]): Promise<void> {
  await runtime.plugin({
    name: 'fake-connection',
    apply(connectionCtx) {
      connectionCtx.provide('connection', {
        fetch: {
          register(route: RegisteredRoute) {
            if (routes.some(existing => existing.path === route.path)) {
              throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`)
            }
            routes.push(route)
            return () => {}
          },
        },
      })
    },
  })
}

/** Mount the estimator-side services the handler only enriches its payload with. */
async function mountEstimatorServices(runtime: Context): Promise<void> {
  await runtime.plugin({
    name: 'fake-estimator-services',
    apply(estimatorCtx) {
      estimatorCtx.provide('llm', { listProviders: () => [] })
      estimatorCtx.provide('agentDefaultModel', { currentSelection: () => undefined })
    },
  })
}

/** Drive one registered route through a stand-in request. */
async function invoke(route: RegisteredRoute): Promise<RouteOutcome> {
  const response = await route.fetch(new Request(`http://127.0.0.1${route.path}`, { method: 'GET' }))
  return { status: response.status, body: await response.text() }
}

describe('estimator catalog route registration', () => {
  it('registers the catalog path on the connection Fetch surface', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountConnection(runtime, routes)

    apply(runtime, {})
    await settle()

    expect(routes.map(route => route.path)).toEqual([CATALOG_ROUTE])
    expect(routes[0]?.methods).toEqual(['GET'])
  })

  it('registers the route when connection activates after the plugin applied', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime

    apply(runtime, {})
    await settle()
    expect(routes).toHaveLength(0)

    await mountConnection(runtime, routes)
    await settle()

    expect(routes.map(route => route.path)).toEqual([CATALOG_ROUTE])
  })

  it('registers nothing twice when the estimator services arrive later', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountConnection(runtime, routes)

    apply(runtime, {})
    await settle()
    const afterRegistration = routes.length

    await mountEstimatorServices(runtime)
    await settle()

    expect(routes).toHaveLength(afterRegistration)
  })

  it('keeps the rest of the plugin alive and warns when connection never arrives', async () => {
    const runtime = new Context()
    ctx = runtime
    // The diagnostic goes to `console`: the host's cordis logger surfaces no
    // plugin output at all, so a lifecycle line published there is invisible.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(() => apply(runtime, {})).not.toThrow()
      await settle()

      const messages = warn.mock.calls.map(([message]) => String(message))
      expect(messages.some(message => message.includes('estimator catalog route pending'))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('answers 200 without the estimator services, which only enrich the payload', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountConnection(runtime, routes)

    apply(runtime, {})
    await settle()

    const route = routes.find(candidate => candidate.path === CATALOG_ROUTE)
    expect(route).toBeDefined()
    const outcome = await invoke(route as RegisteredRoute)

    expect(outcome.status).toBe(200)
    expect(JSON.parse(outcome.body)).toMatchObject({ ok: true, providers: [] })
  })
})
