/** Host owner of the context-compression preference consumed by the browser selector. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  type SettingsScope,
  type default as SettingsService,
} from '@deepseek-ai/dsh-settings'
import { buildEstimatorCatalog, type EstimatorCatalogDeps } from './estimator-catalog.ts'
import {
  CONTEXT_COMPRESSION_SETTINGS_NAMESPACE,
  ContextCompressionSettingsSchema,
} from './runtime/config.ts'
import { resolveReviewPruner, type ReviewPrunerFace } from './runtime/tokenpilot/review-registry.ts'
import { getAdvisorState } from './runtime/tokenpilot/advisor-state.ts'

// The settings namespace literal and the settings schema are owned by the
// runtime config module. Both were once inlined/replaced here to dodge a
// cross-package dependency (ab2175a: the namespace literal was duplicated and
// the schema was downgraded to `z.any()`); the runtime is now part of this
// package, so the real schema is back and the daily Custom defaults are
// published again through settings.register(). The namespace value is
// unchanged ('context-compression').
const CONTEXT_COMPRESSION_NAMESPACE = CONTEXT_COMPRESSION_SETTINGS_NAMESPACE as never
import {
  decorateAgentPresets,
  resolveCompressionModulePaths,
} from './preset-overlay.ts'

// 0.1.1/0.1.2 clients ask for /endpoint; 0.1.5 and later ask for /api. Both
// absolute paths are registered (each is its own (kind, path) table entry) and
// one handler serves both prefixes. The bundled client only probes /api.
const ESTIMATOR_CATALOG_ROUTES = [
  '/endpoint/dsh-context-compression-improved/estimator-catalog',
  '/api/dsh-context-compression-improved/estimator-catalog',
] as const

// TokenPilot-inspired R4: the review pipeline's client↔runtime channel, dual
// prefixed like the catalog route so 0.1.2 clients keep working.
const REVIEW_QUEUE_ROUTES = [
  '/endpoint/dsh-context-compression-improved/review-queue',
  '/api/dsh-context-compression-improved/review-queue',
] as const
const REVIEW_DECIDE_ROUTES = [
  '/endpoint/dsh-context-compression-improved/review-decide',
  '/api/dsh-context-compression-improved/review-decide',
] as const

// Advisory advisor: one read-only report route, dual prefixed like the others.
const ADVISOR_REPORT_ROUTES = [
  '/endpoint/dsh-context-compression-improved/advisor-report',
  '/api/dsh-context-compression-improved/advisor-report',
] as const

/**
 * The review faces of the pruner service the routes consume. Owned by the
 * review registry, which the routes also fall back to when no top-level
 * `toolResultPruner` service exists — the preset-scoped case in production.
 */
type ReviewPrunerLike = ReviewPrunerFace

/** Minimal face of the agents service: session id → agent (carrying the session). */
interface AgentsServiceLike {
  get?(id: unknown): { session?: unknown } | undefined
}

/**
 * Resolve the review pipeline for the top-level routes.
 *
 * A top-level `toolResultPruner` service wins when a deployment actually mounts
 * one, but in production every pruner lives inside an agent preset's isolated
 * group, so the registry is the path that resolves. Without the fallback the
 * queue route answered 503 "review pipeline unavailable" on every request while
 * the review pipeline itself was running normally.
 */
function reviewPrunerOf(readService: (name: string) => unknown): ReviewPrunerLike | undefined {
  const candidate = readService('toolResultPruner') as {
    listReviewProposals?: unknown
    decideReviewProposal?: unknown
  } | undefined
  if (typeof candidate?.listReviewProposals === 'function'
    && typeof candidate?.decideReviewProposal === 'function') {
    return candidate as unknown as ReviewPrunerLike
  }
  return resolveReviewPruner()
}

function sessionFor(readService: (name: string) => unknown, sessionId: string): unknown {
  const agents = readService('agents') as AgentsServiceLike | undefined
  return typeof agents?.get === 'function' ? agents.get(sessionId)?.session : undefined
}

