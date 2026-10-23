/** Host owner of the context-compression preference consumed by the browser selector. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { buildEstimatorCatalog, type EstimatorCatalogDeps } from './estimator-catalog.ts'
import { getSavingsLedger } from './runtime/savings.ts'
import {
  applySessionOverride,
  buildMonitorSnapshot,
  drsTotalsFragment,
  estimateSavingsPricing,
  isSessionOverrideAction,
  mergeCompositionByComponent,
  type AgentDefaultModelLike,
} from './runtime/monitor.ts'
import { readDrsSessionIndex } from './runtime/savings-verify.ts'
import type { ContextCompressionSettings } from './profiles.ts'
import {
  CONTEXT_COMPRESSION_SETTINGS_NAMESPACE,
  DEFAULT_CONTEXT_COMPRESSION_SETTINGS,
} from './runtime/config.ts'

import { getAdvisorState } from './runtime/tokenpilot/advisor-state.ts'
import { registerSummaryCommand } from './runtime/summary-command.ts'
import { wireSettingsBridge } from './settings-bridge.ts'
import { closeStatsStore, ensureStatsStore, getStatsStore, statsPersistenceState } from './runtime/stats-db.ts'
import { cancelPendingUsageFlushes, getStatsActiveSessionId } from './runtime/stats-sync.ts'
import { configureStatsBackfillTrigger, kickStatsBackfillOnRouteHit } from './runtime/stats-backfill.ts'
import { getDisplayPrefs } from './runtime/display-prefs.ts'
import { estimateIntegralMoney } from './runtime/savings-integral.ts'
import { registerPanelCommand } from './runtime/panel-command.ts'
import { resolveOfficialDeepSeekPrice, type OfficialDeepSeekPriceRecord } from './runtime/deepseek-official-pricing.ts'

// The settings namespace literal and the settings schema are owned by the
// runtime config module. Both were once inlined/replaced here to dodge a
// cross-package dependency (ab2175a: the namespace literal was duplicated and
// the schema was downgraded to `z.any()`); the runtime is now part of this
// package, so the real schema is back and the daily Custom defaults are
// published again through settings.register(). The namespace value is
// unchanged ('context-compression').
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

// Advisory advisor: one read-only report route, dual prefixed like the others.
const ADVISOR_REPORT_ROUTES = [
  '/endpoint/dsh-context-compression-improved/advisor-report',
  '/api/dsh-context-compression-improved/advisor-report',
] as const

// Savings stats: one read-only snapshot route, dual prefixed like the others.
const SAVINGS_ROUTES = [
  '/endpoint/dsh-context-compression-improved/savings',
  '/api/dsh-context-compression-improved/savings',
] as const

const MONITOR_ROUTES = [
  '/endpoint/dsh-context-compression-improved/monitor',
  '/api/dsh-context-compression-improved/monitor',
] as const

// Per-session savings ledger (T24): paginated store view ⊕ live residual.
const SAVINGS_SESSIONS_ROUTES = [
  '/endpoint/dsh-context-compression-improved/savings/sessions',
  '/api/dsh-context-compression-improved/savings/sessions',
] as const

/** Minimal face of the agents service: session id → agent (carrying the session). */
interface AgentsServiceLike {
  get?(id: unknown): { session?: unknown } | undefined
}

function sessionFor(readService: (name: string) => unknown, sessionId: string): unknown {
  const agents = readService('agents') as AgentsServiceLike | undefined
  return typeof agents?.get === 'function' ? agents.get(sessionId)?.session : undefined
}

function jsonResponse(res: unknown, status: number, body: unknown): void {
  const resTyped = res as {
    writeHead: (code: number, headers?: Record<string, string>) => void
    end: (body?: string) => void
  }
  resTyped.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  resTyped.end(JSON.stringify(body))
}

