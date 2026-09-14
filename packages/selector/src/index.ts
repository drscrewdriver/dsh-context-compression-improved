/** Host owner of the context-compression preference consumed by the browser selector. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  type SettingsScope,
  type default as SettingsService,
} from '@deepseek-ai/dsh-settings'
import {
  CONTEXT_COMPRESSION_SETTINGS_NAMESPACE,
  ContextCompressionSettingsSchema,
} from './runtime/config.ts'
import { buildEstimatorCatalog, type EstimatorCatalogDeps } from './estimator-catalog.ts'
import {
  decorateAgentPresets,
  resolveCompressionModulePaths,
} from './preset-overlay.ts'

/**
 * The plugin-facing HTTP surface of the 0.1.2 generation is the `connection`
 * service, not `webServer`. `dsh-client-connection` owns the `/api` prefix
 * route, applies the Host/Origin fence and browser authentication to it, and
 * registers it on `webServer` from its own context — the one place where that
 * service is demonstrably reachable. A plugin that reaches for `webServer`
 * itself takes on a dependency the host never intended it to have, and loses
 * the auth fence along with it.
 *
 * This path is a legal `connection` Fetch route (`assertFetchRoute` accepts any
 * path whose segments match `^[A-Za-z0-9_$.-]+$`) and deliberately is NOT a
 * typert endpoint: the `/api` RPC interceptor belongs to the API gateway and
 * only claims two-segment `<ns>/<method>` remotes, so a three-segment
 * plugin-owned path could never be answered through it.
 */
const ESTIMATOR_CATALOG_PATH = '/api/dsh-context-compression-improved/estimator-catalog'

/**
 * The one service the route needs. `llm` and `agentDefaultModel` only enrich
 * the payload and are resolved per request, never reasons to withhold the route.
 */
const ESTIMATOR_CATALOG_ROUTE_DEPS: readonly ['connection'] = ['connection']

/** One route as `connection.fetch.register` accepts it. */
interface FetchRouteLike {
  path: string
  methods: readonly string[]
  fetch: (request: Request) => Promise<Response> | Response
}

/** Runtime detection of the host Connection service (duck-typed, as perm-gate does). */
interface ConnectionLike {
  fetch: { register: (route: FetchRouteLike) => unknown }
}

/** The estimator-side service the catalog handler enriches its response with. */
interface AgentDefaultModelLike {
  /** Current host model-group selection, when the service exposes one. */
  currentSelection?: () => { provider?: unknown, model?: unknown } | undefined
}

function asConnection(value: unknown): ConnectionLike | undefined {
  const register = (value as { fetch?: { register?: unknown } } | undefined)?.fetch?.register
  if (typeof register !== 'function') return undefined
  return { fetch: { register: register as ConnectionLike['fetch']['register'] } }
}

/**
 * Serve `GET /api/dsh-context-compression-improved/estimator-catalog` — the
 * settings card's host-route dropdowns (live provider/model groups from the DSH
 * `llm` service plus the effective selection).
 *
 * Two channels cover the two arrival orders: a direct lookup catches an already
 * active `connection`, and `ctx.inject` catches one that activates later. Both
 * funnel into a single guarded registration. Ownership of the route stays with
 * `connection.fetch.register`, which binds it to this fiber's effect, so a
 * second disposer here would only duplicate that lifetime.
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
  const register = (connection: ConnectionLike, channel: 'direct' | 'inject'): void => {
    if (registered) return
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' }
    const handler = async (): Promise<Response> => {
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
      try {
        const catalog = await buildEstimatorCatalog(deps)
        return new Response(JSON.stringify({ ok: true, ...catalog }), { status: 200, headers })
      } catch (error) {
        return new Response(
          JSON.stringify({ ok: false, error: String((error as Error)?.message ?? error) }),
          { status: 500, headers },
        )
      }
    }
    try {
      connection.fetch.register({ path: ESTIMATOR_CATALOG_PATH, methods: ['GET'], fetch: handler })
      registered = true
      log('info', 'context-compression estimator catalog route registered (%s): %s', channel, ESTIMATOR_CATALOG_PATH)
    } catch (error) {
      log('warn', 'context-compression estimator catalog route registration failed (%s): %o', channel, error)
    }
  }

  const active = asConnection(readService('connection'))
  if (active !== undefined) {
    register(active, 'direct')
    if (registered) return
  }

  ctx.inject([...ESTIMATOR_CATALOG_ROUTE_DEPS], (injected) => {
    const connection = asConnection((injected as { connection?: unknown }).connection)
    if (connection === undefined) {
      log('warn', 'context-compression connection exposes no fetch.register — estimator catalog route not registered')
      return
    }
    register(connection, 'inject')
  })

  log('warn', 'context-compression connection not active yet — estimator catalog route pending: %s', ESTIMATOR_CATALOG_PATH)
}

// Harness 0.1.1 exposed a namespace-branding helper; 0.1.2 validates the
// same public literal at SettingsProvider.register/get instead.
const CONTEXT_COMPRESSION_NAMESPACE = CONTEXT_COMPRESSION_SETTINGS_NAMESPACE as never

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
}

/** Loader validation for the standalone Bundle opt-in. */
export const Config: z<Config> = z.object({
  presetOverlay: z.boolean().default(false),
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

    registerEstimatorCatalogRoute(ctx)

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
    console.error('context-compression apply() failed:', error)
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
    const parsed = ContextCompressionSettingsSchema(structuredClone(raw) as never)
    return parsed.autoCompact.thresholdPercent
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
