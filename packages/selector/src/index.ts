/** Host owner of the context-compression preference consumed by the browser selector. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  type SettingsScope,
  type default as SettingsService,
} from '@deepseek-ai/dsh-settings'
import { buildEstimatorCatalog, type EstimatorCatalogDeps } from './estimator-catalog.ts'
import { CONTEXT_COMPRESSION_SETTINGS_NAMESPACE } from './runtime/config.ts'

// The settings namespace literal is owned by the runtime config module. It was
// once inlined here to dodge a cross-package dependency; the runtime package is
// now part of this one, so the single source of truth is used again. The value
// is identical ('context-compression'), so this is not a behavior change.
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
}

/** Loader validation for the standalone Bundle opt-in. */
export const Config: z<Config> = z.object({
  presetOverlay: z.boolean().default(false),
  estimatorCatalogRoute: z.boolean().default(false),
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
        z.any(),
      )
    }
    if (state.owners.size === 0 && settings[SHARED_SETTINGS] === state) {
      Reflect.deleteProperty(settings, SHARED_SETTINGS)
    }
  }, 'contextCompressionSelector.settingsLease()')

  if (state.owners.size === 1) {
    state.scope = settings.register(
      CONTEXT_COMPRESSION_NAMESPACE,
      z.any(),
    )
  }
}