/**
 * Serve the advisory advisor's read-only report route (same registration
 * skeleton as the estimator-catalog route):
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
      jsonResponse(res, 503, { ok: false, error: 'advisor report unavailable' })
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
      jsonResponse(res, 400, { ok: false, error: 'sessionId is required' })
      return
    }
    const session = sessionFor(readService, sessionId)
    if (session === undefined) {
      jsonResponse(res, 404, { ok: false, error: 'unknown session' })
      return
    }
    const state = getAdvisorState(session as Parameters<typeof getAdvisorState>[0])
    jsonResponse(res, 200, {
      ok: true,
      sessionId,
      advisor: {
        summary: state.summary ?? null,
        decay: state.lastDecay?.decay ?? null,
        weightedChars: state.lastDecay?.weightedChars ?? null,
        decayTurn: state.lastDecay?.turn ?? null,
        scores: [...state.scores].map(([seq, entry]) => ({ seq, score: entry.score, turn: entry.turn })),
        lowRelevanceSeqs: [...state.recertified.keys()],
        // The benefit model's label of the last landed batch — advice, never a
        // gate: the batch it describes landed regardless of the band.
        lastAdvice: state.lastAdvice === undefined
          ? null
          : {
              band: state.lastAdvice.band,
              turn: state.lastAdvice.turn,
              itemSeqs: state.lastAdvice.itemSeqs,
              recoveredTokens: state.lastAdvice.recoveredTokens,
              penaltyTokens: state.lastAdvice.penaltyTokens,
              paybackTurns: state.lastAdvice.paybackTurns ?? null,
            },
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
 * `webServer.register` throws `duplicate exact route` when the same lib is
 * mounted twice by the host (two plugin ids resolving to one module: the
 * package-root manifest and the nested selector manifest). The other mount
 * already owns every path in the batch, so the collision is a success from
 * the plugin's point of view — without this, the losing arm logs a stack-
 * heavy warn pair on every boot (observed 0.9.5 on 0.2.0-rc.2, savings and
 * monitor).
 */
const isDuplicateRouteError = (error: unknown): boolean =>
  String((error as Error)?.message ?? error).includes('duplicate exact route')

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
      if (isDuplicateRouteError(error)) {
        registered = true
        log('info', 'context-compression estimator catalog route already registered by another mount (%s)', channel)
        return
      }
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

/**
 * Read-only savings snapshot route (`GET .../savings?sessionId=…`): gross saved,
 * offsets (negative savings — compressed content later re-read in full), and net,
 * with exact-tokenizer and chars/4 bases reported separately and never merged.
 * Registration mirrors the estimator-catalog route (webServer gate alone, dual
 * channels for both service arrival orders, single guarded registration).
 */
function registerSavingsRoute(ctx: Context): void {
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

  let registered = false
  const register = (webServer: WebServerLike, channel: 'direct' | 'inject'): void => {
    if (registered) return
    const handler = (req: unknown, res: unknown): void => {
      const resTyped = res as {
        writeHead: (code: number, headers?: Record<string, string>) => void
        end: (body?: string) => void
      }
      if (typeof resTyped?.writeHead !== 'function' || typeof resTyped?.end !== 'function') return
      // T21:面板首命中最先发生的读路由——回填调度器的一次性 kick(内部闸幂等)。
      kickStatsBackfillOnRouteHit()
      let sessionId: string | undefined
      try {
        const url = new URL(String((req as { url?: string })?.url ?? '/'), 'http://localhost')
        const raw = url.searchParams.get('sessionId')
        if (typeof raw === 'string' && raw.length > 0 && raw.length <= 512) sessionId = raw
      } catch {
        /* 无法解析的查询串 = 全会话聚合 */
      }
      const snapshot = getSavingsLedger().snapshot(sessionId)
      const pricing = estimateSavingsPricing(readService, snapshot)
      resTyped.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
      resTyped.end(JSON.stringify({ ok: true, ...snapshot, ...(pricing === undefined ? {} : { pricing }) }))
    }
    try {
      const disposers = SAVINGS_ROUTES
        .map(path => webServer.register({ kind: 'exact', path, handler }))
        .filter((off): off is () => void => typeof off === 'function')
      registered = true
      ctx.effect(
        () => () => { for (const off of disposers) off() },
        'contextCompressionSelector.savings route',
      )
      log('info', 'context-compression savings route registered (%s): %s', channel, SAVINGS_ROUTES.join(', '))
    } catch (error) {
      if (isDuplicateRouteError(error)) {
        registered = true
        log('info', 'context-compression savings route already registered by another mount (%s)', channel)
        return
      }
      log('warn', 'context-compression savings route registration failed (%s): %o', channel, error)
    }
  }

  const active = asWebServer(readService('webServer'))
  if (active !== undefined) {
    register(active, 'direct')
    if (registered) return
  }

  ctx.inject(['webServer'], (injected) => {
    const webServer = asWebServer((injected as { webServer?: unknown }).webServer)
    if (webServer === undefined) {
      log('warn', 'context-compression webServer exposes no register() — savings route not registered')
      return
    }
    register(webServer, 'inject')
  })
}

