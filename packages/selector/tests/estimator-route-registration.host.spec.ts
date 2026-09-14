/**
 * Host-side guard for the estimator catalog route.
 *
 * The defect this pins is a registration that never happens: the injection gate
 * asked for more services than the handler needs, and an unsatisfied
 * `ctx.inject` callback fails silently, so the plugin simply had no HTTP API
 * and every request fell through to the host 404. These cases assert the two
 * properties that failure violated — the route appears whenever `webServer` is
 * usable, in either arrival order, and its absence is never silent.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'

const CATALOG_ROUTE = '/api/dsh-context-compression-improved/estimator-catalog'
const LEGACY_ROUTE = '/endpoint/dsh-context-compression-improved/estimator-catalog'

interface RegisteredRoute {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => void
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

/** Settle one macrotask so a deferred activation callback can run. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20))

/**
 * Mount a host web server stand-in that records routes and reproduces the real
 * host's duplicate-`(kind, path)` contract, so a double registration is a
 * failure rather than a silent overwrite.
 */
async function mountWebServer(runtime: Context, routes: RegisteredRoute[]): Promise<void> {
  await runtime.plugin({
    name: 'fake-webserver',
    apply(webCtx) {
      webCtx.provide('webServer', {
        register(route: RegisteredRoute) {
          if (routes.some(existing => existing.kind === route.kind && existing.path === route.path)) {
            throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
          }
          routes.push(route)
          return () => {}
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

/** Drive one registered route through a stand-in response. */
async function invoke(route: RegisteredRoute): Promise<FakeResponse> {
  const captured: FakeResponse = {}
  const res = {
    writeHead(code: number) { captured.status = code },
    end(body?: string) { captured.body = body },
  }
  route.handler({ method: 'GET' }, res)
  await settle()
  return captured
}

describe('estimator catalog route registration', () => {
  it('registers both route prefixes with only webServer present', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)

    apply(runtime, {})
    await settle()

    expect(routes.map(route => route.path)).toEqual([LEGACY_ROUTE, CATALOG_ROUTE])
    expect(routes.every(route => route.kind === 'exact')).toBe(true)
  })

  it('registers the route when webServer activates after the plugin applied', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime

    apply(runtime, {})
    await settle()
    expect(routes).toHaveLength(0)

    await mountWebServer(runtime, routes)
    await settle()

    expect(routes.map(route => route.path)).toEqual([LEGACY_ROUTE, CATALOG_ROUTE])
  })

  it('registers nothing twice when the estimator services arrive later', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)

    apply(runtime, {})
    await settle()
    const afterRegistration = routes.length

    await mountEstimatorServices(runtime)
    await settle()

    expect(routes).toHaveLength(afterRegistration)
  })

  it('keeps the rest of the plugin alive and warns when webServer never arrives', async () => {
    const runtime = new Context()
    ctx = runtime
    const warn = vi.spyOn(
      runtime.logger as unknown as { warn: (...args: unknown[]) => void },
      'warn',
    )

    expect(() => apply(runtime, {})).not.toThrow()
    await settle()

    const messages = warn.mock.calls.map(([message]) => String(message))
    expect(messages.some(message => message.includes('estimator catalog route pending'))).toBe(true)
  })

  it('answers 200 without the estimator services, which only enrich the payload', async () => {
    const routes: RegisteredRoute[] = []
    const runtime = new Context()
    ctx = runtime
    await mountWebServer(runtime, routes)

    apply(runtime, {})
    await settle()

    const route = routes.find(candidate => candidate.path === CATALOG_ROUTE)
    expect(route).toBeDefined()
    const response = await invoke(route as RegisteredRoute)

    expect(response.status).toBe(200)
    expect(JSON.parse(String(response.body))).toMatchObject({ ok: true, providers: [] })
  })
})