function reviewJson(res: unknown, status: number, body: unknown): void {
  const resTyped = res as {
    writeHead: (code: number, headers?: Record<string, string>) => void
    end: (body?: string) => void
  }
  resTyped.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  resTyped.end(JSON.stringify(body))
}

function readRequestBody(req: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const typed = req as {
      on?: (event: string, listener: (chunk?: Buffer) => void) => void
    }
    let data = ''
    try {
      typed.on?.('data', chunk => {
        data += String(chunk ?? '')
        if (data.length > 64 * 1024) {
          data = ''
          resolve('')
        }
      })
      typed.on?.('end', () => resolve(data))
      typed.on?.('error', reject)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/**
 * Serve the review pipeline's two HTTP routes (best effort, mirroring the
 * estimator-catalog registration):
 *
 * - `GET .../review-queue?sessionId=…` → the session's pending proposals with
 *   their benefit numbers. Sanitized by construction: the queue never holds
 *   message content, and the response carries ids/seqs/counts only (digests
 *   stay in the runtime — the client cannot need them).
 * - `POST .../review-decide` `{sessionId, proposalId, decision}` → one human
 *   decision. Invalid body → 400; unknown/not-pending proposal → 404; review
 *   mode off for the session → 503.
 */
function registerReviewQueueRoutes(ctx: Context): void {
  const readService = (name: string): unknown => {
    try {
      return (ctx as unknown as { get: (service: string) => unknown }).get(name)
    } catch {
      return undefined
    }
  }
  const log = (level: 'info' | 'warn', message: string, ...args: unknown[]): void => {
    console[level](message, ...args)
  }
  const registered = (): void => {
    log('info', 'context-compression review queue routes registered: %s / %s', REVIEW_QUEUE_ROUTES.join(', '), REVIEW_DECIDE_ROUTES.join(', '))
  }

  type SanitizedProposal = {
    sessionId: string
    id: string
    kind: string
    items: readonly { seq: number, kind: string, component: string, tokensBefore: number, tokensAfter: number }[]
    benefit: {
      recoveredTokens: number
      penaltyTokens: number
      paybackTurns?: number
      expectedSaving?: number
    }
    enqueuedTurn: number
    lastTurnIndex: number
  }

  const getHandler = (req: unknown, res: unknown): void => {
    const pruner = reviewPrunerOf(readService)
    if (pruner === undefined || pruner.listAllReviewProposals === undefined) {
      reviewJson(res, 503, { ok: false, error: 'review pipeline unavailable' })
      return
    }
    let sessionId = ''
    try {
      const url = new URL(String((req as { url?: string }).url ?? ''), 'http://localhost')
      sessionId = url.searchParams.get('sessionId') ?? ''
    } catch {
      sessionId = ''
    }
    const sanitize = (
      sid: string,
      proposal: {
        id: string
        kind: string
        items: readonly { seq: number, kind: string, component: string, tokensBefore: number, tokensAfter: number }[]
        benefit: { recoveredTokens: number, penaltyTokens: number, paybackTurns?: number, expectedSaving?: number }
        enqueuedTurn: number
        lastTurnIndex: number
      },
    ): SanitizedProposal => ({
      sessionId: sid,
      id: proposal.id,
      kind: proposal.kind,
      items: proposal.items.map(item => ({
        seq: item.seq,
        kind: item.kind,
        component: item.component,
        tokensBefore: item.tokensBefore,
        tokensAfter: item.tokensAfter,
      })),
      benefit: {
        recoveredTokens: proposal.benefit.recoveredTokens,
        penaltyTokens: proposal.benefit.penaltyTokens,
        ...(proposal.benefit.paybackTurns === undefined ? {} : { paybackTurns: proposal.benefit.paybackTurns }),
        ...(proposal.benefit.expectedSaving === undefined ? {} : { expectedSaving: proposal.benefit.expectedSaving }),
      },
      enqueuedTurn: proposal.enqueuedTurn,
      lastTurnIndex: proposal.lastTurnIndex,
    })

    // Without a sessionId the read aggregates every session with live
    // proposals — the client carries no session id of its own.
    if (sessionId === '') {
      const pending = pruner.listAllReviewProposals()
        .flatMap(entry => entry.proposals.map(proposal => sanitize(entry.sessionId, proposal)))
      reviewJson(res, 200, { ok: true, total: pending.length, pending })
      return
    }

    const session = sessionFor(readService, sessionId)
    if (session === undefined) {
      reviewJson(res, 404, { ok: false, error: 'unknown session' })
      return
    }
    const pending = pruner.listReviewProposals(session).map(proposal => sanitize(sessionId, proposal))
    const summary = pruner.reviewSummary?.(session)
    reviewJson(res, 200, {
      ok: true,
      sessionId,
      total: pending.length,
      pending,
      ...(summary === undefined ? {} : { summary }),
    })
  }

  const decideHandler = async (req: unknown, res: unknown): Promise<void> => {
    const pruner = reviewPrunerOf(readService)
    if (pruner === undefined) {
      reviewJson(res, 503, { ok: false, error: 'review pipeline unavailable' })
      return
    }
    let body: unknown
    try {
      body = JSON.parse(await readRequestBody(req))
    } catch {
      body = undefined
    }
    if (typeof body !== 'object' || body === null) {
      reviewJson(res, 400, { ok: false, error: 'invalid JSON body' })
      return
    }
    const record = body as { sessionId?: unknown, proposalId?: unknown, decision?: unknown }
    if (typeof record.sessionId !== 'string' || record.sessionId === ''
      || typeof record.proposalId !== 'string' || record.proposalId === '') {
      reviewJson(res, 400, { ok: false, error: 'sessionId and proposalId are required' })
      return
    }
    if (record.decision !== 'approved' && record.decision !== 'rejected' && record.decision !== 'ignored') {
      reviewJson(res, 400, { ok: false, error: 'decision must be approved, rejected, or ignored' })
      return
    }
    const session = sessionFor(readService, record.sessionId)
    if (session === undefined) {
      reviewJson(res, 404, { ok: false, error: 'unknown session' })
      return
    }
    const outcome = pruner.decideReviewProposal(session, record.proposalId, record.decision)
    if (outcome === undefined) {
      reviewJson(res, 503, { ok: false, error: 'review mode is off for this session' })
      return
    }
    if (!outcome.ok) {
      reviewJson(res, 404, { ok: false, error: outcome.reason })
      return
    }
    reviewJson(res, 200, { ok: true, sessionId: record.sessionId, proposalId: record.proposalId, decision: record.decision })
  }

  const register = (webServer: WebServerLike): void => {
    const table: ReadonlyArray<{ path: string, handler: (req: unknown, res: unknown) => unknown }> = [
      ...[...REVIEW_QUEUE_ROUTES].map(path => ({ path, handler: getHandler })),
      ...[...REVIEW_DECIDE_ROUTES].map(path => ({ path, handler: (req: unknown, res: unknown) => { void decideHandler(req, res) } })),
    ]
    const disposers = table
      .map(entry => webServer.register({ kind: 'exact', path: entry.path, handler: entry.handler }))
      .filter((off): off is () => void => typeof off === 'function')
    ctx.effect(
      () => () => { for (const off of disposers) off() },
      'contextCompressionSelector.review routes',
    )
    registered()
  }

  const active = asWebServer(readService('webServer'))
  if (active !== undefined) {
    register(active)
    return
  }

  ctx.inject(['webServer'], (injected) => {
    const webServer = asWebServer((injected as { webServer?: unknown }).webServer)
    if (webServer === undefined) {
      log('warn', 'context-compression webServer exposes no register() — review routes not registered')
      return
    }
    register(webServer)
  })

  log('warn', 'context-compression webServer not active yet — review routes pending: %s', REVIEW_QUEUE_ROUTES.join(', '))
}

/**
 * Serve the advisory advisor's read-only report route (same registration
 * skeleton as the review routes):
 *
 * `GET .../advisor-report?sessionId=…` → the session's prefix-decay figure,
 * the todolist-bound task summary, and the score distribution. Content-free
 * by construction: task semantics are LLM-derived summaries, never message
 * text, and no score reason or candidate preview is ever returned.
 * Unknown session → 404; no agents service → 503. A session whose advisor
 * never ran reports nulls and empty arrays, not an error.
 */
function registerAdvisorReportRoute(ctx: Context): void {
  const readService = (name: string): unknown => {
    try {
      return (ctx as unknown as { get: (service: string) => unknown }).get(name)
    } catch {
      return undefined
    }
  }
  const log = (level: 'info' | 'warn', message: string, ...args: unknown[]): void => {
    console[level](message, ...args)
  }

  const getHandler = (req: unknown, res: unknown): void => {
    const agents = readService('agents') as AgentsServiceLike | undefined
    if (typeof agents?.get !== 'function') {
      reviewJson(res, 503, { ok: false, error: 'advisor report unavailable' })
      return
    }
    let sessionId = ''
    try {
      const url = new URL(String((req as { url?: string }).url ?? ''), 'http://localhost')
      sessionId = url.searchParams.get('sessionId') ?? ''
    } catch {
      // Malformed URL: fall through with the empty sessionId already set.
    }
    if (sessionId === '') {
      reviewJson(res, 400, { ok: false, error: 'sessionId is required' })
      return
    }
    const session = sessionFor(readService, sessionId)
    if (session === undefined) {
      reviewJson(res, 404, { ok: false, error: 'unknown session' })
      return
    }
    const state = getAdvisorState(session as Parameters<typeof getAdvisorState>[0])
    reviewJson(res, 200, {
      ok: true,
      sessionId,
      advisor: {
        summary: state.summary ?? null,
        decay: state.lastDecay?.decay ?? null,
        weightedChars: state.lastDecay?.weightedChars ?? null,
        decayTurn: state.lastDecay?.turn ?? null,
        scores: [...state.scores].map(([seq, entry]) => ({ seq, score: entry.score, turn: entry.turn })),
        lowRelevanceSeqs: [...state.recertified.keys()],
      },
    })
  }

  const register = (webServer: WebServerLike): void => {
    const table = [...ADVISOR_REPORT_ROUTES].map(path => ({ path, handler: getHandler }))
    const disposers = table
      .map(entry => webServer.register({ kind: 'exact', path: entry.path, handler: entry.handler }))
      .filter((off): off is () => void => typeof off === 'function')
    ctx.effect(
      () => () => { for (const off of disposers) off() },
      'contextCompressionSelector.advisor report route',
    )
    log('info', 'context-compression advisor report route registered: %s', ADVISOR_REPORT_ROUTES.join(', '))
  }

  const active = asWebServer(readService('webServer'))
  if (active !== undefined) {
    register(active)
    return
  }

  ctx.inject(['webServer'], (injected) => {
    const webServer = asWebServer((injected as { webServer?: unknown }).webServer)
    if (webServer === undefined) {
      log('warn', 'context-compression webServer exposes no register() — advisor report route not registered')
      return
    }
    register(webServer)
  })

  log('warn', 'context-compression webServer not active yet — advisor report route pending: %s', ADVISOR_REPORT_ROUTES.join(', '))
}

/**
 * The one service the catalog route actually needs. `llm` and
 * `agentDefaultModel` are payload enrichment the handler resolves per request,
 * never reasons to withhold the route.
 */
const ESTIMATOR_CATALOG_ROUTE_DEPS: readonly ['webServer'] = ['webServer']

/** The minimal face of the DSH `webServer` service this plugin uses. */
interface WebServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: unknown, res: unknown) => unknown
  }): () => void
}