/**
 * Per-session savings ledger route (`GET .../savings/sessions?offset=&limit=&sessionId=…`)
 * — spec T24: paginated store aggregates ⊕ live residual merge + per-session
 * integral (Σ samples: "累计按 N 次 call") + cache-weighted money estimate +
 * persistence state and display prefs (T30) for `/ccip`'s real-time toggles.
 * The frozen `/savings` and `/monitor` contracts are untouched; everything new
 * lives on this endpoint only.
 */
function registerSavingsSessionsRoute(ctx: Context): void {
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

  let registered = false
  const register = (webServer: WebServerLike, channel: 'direct' | 'inject'): void => {
    if (registered) return
    const handler = (req: unknown, res: unknown): void => {
      const resTyped = res as {
        writeHead: (code: number, headers?: Record<string, string>) => void
        end: (body?: string) => void
      }
      if (typeof resTyped?.writeHead !== 'function' || typeof resTyped?.end !== 'function') return
      kickStatsBackfillOnRouteHit()
      let offset = 0
      let limit = 20
      let sessionId: string | undefined
      try {
        const url = new URL(String((req as { url?: string })?.url ?? '/'), 'http://localhost')
        const rawOffset = Number(url.searchParams.get('offset') ?? '0')
        if (Number.isFinite(rawOffset) && rawOffset >= 0) offset = Math.trunc(rawOffset)
        const rawLimit = Number(url.searchParams.get('limit') ?? '20')
        if (Number.isFinite(rawLimit)) limit = Math.min(100, Math.max(1, Math.trunc(rawLimit)))
        const raw = url.searchParams.get('sessionId')
        if (typeof raw === 'string' && raw.length > 0 && raw.length <= 512) sessionId = raw
      } catch {
        /* 无法解析的查询串 = 默认第一页 */
      }
      const store = getStatsStore()
      const ledger = getSavingsLedger()
      const priceRecord = resolvePanelPriceRecord(readService)
      const buildRow = (agg: { sessionId: string; gross: { exact: number; estimated: number }; offsets: { exact: number; estimated: number }; net: { exact: number; estimated: number } }) => {
        const integral = store === null
          ? { netExact: 0, netEstimated: 0, cachedInput: 0, uncachedInput: 0, calls: 0 }
          : store.sumSamples(agg.sessionId)
        const money = priceRecord === undefined || integral.calls === 0
          ? undefined
          : estimateIntegralMoney({ cachedInput: integral.cachedInput, uncachedInput: integral.uncachedInput, record: priceRecord })
        const liveSnapshot = ledger.snapshot(agg.sessionId)
        return {
          sessionId: agg.sessionId,
          gross: agg.gross,
          offsets: agg.offsets,
          net: agg.net,
          source: store?.getSessionRecord(agg.sessionId)?.source ?? 'live',
          integral,
          ...(money === undefined ? {} : { money }),
          // 当前存量(observeActive 收敛口径)——该会话在本进程内存账本中才非空
          liveStock: liveSnapshot.sessions === 1 ? liveSnapshot.net : undefined,
        }
      }
      let total = 0
      const sessions: ReturnType<typeof buildRow>[] = []
      if (store !== null) {
        const all = store.perSessionAggregates()
        const filtered = sessionId === undefined ? all : all.filter(agg => agg.sessionId === sessionId)
        total = filtered.length
        for (const agg of filtered.slice(offset, offset + limit)) sessions.push(buildRow(agg))
      }
      // 全会话积分总行（"累计（按 N 次 call）"）+ 省钱加权
      const integralTotal = store === null
        ? { netExact: 0, netEstimated: 0, cachedInput: 0, uncachedInput: 0, calls: 0 }
        : store.sumSamplesAll()
      const integralMoney = priceRecord === undefined || integralTotal.calls === 0
        ? undefined
        : estimateIntegralMoney({ cachedInput: integralTotal.cachedInput, uncachedInput: integralTotal.uncachedInput, record: priceRecord })
      // live-only 补充:内存账本 top-8 中不在 store 分页里的会话(降级态/未落库
      // /store 缺席),只带存量与 usage 口径,不占分页 total。
      const known = new Set(sessions.map(row => row.sessionId))
      const liveOnly = ledger.snapshot(undefined).perSession
        .filter(row => !known.has(row.sessionId) && (sessionId === undefined || row.sessionId === sessionId))
        .map(row => ({ sessionId: row.sessionId, net: row.net, requests: row.requests, cacheHitRate: row.cacheHitRate }))
      resTyped.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
      resTyped.end(JSON.stringify({
        ok: true,
        persisted: statsPersistenceState(),
        displayPrefs: getDisplayPrefs(),
        total,
        offset,
        limit,
        integralTotal,
        ...(integralMoney === undefined ? {} : { integralMoney }),
        sessions,
        liveOnly,
      }))
    }
    try {
      const disposers = SAVINGS_SESSIONS_ROUTES
        .map(path => webServer.register({ kind: 'exact', path, handler }))
        .filter((off): off is () => void => typeof off === 'function')
      registered = true
      ctx.effect(
        () => () => { for (const off of disposers) off() },
        'contextCompressionSelector.savings sessions route',
      )
      log('info', 'context-compression savings sessions route registered (%s): %s', channel, SAVINGS_SESSIONS_ROUTES.join(', '))
    } catch (error) {
      if (isDuplicateRouteError(error)) {
        registered = true
        log('info', 'context-compression savings sessions route already registered by another mount (%s)', channel)
        return
      }
      log('warn', 'context-compression savings sessions route registration failed (%s): %o', channel, error)
    }
  }

  const active = asWebServer(readService('webServer'))
  if (active !== undefined) {
    register(active, 'direct')
    if (registered) return
  }

  ctx.inject(['webServer'], (injected) => {
    const webServer = asWebServer((injected as { webServer?: unknown }).webServer)
    if (webServer === undefined) {
      log('warn', 'context-compression webServer exposes no register() — savings sessions route not registered')
      return
    }
    register(webServer, 'inject')
  })
}

