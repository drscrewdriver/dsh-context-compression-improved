/**
 * TokenPilot-inspired estimator channel card components.
 *
 * Extracted from CompressionProfileSelector.tsx to reduce god-module size.
 *
 * @module dsh-context-compression-improved/client/EstimatorControls
 */

import { useEffect, useState } from 'react'
import type { ContextCompressionLocaleKey } from './locales.ts'
import type { PresetOptionsPatch } from './preset-options.ts'
import type { PresetOptionsSettings } from '../profiles.ts'
import css from './CompressionProfileSelector.module.css'

interface EstimatorControlsProps {
  options: PresetOptionsSettings
  disabled: boolean
  save: (options: PresetOptionsPatch) => Promise<void>
  settle: (operation: () => Promise<void>) => void
  t: (key: ContextCompressionLocaleKey) => string
}

interface CatalogModelEntry { readonly id: string, readonly name: string }
interface CatalogProviderEntry { readonly id: string, readonly name: string, readonly models: readonly CatalogModelEntry[], readonly error?: string }
interface EstimatorCatalogBody {
  readonly ok?: boolean
  readonly providers?: readonly CatalogProviderEntry[]
  readonly selection?: { readonly provider: string, readonly model: string }
}

const ESTIMATOR_CATALOG_ROUTE = '/api/dsh-context-compression-improved/estimator-catalog'

/**
 * TokenPilot-inspired estimator channel card. Shown only while the
 * tokenpilot-inspired profile is selected, and split by channel:
 *
 * - `host` reuses the providers and credentials the user already configured in
 *   DSH through the Harness `llm` service, so this card names a provider and a
 *   model and accepts NO API key — the key field belongs to the direct channel
 *   alone.
 * - `direct` talks to a native OpenAI-compatible endpoint, which is the only
 *   channel that carries its own base URL and write-only key.
 *
 * The whole card is advisory: an unconfigured or failing endpoint keeps every
 * consumer on its rule-only fallback.
 */
