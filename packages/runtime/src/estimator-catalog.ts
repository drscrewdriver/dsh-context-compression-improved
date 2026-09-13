/**
 * Estimator model-catalog projection for the settings card: the live
 * provider/model-group catalog from the DSH `llm` service — including
 * user-configured custom groups — plus the effective host selection
 * (override → agentDefaultModel.currentSelection). The same projection seam
 * dsh-perm-gate's receiver-info and dsh-prime-memory's llm-providers view use.
 *
 * Pure projection: never throws; per-provider failures are reported inline so
 * one broken group never blanks the whole list.
 */

/** One model entry as offered by a provider group. */
export interface CatalogModel {
  readonly id: string
  readonly name: string
}

/** One provider group and its models (or the reason it failed to enumerate). */
export interface CatalogProvider {
  readonly id: string
  readonly name: string
  readonly models: readonly CatalogModel[]
  readonly error?: string
}

/** What the settings card needs to render the host-route dropdowns. */
export interface EstimatorCatalog {
  /** Live provider groups; empty when the `llm` service is unavailable. */
  readonly providers: readonly CatalogProvider[]
  /** The provider/model the host channel would use right now (undefined when undetermined). */
  readonly selection?: { readonly provider: string, readonly model: string }
}

/** The minimal faces of the host services this projection reads. */
export interface EstimatorCatalogDeps {
  llm?: {
    listProviders?: () => readonly { id: string, name: string }[]
    listModels?: (providerId: string) => Promise<readonly { id: string, name: string }[]>
    /** Fallback enumeration source for builds whose `listModels` is absent or dormant. */
    listConfigurableProviders?: () => readonly { provider: string, settingsNs: string }[]
    /** Discovery for a configured route answers from the adapter's own knowledge — no network call. */
    discoverModels?: (settingsNs: string, request: { provider?: string }) => Promise<readonly { id: string, name?: string }[]>
  }
  /** Live default-model selection (optional `agentDefaultModel` service). */
  currentSelection?: () => { provider?: unknown, model?: unknown } | undefined
  /** Explicit estimator overrides (empty string = follow the host selection). */
  overrideProvider?: string
  overrideModel?: string
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Resolve the effective host model route (override → session default). */
export function resolveHostRoute(deps: EstimatorCatalogDeps): { provider: string, model: string } | undefined {
  const overrideProvider = str(deps.overrideProvider)
  const overrideModel = str(deps.overrideModel)
  const selected = deps.currentSelection?.()
  const selectedProvider = str(selected?.provider)
  const selectedModel = str(selected?.model)
  const provider = overrideProvider !== '' ? overrideProvider : selectedProvider
  const model = overrideModel !== '' ? overrideModel : selectedModel
  if (provider === '' || model === '') return undefined
  return { provider, model }
}

/** Build the catalog projection. Never throws. */
export async function buildEstimatorCatalog(deps: EstimatorCatalogDeps): Promise<EstimatorCatalog> {
  if (deps.llm?.listProviders === undefined) {
    const selection = resolveHostRoute(deps)
    return selection === undefined ? { providers: [] } : { providers: [], selection }
  }
  const selection = resolveHostRoute(deps)
  const raw = deps.llm.listProviders()
  const providers = await Promise.all(raw.map(async (p): Promise<CatalogProvider> => {
    let models: CatalogModel[] = []
    let error: string | undefined
    try {
      models = (await deps.llm?.listModels?.(p.id) ?? []).map(m => ({ id: m.id, name: m.name }))
    } catch (e) {
      error = String((e as Error)?.message ?? e)
    }
    if (models.length === 0) {
      // Fallback: route discovery. For an already-configured route the
      // adapter answers from its own stored knowledge (no network call).
      try {
        const entry = deps.llm?.listConfigurableProviders?.().find(c => c.provider === p.id)
        if (entry !== undefined && deps.llm?.discoverModels !== undefined) {
          const discovered = await deps.llm.discoverModels(entry.settingsNs, { provider: p.id })
          if (discovered.length > 0) {
            models = discovered.map(m => ({ id: m.id, name: m.name ?? m.id }))
            error = undefined
          }
        }
      } catch {
        // keep the primary error / empty state
      }
    }
    if (models.length === 0 && error === undefined) error = 'no models advertised'
    return { id: p.id, name: p.name, models, ...(error === undefined ? {} : { error }) }
  }))
  return { providers, ...(selection === undefined ? {} : { selection }) }
}