/** 官方 deepseek-official 路由的现行定价记录（/ccip 面板省钱加权用）；fail-closed。 */
function resolvePanelPriceRecord(readService: (name: string) => unknown): OfficialDeepSeekPriceRecord | undefined {
  const defaults = readService('agentDefaultModel') as { currentSelection?: () => { provider?: unknown; model?: unknown } } | undefined
  const selection = defaults?.currentSelection?.()
  const provider = typeof selection?.provider === 'string' ? selection.provider : ''
  const modelId = typeof selection?.model === 'string' ? selection.model : ''
  if (provider !== 'deepseek-official') return undefined
  const resolution = resolveOfficialDeepSeekPrice({
    provider,
    baseUrlClass: 'official-public',
    apiRoute: 'chat-completions',
    modelId,
    currency: 'USD',
    at: new Date(),
  })
  return resolution.kind === 'priced' ? resolution.record : undefined
}

/**
 * 浮窗统计块（/monitor 载荷附加字段，既有字段零改动）：只带最近压缩会话口径——
 * 宿主不给"正在查看的会话"（输入栏注入只在页面加载时发生，切会话不重注入，
 * 实测陈旧），所以服务端按 claims.at 最大者解析最近压缩会话并显式回带 id。
 * 全部会话/生命周期的聚合刻意不上浮窗（设置页账本负责）。
 * store 缺席 = 只剩 persisted，快照主结构不受影响。
 */