/** The estimator-side service the catalog handler enriches its response with. */
interface AgentDefaultModelLike {
  /** Current host model-group selection, when the service exposes one. */
  currentSelection?: () => { provider?: unknown, model?: unknown } | undefined
}

function asWebServer(value: unknown): WebServerLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { register?: unknown }
  // Hand back the service itself -- never a wrapper re-exporting `register`.
  // The host reads its route tables off `this` (`this.exact` / `this.prefixes`),
  // so a detached call makes `this` the wrapper and throws "Cannot read
  // properties of undefined (reading 'has')" inside the host, after which the
  // route is simply absent and the client sees a bare 404. The 0.1.5 branch
  // never had that defect; take this implementation, not the 0.1.2 history's.
  return typeof candidate.register === 'function' ? (value as WebServerLike) : undefined
}

/**
 * Serve `GET /api/dsh-context-compression-improved/estimator-catalog` — the
 * settings card's host-route dropdowns (live provider/model groups from the DSH
 * `llm` service plus the effective selection). Best effort: without the
 * `webServer` service the plugin keeps working, only the HTTP API is missing.
 *
 * The route gates on `webServer` **alone**. `llm` and `agentDefaultModel` only
 * enrich the response and are resolved per request, so listing them here would
 * let an estimator-side service the handler never needs keep the route
 * unregistered. That failure is silent by construction — an unsatisfied
 * `ctx.inject` callback never runs, so the plugin simply has no HTTP API and
 * every request falls through to the host 404.
 *
 * Two channels cover the two arrival orders: a direct lookup catches a
 * `webServer` that is already active when the plugin loads, and `ctx.inject`
 * catches one that activates later. Both funnel into a single guarded
 * registration, because a late-arriving service must not re-register a
 * `(kind, path)` the host treats as a composition-contract violation.
 */
