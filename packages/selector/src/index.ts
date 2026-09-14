/** Host owner of the context-compression preference consumed by the browser selector. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  type SettingsScope,
  type default as SettingsService,
} from '@deepseek-ai/dsh-settings'
import { buildEstimatorCatalog, type EstimatorCatalogDeps } from './estimator-catalog.ts'

// Inlined from the runtime to eliminate the cross-package dependency that
// triggered ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED on every install.
const CONTEXT_COMPRESSION_NAMESPACE = 'context-compression' as never
import {
  decorateAgentPresets,
  resolveCompressionModulePaths,
} from './preset-overlay.ts'

// 0.1.1/0.1.2 客户端 API 前缀是 /endpoint，0.1.5 起改为 /api —— 两条绝对路径都
// 注册（各自的 (kind, path) 表项），一份处理器服务两个前缀。
const ESTIMATOR_CATALOG_ROUTES = [
  '/endpoint/dsh-context-compression-improved/estimator-catalog',
  '/api/dsh-context-compression-improved/estimator-catalog',
] as const

/** Runtime detection of the host web server (same pattern as dsh-perm-gate). */
interface WebServerLike {
  register: (spec: {
    kind: 'exact'
    path: string
    handler: (req: unknown, res: unknown) => void
  }) => unknown
}

interface CatalogAwareContext {
  effect: Context['effect']
  webServer?: unknown
  llm?: unknown
  agentDefaultModel?: { currentSelection?: () => { provider?: unknown, model?: unknown } | undefined }
}

function asWebServer(value: unknown): WebServerLike | undefined {
  const register = (value as { register?: unknown } | undefined)?.register
  if (typeof register !== 'function') return undefined
  return { register: register as WebServerLike['register'] }
}

/**
 * Serve `GET /api/dsh-context-compression-improved/estimator-catalog` — the
 * settings card's host-route dropdowns (live provider/model groups from the DSH
 * `llm` service plus the effective selection). This lives on the top-level
 * plugin context, NOT inside the isolated toolResultPruner service: a route
 * registered there can never reach the `webServer` service across the
 * isolation boundary, and the dropdowns answer 401. `ctx.inject` also fixes
 * the late-activation problem the old polling loop worked around — the handler
 * is installed the moment `webServer` appears. Best effort: without the
 * service the plugin keeps working, only the HTTP API is missing.
 */
function registerEstimatorCatalogRoute(ctx: Context): void {
  ctx.inject(['webServer', 'llm', 'agentDefaultModel'], (injected) => {
    const rctx = injected as unknown as CatalogAwareContext
    const webServer = asWebServer(rctx.webServer)
    if (webServer === undefined) return
    const handler = (_req: unknown, res: unknown): void => {
      const resTyped = res as {
        writeHead: (code: number, headers?: Record<string, string>) => void
        end: (body?: string) => void
      }
      if (typeof resTyped?.writeHead !== 'function' || typeof resTyped?.end !== 'function') return
      const defaults = rctx.agentDefaultModel
      const deps: EstimatorCatalogDeps = {
        ...(rctx.llm === undefined
          ? {}
          : { llm: rctx.llm as NonNullable<EstimatorCatalogDeps['llm']> }),
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
    const disposers = ESTIMATOR_CATALOG_ROUTES
      .map(path => webServer.register({ kind: 'exact', path, handler }))
      .filter((off): off is () => void => typeof off === 'function')
    rctx.effect(
      () => () => { for (const off of disposers) off() },
      'contextCompressionSelector.estimator-catalog route',
    )
  })
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
}

/** Loader validation for the standalone Bundle opt-in. */
export const Config: z<Config> = z.object({
  presetOverlay: z.boolean().default(false),
})

/** Register the persisted default read by the currently mounted root pruner. */
export function apply(ctx: Context, config: Config = {}): void {
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