function monitorStatsBlock(viewSessionId?: string): Record<string, unknown> {
  const store = getStatsStore()
  if (store === null) return { persisted: statsPersistenceState() }
  // 当前会话解析优先级:客户端「页面所在会话」(session 作用域槽响应式下发)
  // > 运行时活跃指针(请求边界) > store 最近压缩会话。
  const currentSessionId = viewSessionId ?? getStatsActiveSessionId() ?? store.latestActiveSessionId()
  const composition = currentSessionId === undefined ? [] : mergeCompositionByComponent(store.sessionComponents(currentSessionId))
  // 会话三值(毛/抵消/净,持久口径 = jsonl 公式产物):最近压缩会话的 claims 聚合,
  // 浮窗 Δ 三行据此填充(内存残量由客户端回退兜底)。
  // 单一来源(用户定标):长度只认 DRS 投影,每次从替换对全量重导(毛=Σ(a−b)
  // 仅压缩对,不含回吐;抵消=Σb 仅召回对;净=毛−抵消)。投影缺席/未同步该会话
  // = 不下发三值(浮窗显示「–」),绝不以 claims/live 账本冒充第二来源;长度
  // 新鲜度由 DRS 的 interval 同步负责(DRS 自己保证尽量跟上 jsonl)。
  const drsIndex = currentSessionId === undefined ? undefined : readDrsSessionIndex({ sessionId: currentSessionId })
  const drsFragment = drsIndex === undefined ? undefined : drsTotalsFragment(drsIndex)
  const sessionTotals = drsFragment?.sessionTotals
  const lastDelta = drsFragment?.lastDelta
  const hasLastDelta = lastDelta !== undefined && (lastDelta.saving !== undefined || lastDelta.offset !== undefined)
  return {
    persisted: statsPersistenceState(),
    ...(sessionTotals === undefined ? {} : { sessionTotals: { gross: sessionTotals.gross, offsets: sessionTotals.offsets, net: sessionTotals.net } }),
    ...(hasLastDelta ? { lastDelta } : {}),
    ...(composition.length > 0 ? { composition, compositionSession: currentSessionId } : {}),
  }
}

/**
 * Floating-panel monitor route (`GET|POST .../monitor?sessionId=…`):
 *  - GET → the monitor snapshot (savings aggregate + intent control block +
 *    pricing) — the payload shape the panel polls;
 *  - POST → session override action (`{"action":"on"|"off"|"clear"}`),
 *    driving the exact state machine `/ctx-summary` drives.
 * Registration mirrors the savings route (webServer gate alone, dual channels,
 * single guarded registration); the handler branches on `req.method` because
 * the registration surface is method-agnostic.
 */
/** Exported for the runtime monitor spec; the entry owns all webServer wiring. */
export function registerMonitorRoute(ctx: Context): void {
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

  let registered = false
  const register = (webServer: WebServerLike, channel: 'direct' | 'inject'): void => {
    if (registered) return
    const handler = (req: unknown, res: unknown): void => {
      const resTyped = res as {
        writeHead: (code: number, headers?: Record<string, string>) => void
        end: (body?: string) => void
      }
      if (typeof resTyped?.writeHead !== 'function' || typeof resTyped?.end !== 'function') return
      // T21:悬浮球轮询的 /monitor 与 /savings 同为首次命中触发源(闸幂等)。
      kickStatsBackfillOnRouteHit()
      let sessionId: string | undefined
      try {
        const url = new URL(String((req as { url?: string })?.url ?? '/'), 'http://localhost')
        const raw = url.searchParams.get('sessionId')
        if (typeof raw === 'string' && raw.length > 0 && raw.length <= 512) sessionId = raw
      } catch {
        /* 无法解析的查询串 = 全会话聚合 */
      }
      const method = String((req as { method?: string })?.method ?? 'GET').toUpperCase()
      if (method === 'POST') {
        const chunks: Buffer[] = []
        let size = 0
        let done = false
        const respond = (status: number, body: Record<string, unknown>): void => {
          if (done) return
          done = true
          resTyped.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          resTyped.end(JSON.stringify(body))
        }
        const reqTyped = req as { on?: (event: string, cb: (chunk?: Buffer) => void) => void }
        if (typeof reqTyped?.on !== 'function') {
          respond(400, { ok: false, error: 'unreadable request body' })
          return
        }
        reqTyped.on('data', (chunk?: Buffer) => {
          size += chunk?.length ?? 0
          if (size <= 4096) chunks.push(Buffer.from(chunk ?? new Uint8Array()))
        })
        reqTyped.on('end', () => {
          let action: unknown
          try {
            action = (JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { action?: unknown }).action
          } catch {
            respond(400, { ok: false, error: 'monitor override action must be JSON' })
            return
          }
          if (!isSessionOverrideAction(action)) {
            respond(400, { ok: false, error: 'monitor override action must be "on" | "off" | "clear"' })
            return
          }
          const { override } = applySessionOverride(sessionId ?? '', action)
          respond(200, { ok: true, override: override ?? null, sessionScope: sessionId ?? null })
        })
        return
      }
      const snapshot = buildMonitorSnapshot(sessionId)
      const pricing = estimateSavingsPricing(readService, snapshot)
      resTyped.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
      resTyped.end(JSON.stringify({ ok: true, ...snapshot, ...(pricing === undefined ? {} : { pricing }), ...monitorStatsBlock(sessionId) }))
    }
    try {
      const disposers = MONITOR_ROUTES
        .map(path => webServer.register({ kind: 'exact', path, handler }))
        .filter((off): off is () => void => typeof off === 'function')
      registered = true
      ctx.effect(
        () => () => { for (const off of disposers) off() },
        'contextCompressionSelector.monitor route',
      )
      log('info', 'context-compression monitor route registered (%s): %s', channel, MONITOR_ROUTES.join(', '))
    } catch (error) {
      if (isDuplicateRouteError(error)) {
        registered = true
        log('info', 'context-compression monitor route already registered by another mount (%s)', channel)
        return
      }
      log('warn', 'context-compression monitor route registration failed (%s): %o', channel, error)
    }
  }

  const active = asWebServer(readService('webServer'))
  if (active !== undefined) {
    register(active, 'direct')
    if (registered) return
  }

  ctx.inject(['webServer'], (injected) => {
    const webServer = asWebServer((injected as { webServer?: unknown }).webServer)
    if (webServer === undefined) {
      log('warn', 'context-compression webServer exposes no register() — monitor route not registered')
      return
    }
    register(webServer, 'inject')
  })
}