function registerEstimatorCatalogRoute(ctx: Context): void {
  const readService = (name: string): unknown => {
    try {
      return (ctx as unknown as { get: (service: string) => unknown }).get(name)
    } catch {
      return undefined
    }
  }
  // `console`, not `ctx.logger`: measured on the 0.1.2 host, the cordis logger
  // surfaces no plugin output in the `dsh web` terminal at all — a full boot
  // produced zero plugin log lines while the process itself stayed chatty — so
  // a lifecycle diagnostic published there is unobservable. `dsh-perm-gate`
  // uses `console.warn` for the same message class on the same host.
  const log = (level: 'info' | 'warn', message: string, ...args: unknown[]): void => {
    console[level](message, ...args)
  }

  let registered = false
  const register = (webServer: WebServerLike, channel: 'direct' | 'inject'): void => {
    if (registered) return
    const handler = (_req: unknown, res: unknown): void => {
      const resTyped = res as {
        writeHead: (code: number, headers?: Record<string, string>) => void
        end: (body?: string) => void
      }
      if (typeof resTyped?.writeHead !== 'function' || typeof resTyped?.end !== 'function') return
      const llm = readService('llm')
      const defaults = readService('agentDefaultModel') as AgentDefaultModelLike | undefined
      const deps: EstimatorCatalogDeps = {
        ...(llm === undefined
          ? {}
          : { llm: llm as NonNullable<EstimatorCatalogDeps['llm']> }),
        ...(typeof defaults?.currentSelection === 'function'
          ? { currentSelection: () => defaults.currentSelection?.() }
          : {}),
      }
      buildEstimatorCatalog(deps).then(
        catalog => {
          resTyped.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          resTyped.end(JSON.stringify({ ok: true, ...catalog }))
        },
        (error: unknown) => {
          resTyped.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          resTyped.end(JSON.stringify({ ok: false, error: String((error as Error)?.message ?? error) }))
        },
      )
    }
    try {
      const disposers = ESTIMATOR_CATALOG_ROUTES
        .map(path => webServer.register({ kind: 'exact', path, handler }))
        .filter((off): off is () => void => typeof off === 'function')
      registered = true
      ctx.effect(
        () => () => { for (const off of disposers) off() },
        'contextCompressionSelector.estimator-catalog route',
      )
      log('info', 'context-compression estimator catalog route registered (%s): %s', channel, ESTIMATOR_CATALOG_ROUTES.join(', '))
    } catch (error) {
      log('warn', 'context-compression estimator catalog route registration failed (%s): %o', channel, error)
    }
  }

  const active = asWebServer(readService('webServer'))
  if (active !== undefined) {
    register(active, 'direct')
    if (registered) return
  }

  ctx.inject([...ESTIMATOR_CATALOG_ROUTE_DEPS], (injected) => {
    const webServer = asWebServer((injected as { webServer?: unknown }).webServer)
    if (webServer === undefined) {
      log('warn', 'context-compression webServer exposes no register() — estimator catalog route not registered')
      return
    }
    register(webServer, 'inject')
  })

  log('warn', 'context-compression webServer not active yet — estimator catalog route pending: %s', ESTIMATOR_CATALOG_ROUTES.join(', '))
}