export function EstimatorControls({ options, disabled, save, settle, t }: EstimatorControlsProps) {
  const [keyDraft, setKeyDraft] = useState('')
  const [baseUrl, setBaseUrl] = useState(options.estimatorBaseUrl ?? '')
  const [model, setModel] = useState(options.estimatorModel ?? '')
  const [provider, setProvider] = useState(options.estimatorProvider ?? '')
  const mode = options.estimatorMode ?? ''
  // Host-mode dropdown source: the live provider/model-group catalog served by
  // the Bundle entry's estimator-catalog route (dsh-perm-gate receiver
  // pattern). The provider/model fields are always comboboxes: an empty
  // catalog (route missing / llm service absent) simply offers no suggestions
  // while custom typing keeps working, so nothing breaks on hosts without the
  // webServer.
  const [catalog, setCatalog] = useState<EstimatorCatalogBody | undefined>()
  useEffect(() => {
    if (mode !== 'host') return
    let alive = true
    // The catalog route answers once the host webServer/llm services are up;
    // poll briefly so the dropdowns fill without reopening the panel.
    let attempts = 0
    const load = async (): Promise<EstimatorCatalogBody | undefined> => {
      try {
        const response = await fetch(ESTIMATOR_CATALOG_ROUTE, { headers: { 'cache-control': 'no-cache' } })
        return response.ok ? (await response.json()) as EstimatorCatalogBody : undefined
      } catch {
        return undefined
      }
    }
    const tick = (): void => {
      attempts += 1
      void load().then((body) => {
        if (!alive) return
        if (body !== undefined && (body.providers?.length ?? 0) > 0) {
          setCatalog(body)
          return
        }
        if (attempts < 10) setTimeout(tick, 3_000)
      })
    }
    tick()
    return () => { alive = false }
  }, [mode])
  const hostProviders = catalog?.providers ?? []
  // Model suggestions follow the provider draft exactly like dsh-perm-gate's
  // receiver card: an empty provider lists every group's models, a chosen
  // provider narrows to its own. The provider error (if any) rides along in
  // the option label so a broken group is visible without blocking typing.
  const providerDraft = provider
  const hostModels = hostProviders
    .filter(entry => providerDraft === '' || entry.id === providerDraft)
    .flatMap(entry => entry.models.map(model => ({ ...model, provider: entry.id })))
  const hostProvider = hostProviders.find(entry => entry.id === providerDraft)
    ?? hostProviders.find(entry => entry.id === (options.estimatorProvider ?? ''))
  const hasKey = (options.estimatorApiKey ?? '') !== ''
  const commit = (patch: PresetOptionsPatch) => {
    settle(() => save(patch))
  }
  // What the host channel would actually call right now: an explicit override
  // wins, otherwise the session default the catalog reports. Naming the
  // resolved route is the whole point of this channel — the user re-enters
  // nothing the Harness already knows.
  const overrideProvider = options.estimatorProvider ?? ''
  const overrideModel = options.estimatorModel ?? ''
  const effectiveProvider = overrideProvider !== '' ? overrideProvider : catalog?.selection?.provider ?? ''
  const effectiveModel = overrideModel !== '' ? overrideModel : catalog?.selection?.model ?? ''
  const effectiveRoute = effectiveProvider !== '' && effectiveModel !== ''
    ? `${effectiveProvider} / ${effectiveModel}`
    : t('estimator.hostUnresolved')
  return (
    <section className={css.autoCompact} aria-labelledby="context-compression-estimator-title">
      <h3 id="context-compression-estimator-title" className={css.autoCompactTitle}>{t('estimator.title')}</h3>
      <p className={css.customNote}>{t('estimator.description')}</p>
      <label className={css.field}>
        <span>{t('estimator.mode')}</span>
        <select
          value={mode}
          disabled={disabled}
          onChange={(event) => { settle(() => save({ estimatorMode: event.currentTarget.value as '' | 'host' | 'direct' })) }}
        >
          <option value="">{t('estimator.mode.off')}</option>
          <option value="host">{t('estimator.mode.host')}</option>
          <option value="direct">{t('estimator.mode.direct')}</option>
        </select>
      </label>
      {mode === '' ? null : mode === 'host' ? (
        <>
          <label className={css.field}>
            <span>{t('estimator.provider')}</span>
            <input
              type="text"
              list="estimator-provider-options"
              value={provider}
              disabled={disabled}
              placeholder={t('estimator.provider.placeholder')}
              onChange={(event) => {
                const next = event.currentTarget.value
                setProvider(next)
                // Picking from the datalist fires change without blur: commit
                // an exact catalog hit immediately; free typing waits for blur
                // so mid-edit keystrokes never disable the panel.
                if (next !== '' && hostProviders.some(entry => entry.id === next)) {
                  commit({ estimatorProvider: next })
                }
              }}
              onBlur={() => { if (provider !== (options.estimatorProvider ?? '')) commit({ estimatorProvider: provider }) }}
            />
          </label>
          {/* Datalists ride outside the labels on purpose: option text inside a
              label would leak into its accessible name. */}
          <datalist id="estimator-provider-options">
            {hostProviders.map(entry => (
              <option key={entry.id} value={entry.id}>
                {entry.name === '' ? entry.id : entry.name}{entry.error === undefined ? '' : ` (${entry.error})`}
              </option>
            ))}
          </datalist>
          <label className={css.field}>
            <span>{t('estimator.model')}</span>
            <input
              type="text"
              list="estimator-model-options"
              value={model}
              disabled={disabled}
              placeholder={t('estimator.model.placeholder')}
              onChange={(event) => {
                const next = event.currentTarget.value
                setModel(next)
                if (next !== '' && hostModels.some(entry => entry.id === next)) {
                  commit({ estimatorModel: next })
                }
              }}
              onBlur={() => { if (model !== (options.estimatorModel ?? '')) commit({ estimatorModel: model }) }}
            />
          </label>
          <datalist id="estimator-model-options">
            {hostModels.map(entry => (
              <option key={`${entry.provider}\0${entry.id}`} value={entry.id}>{entry.name}</option>
            ))}
          </datalist>
          {hostProvider?.error === undefined ? null : (
            <p className={css.customNote}>{String(hostProvider.error)}</p>
          )}
          <p className={css.customNote}>{t('estimator.hostReuse')}</p>
          <p className={css.customNote}>{t('estimator.hostRoute').replace('{route}', effectiveRoute)}</p>
        </>
      ) : (
        <>
          <label className={css.field}>
            <span>{t('estimator.baseUrl')}</span>
            <input
              type="text"
              value={baseUrl}
              disabled={disabled}
              placeholder="https://127.0.0.1:8000/v1"
              onChange={(event) => { setBaseUrl(event.currentTarget.value) }}
              onBlur={() => { if (baseUrl !== (options.estimatorBaseUrl ?? '')) commit({ estimatorBaseUrl: baseUrl }) }}
            />
          </label>
          <label className={css.field}>
            <span>{t('estimator.model')}</span>
            <input
              type="text"
              value={model}
              disabled={disabled}
              onChange={(event) => { setModel(event.currentTarget.value) }}
              onBlur={() => { if (model !== (options.estimatorModel ?? '')) commit({ estimatorModel: model }) }}
            />
          </label>
          <label className={css.field}>
            <span>{t('estimator.apiKey')}</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keyDraft}
                disabled={disabled}
                placeholder={hasKey ? t('estimator.apiKey.set') : t('estimator.apiKey.placeholder')}
                onChange={(event) => { setKeyDraft(event.currentTarget.value) }}
                onBlur={() => {
                  const next = keyDraft.trim()
                  if (next === '') return
                  settle(() => save({ estimatorApiKey: next }))
                  setKeyDraft('')
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
              {hasKey ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => { settle(() => save({ estimatorApiKey: undefined })) }}
                >
                  {t('estimator.apiKey.clear')}
                </button>
              ) : null}
            </div>
            {hasKey ? <span className={css.customNote}>{t('estimator.apiKey.overwrite')}</span> : null}
          </label>
        </>
      )}
    </section>
  )
}