/**
 * Resolve one possibly-volatile field: a live ref on 0.1.7+, a plain value
 * otherwise (0.1.7 hands `.volatile()` fields to `apply()` as live refs).
 */
function readVolatileValue<T>(value: T | { get(): T } | undefined): T | undefined {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return (value as { get(): T }).get()
  }
  return value as T | undefined
}

/** The compression settings document carried by this row's composition entry. */
function readCompressionDoc(config: Config | undefined): ContextCompressionSettings | undefined {
  return readVolatileValue(config?.settings)
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
   * Register the advisory advisor's read-only HTTP report route (decay
   * figure, task summary, score distribution, last benefit-model advice).
   * Same Bundle opt-in semantics as `estimatorCatalogRoute`; the advisor
   * itself stays off until the user turns it on through the
   * `presetOptions.advisor*` settings keys.
   */
  advisorReportRoute?: boolean
  /**
   * 0.1.7: the compression settings document as ONE `.volatile()` whole-object
   * field (the old dedicated namespace has no declarative equivalent). The
   * browser selector writes it through `configForms`; the runtime reads the
   * dereferenced value. Loose section schemas keep unknown keys — the strict
   * validation stays in `decodeSettings` (client) and the runtime resolver.
   */
  settings?: ContextCompressionSettings
}

/** Loader validation for the standalone Bundle opt-in. */
export const Config = z.object({
  presetOverlay: z.boolean().default(false),
  estimatorCatalogRoute: z.boolean().default(false),
  advisorReportRoute: z.boolean().default(false),
  // The daily Custom defaults ride the field's schema default so every
  // composition resolves a complete document without a stored user layer.
  settings: z.any().default(DEFAULT_CONTEXT_COMPRESSION_SETTINGS).volatile(),
}) as unknown as z<Config>