/** Shared state forwarded through every Cordis proxy of one settings service. */
interface SharedSettingsRegistration {
  /** Plugin fibers currently leasing the namespace. */
  readonly owners: Set<SettingsOwner>
  /** Owner whose fiber currently carries settings.register's native effect. */
  registrationOwner: SettingsOwner
  /** Current owner scope; replaced without changing the stored document. */
  scope: SettingsScope<unknown>
}

/** One selector Host row able to own the registration effect. */
interface SettingsOwner {
  /** Traceable service proxy binding register() to this row's fiber. */
  readonly settings: SettingsService
}

/** Symbol properties reach the shared service target through Cordis proxies. */
const SHARED_SETTINGS = Symbol.for(
  'dsh-context-compression-improved/settings-registration',
)

type SettingsCarrier = SettingsService & {
  [SHARED_SETTINGS]?: SharedSettingsRegistration
}

/** Standalone Bundle behavior; the settings/UI owner remains safe when false. */
export interface Config {
  /** Add the canonical compression stack to every non-Minimal preset. */
  presetOverlay?: boolean
  /**
   * Register the estimator-catalog HTTP route on this row.
   *
   * The standalone Bundle patch sets this on its own row (which declares
   * `inject: [webServer]`), so profiles without a host web server never mount a
   * row that could only announce a pending route. The row-level `inject` is
   * belt-and-braces: `dsh-host-webserver.register` performs no authorization
   * check and `ctx.get(name)` only asks whether the providing fiber is active,
   * so the two-channel registration inside this function is what actually
   * covers both arrival orders.
   */
  estimatorCatalogRoute?: boolean
  /**
   * Register the review pipeline's HTTP routes (pending-queue read + decide
   * write) on this row. Same Bundle opt-in semantics as
   * `estimatorCatalogRoute`; without the routes the floating window has no
   * transport and simply never appears.
   */
  reviewQueueRoute?: boolean
  /**
   * Register the advisory advisor's read-only HTTP report route (decay
   * figure, task summary, score distribution). Same Bundle opt-in semantics
   * as `reviewQueueRoute`; the advisor itself stays off until the user turns
   * it on through the `presetOptions.advisor*` settings keys.
   */
  advisorReportRoute?: boolean
}