/** Register the persisted default read by the currently mounted root pruner. */
export function apply(ctx: Context, config: Config = {}): void {
  // Measured on the 0.1.2 host: a plugin-load failure surfaces only through the
  // cordis logger, which prints nothing in the `dsh web` terminal — so a throw
  // here is completely invisible and looks exactly like a plugin that loaded
  // and quietly did nothing. Report it to a sink the host shows, then re-throw
  // unchanged: behaviour is untouched, only observability is restored.
  try {
    // The settings card's host-route dropdowns read this route; it lives on the
    // top-level plugin fiber, not inside the isolated `toolResultPruner`
    // service, because the route is host-wide rather than per-pruner-instance.
    if (config.estimatorCatalogRoute === true) registerEstimatorCatalogRoute(ctx)
    // 节省统计路由:只读快照,无 opt-in 门槛(无敏感数据,纯 token 计数)。
    registerSavingsRoute(ctx)
    registerMonitorRoute(ctx)
    // T24:per-session 分页面板数据面;/ccip(T29)实时控制命令。
    registerSavingsSessionsRoute(ctx)
    registerPanelCommand(ctx)

    // 持久层主干生命周期(spec T5):open 后台 arm 不阻塞 apply(WAL 半事务
    // 由 SQLite 在 open 时自动恢复,故 recover 并入 open);close 挂 ctx.effect
    // 同缝清理,热重载/卸载不泄 fd。无驱动/拒开/损坏 → stats-db 内部 warn 恰
    // 一次 + statsPersistenceState() 导出 persisted:false,绝不向宿主抛错。
    ctx.effect(() => () => { cancelPendingUsageFlushes(); closeStatsStore() }, 'contextCompressionSelector.stats db')
    void ensureStatsStore().catch(() => { /* ensureStatsStore 内部已吞错并降级为可见状态;此 catch 仅兜意外拒绝 */ })
    // T21:回填触发源装配——sessionQuery 服务惰性解析(缺服务/老线宿主返回
    // undefined,调度器自动走后端 B);路由 kick 在 savings/monitor 处理器内。
    configureStatsBackfillTrigger({
      sessionQuery: () => {
        try {
          const face = (ctx as unknown as { get: (service: string) => unknown }).get('sessionQuery') as
            | { listSessions?: unknown; readSession?: unknown }
            | undefined
          return typeof face?.listSessions === 'function' && typeof face?.readSession === 'function'
            ? face as unknown as import('./runtime/stats-backfill.ts').BackfillSessionQueryFace
            : undefined
        } catch {
          return undefined
        }
      },
    })

    // compat-legacy 单版本：legacy 宿主（0.1.0–0.1.5，settings.register 仍在）
    // 上租约注册压缩命名空间 + 全线挂 settings 桥路由（旧线 client 的唯一数据面；
    // modern 线 client 走 configForms，桥 GET 只是补充读）。零 opt-in 门槛，与
    // savings/monitor 同级；Gate 0 实证路由行必须带行级 inject:[webServer]，
    // bundle patch 已含该行（findings B2.1 工程契约）。
    wireSettingsBridge(ctx)

    // Advisory advisor: read-only decay/score/advice report (opt-in).
    if (config.advisorReportRoute === true) registerAdvisorReportRoute(ctx)

    // Turn-tail intent summary: `/ctx-summary off|on|status`. The command is
    // free to register and stays quiet on hosts without the commands
    // registry; the capability itself is gated by the frozen `intentSummary`
    // setting plus the session-scoped override this command controls.
    registerSummaryCommand(ctx)

    if (config.presetOverlay !== true) return

    ctx.inject(['agentPresets'], (presetsCtx) => {
      const installation = decorateAgentPresets(
        presetsCtx.agentPresets,
        {
          modules: resolveCompressionModulePaths(),
          excludedPresetIds: ['minimal'],
          autoCompactThresholdPercent: () => resolveAutoCompactThresholdPercent(config, presetsCtx),
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
function resolveAutoCompactThresholdPercent(config: Config | undefined, presetsCtx?: Context): number {
  // 0.1.7: the volatile entry field is authoritative; the legacy per-namespace
  // read stays as a fallback so a host that still serves the old service shape
  // keeps working (test hosts do exactly that).
  const raw = readCompressionDoc(config)
    ?? (presetsCtx?.get('settings') as { get?: (ns: never) => unknown } | undefined)
      ?.get?.(CONTEXT_COMPRESSION_SETTINGS_NAMESPACE as never)
  try {
    const record = structuredClone(raw) as Record<string, unknown> | undefined
    const threshold = record?.autoCompact as { thresholdPercent?: number } | undefined
    const value = typeof threshold?.thresholdPercent === 'number' ? threshold.thresholdPercent : 80
    return Number.isFinite(value) && value >= 50 && value <= 90 ? value : 80
  } catch {
    return 80
  }
}