/** Loader validation for the standalone Bundle opt-in. */
export const Config: z<Config> = z.object({
  presetOverlay: z.boolean().default(false),
  estimatorCatalogRoute: z.boolean().default(false),
  reviewQueueRoute: z.boolean().default(false),
  advisorReportRoute: z.boolean().default(false),
})

/** Register the persisted default read by the currently mounted root pruner. */
export function apply(ctx: Context, config: Config = {}): void {
  // Measured on the 0.1.2 host: a plugin-load failure surfaces only through the
  // cordis logger, which prints nothing in the `dsh web` terminal — so a throw
  // here is completely invisible and looks exactly like a plugin that loaded
  // and quietly did nothing. Report it to a sink the host shows, then re-throw
  // unchanged: behaviour is untouched, only observability is restored.
  try {
    ctx.inject(['settings'], (settingsCtx) => {
      acquireSettingsRegistration(settingsCtx)
    })

    // The settings card's host-route dropdowns read this route; it lives on the
    // top-level plugin fiber, not inside the isolated `toolResultPruner`
    // service, because the route is host-wide rather than per-pruner-instance.
    if (config.estimatorCatalogRoute === true) registerEstimatorCatalogRoute(ctx)

    // TokenPilot-inspired R4: the review pipeline's client transport (see the
    // config JSDoc for the opt-in semantics).
    if (config.reviewQueueRoute === true) registerReviewQueueRoutes(ctx)

    // Advisory advisor: read-only decay/score report (opt-in, like review).
    if (config.advisorReportRoute === true) registerAdvisorReportRoute(ctx)

    if (config.presetOverlay !== true) return

    ctx.inject(['agentPresets'], (presetsCtx) => {
      const installation = decorateAgentPresets(
        presetsCtx.agentPresets,
        {
          modules: resolveCompressionModulePaths(),
          excludedPresetIds: ['minimal'],
          autoCompactThresholdPercent: () => resolveAutoCompactThresholdPercent(presetsCtx),
        },
      )
      presetsCtx.effect(() => () => installation.dispose(), 'contextCompressionSelector.agentPresets()')
    })
  } catch (error) {
    console.error('context-compression selector apply failed: %o', error)
    throw error
  }
}

/**
 * Read the current Auto Compact threshold ratio at composition time. Settings
 * values are revalidated here, and any unreadable value falls back to the 80%
 * default rather than blocking preset composition.
 */
function resolveAutoCompactThresholdPercent(presetsCtx: Context): number {
  const raw = presetsCtx.get('settings')?.get(CONTEXT_COMPRESSION_NAMESPACE)
  try {
    const record = structuredClone(raw) as Record<string, unknown> | undefined
    const threshold = record?.autoCompact as { thresholdPercent?: number } | undefined
    const value = typeof threshold?.thresholdPercent === 'number' ? threshold.thresholdPercent : 80
    return Number.isFinite(value) && value >= 50 && value <= 90 ? value : 80
  } catch {
    return 80
  }
}

/**
 * Lease one native settings registration across duplicate Host rows.
 *
 * The lease effect is intentionally registered before settings.register().
 * Cordis disposes effects in reverse order, so the native registration first
 * releases the namespace; this disposer can then transfer it to another live
 * owner without a duplicate-registration window.
 */
function acquireSettingsRegistration(ctx: Context): void {
  const settings = ctx.settings as SettingsCarrier
  const owner: SettingsOwner = { settings }
  let shared = settings[SHARED_SETTINGS]
  if (shared === undefined) {
    shared = {
      owners: new Set(),
      registrationOwner: owner,
      scope: undefined as unknown as SettingsScope<unknown>,
    }
    Object.defineProperty(settings, SHARED_SETTINGS, {
      configurable: true,
      enumerable: false,
      writable: false,
      value: shared,
    })
  }
  shared.owners.add(owner)
  const state = shared

  ctx.effect(() => () => {
    state.owners.delete(owner)
    if (state.registrationOwner === owner && state.owners.size > 0) {
      const next = state.owners.values().next().value as SettingsOwner
      state.registrationOwner = next
      state.scope = next.settings.register(
        CONTEXT_COMPRESSION_NAMESPACE,
        ContextCompressionSettingsSchema,
      )
    }
    if (state.owners.size === 0 && settings[SHARED_SETTINGS] === state) {
      Reflect.deleteProperty(settings, SHARED_SETTINGS)
    }
  }, 'contextCompressionSelector.settingsLease()')

  if (state.owners.size === 1) {
    state.scope = settings.register(
      CONTEXT_COMPRESSION_NAMESPACE,
      ContextCompressionSettingsSchema,
    )
  }
}
