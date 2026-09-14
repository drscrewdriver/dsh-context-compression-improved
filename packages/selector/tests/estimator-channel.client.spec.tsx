// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ContextCompressionSettingsSection,
  type CompressionProfileSelectorProps,
  type ContextCompressionSettings,
} from '../src/client/CompressionProfileSelector.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

interface SnapshotStore<T> {
  readonly getSnapshot: () => T
  readonly subscribe: (listener: () => void) => () => void
}

function createSnapshotStore<T>(initial: T): SnapshotStore<T> {
  const snapshot = structuredClone(initial)
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

function bindSnapshotSelector<T>(store: SnapshotStore<T>) {
  return function useSnapshotSelector<U>(selector: (snapshot: T) => U): U {
    return useSyncExternalStore(
      store.subscribe,
      () => selector(store.getSnapshot()),
      () => selector(store.getSnapshot()),
    )
  }
}

const DEFAULT_CUSTOM = {
  version: 1,
  unit: 'tokens',
  fresh: { enabled: true, trigger: 4_096, target: 2_048 },
  aggregate: { enabled: true, trigger: 16_384, target: 8_192 },
  history: {
    enabled: true,
    trigger: 32_768,
    keepRecentTurns: 2,
    keepRecent: 16_384,
    minReclaim: 8_192,
  },
  prefixPolicy: 'pressure-break',
} as const satisfies ContextCompressionSettings['custom']

const t = (key: string) => en[key as keyof typeof en] ?? key

const PROVIDER_LABEL = 'Provider'
const MODEL_LABEL = 'Model'
const API_KEY_LABEL = 'API key (write-only, never echoed)'
const BASE_URL_LABEL = 'Endpoint base URL (/v1)'

const CATALOG = {
  ok: true,
  providers: [
    {
      id: 'local-35b',
      name: 'local-35b',
      models: [{ id: 'Qwen3.6-35B-A3B', name: 'Qwen3.6-35B-A3B' }, { id: 'Qwen38-27B', name: 'Qwen38-27B' }],
    },
    { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' }] },
  ],
  selection: { provider: 'deepseek-official', model: 'deepseek-flash' },
}

function mountEstimator(
  presetOptions: ContextCompressionSettings['presetOptions'],
  options: { readonly catalog?: unknown } = {},
) {
  const state = createSnapshotStore({
    status: 'ready' as const,
    value: {
      profile: 'tokenpilot-inspired' as const,
      custom: structuredClone(DEFAULT_CUSTOM),
      autoCompact: { thresholdPercent: 80 },
      codeSkeleton: { enabled: false },
      presetOptions: presetOptions ?? {},
    },
    base: undefined,
    user: undefined,
    revision: 0,
    writable: true,
    mode: 'host' as const,
  })
  const sessions = createSnapshotStore({
    ids: ['s1'],
    byId: { s1: { id: 's1', agentPreset: 'standard' } },
    current: 's1',
  })
  const savePresetOptions = vi.fn(() => Promise.resolve())
  if (options.catalog !== undefined) {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(options.catalog),
    })))
  }
  render(<ContextCompressionSettingsSection {...({
    useCompression: bindSnapshotSelector(state),
    useSessions: bindSnapshotSelector(sessions),
    select: vi.fn(() => Promise.resolve()),
    saveCustom: vi.fn(() => Promise.resolve()),
    resetCustom: vi.fn(() => Promise.resolve()),
    saveAutoCompact: vi.fn(() => Promise.resolve()),
    saveCodeSkeleton: vi.fn(() => Promise.resolve()),
    savePresetOptions,
    t,
  } as unknown as CompressionProfileSelectorProps)} />)
  return { savePresetOptions }
}

describe('estimator channel card', () => {
  it('host mode fills comboboxes from the catalog, keeps custom typing, and asks for no API key', async () => {
    const { savePresetOptions } = mountEstimator({ estimatorMode: 'host' }, { catalog: CATALOG })

    // Provider/model are always comboboxes (dsh-perm-gate receiver pattern):
    // a catalog pick fills the field, and the same input accepts a custom id.
    const provider = screen.getByLabelText<HTMLInputElement>(PROVIDER_LABEL)
    const model = screen.getByLabelText<HTMLInputElement>(MODEL_LABEL)
    await waitFor(() => {
      const providerOptions = document.querySelectorAll('#estimator-provider-options option')
      expect([...providerOptions].map(option => (option as HTMLOptionElement).value))
        .toEqual(['local-35b', 'deepseek-official'])
      expect(provider.getAttribute('list')).toBe('estimator-provider-options')
      expect(model.getAttribute('list')).toBe('estimator-model-options')
    })
    expect(screen.getByText(/Effective route: deepseek-official \/ deepseek-flash/)).not.toBeNull()
    expect(screen.getByText(/no API key is needed/)).not.toBeNull()

    // No credential input and no base-URL field on this channel.
    expect(screen.queryByLabelText(API_KEY_LABEL)).toBeNull()
    expect(screen.queryByLabelText(BASE_URL_LABEL)).toBeNull()
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0)

    // A datalist pick fires change without blur: it commits immediately.
    fireEvent.change(provider, { target: { value: 'local-35b' } })
    await waitFor(() => {
      expect(savePresetOptions).toHaveBeenCalledWith({ estimatorProvider: 'local-35b' })
    })
    // Free typing only commits on blur, so mid-edit keystrokes never save.
    fireEvent.change(provider, { target: { value: 'my-custom-group' } })
    expect(savePresetOptions).not.toHaveBeenCalledWith({ estimatorProvider: 'my-custom-group' })
    fireEvent.blur(provider)
    await waitFor(() => {
      expect(savePresetOptions).toHaveBeenCalledWith({ estimatorProvider: 'my-custom-group' })
    })
  })

  it('offers the catalog models of the chosen provider and commits one', async () => {
    const { savePresetOptions } = mountEstimator(
      { estimatorMode: 'host', estimatorProvider: 'local-35b' },
      { catalog: CATALOG },
    )
    // Query before the catalog lands: once the datalist has options, the
    // label's textContent includes them and getByLabelText's exact match
    // would no longer see a bare "Model".
    const model = screen.getByLabelText<HTMLInputElement>(MODEL_LABEL)
    expect(model.value).toBe('')
    await waitFor(() => {
      const modelOptions = document.querySelectorAll('#estimator-model-options option')
      expect([...modelOptions].map(option => (option as HTMLOptionElement).value))
        .toEqual(['Qwen3.6-35B-A3B', 'Qwen38-27B'])
    })
    expect(screen.getByText(/Effective route: local-35b/)).not.toBeNull()

    fireEvent.change(model, { target: { value: 'Qwen38-27B' } })
    await waitFor(() => {
      expect(savePresetOptions).toHaveBeenCalledWith({ estimatorModel: 'Qwen38-27B' })
    })
  })

  it('still accepts custom names — without a credential field — when no catalog is served', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no route'))))
    const { savePresetOptions } = mountEstimator({ estimatorMode: 'host' })

    const provider = screen.getByLabelText<HTMLInputElement>(PROVIDER_LABEL)
    expect(screen.getByLabelText(MODEL_LABEL).tagName).toBe('INPUT')
    expect(document.querySelectorAll('#estimator-provider-options option').length).toBe(0)
    expect(document.querySelectorAll('#estimator-model-options option').length).toBe(0)
    fireEvent.change(provider, { target: { value: 'manual-group' } })
    fireEvent.blur(provider)
    await waitFor(() => {
      expect(savePresetOptions).toHaveBeenCalledWith({ estimatorProvider: 'manual-group' })
    })
    expect(screen.queryByLabelText(API_KEY_LABEL)).toBeNull()
    expect(screen.getByText(/no API key is needed/)).not.toBeNull()
    expect(screen.getByText(/not determined yet/)).not.toBeNull()
  })

  it('keeps the endpoint and key fields on the direct channel alone', () => {
    mountEstimator({ estimatorMode: 'direct' })

    expect(screen.getByLabelText(BASE_URL_LABEL)).not.toBeNull()
    expect(screen.getByLabelText(MODEL_LABEL).tagName).toBe('INPUT')
    expect(screen.getByLabelText(API_KEY_LABEL)).not.toBeNull()
    expect(document.querySelectorAll('input[type="password"]').length).toBe(1)
    expect(screen.queryByLabelText(PROVIDER_LABEL)).toBeNull()
    expect(screen.queryByText(/no API key is needed/)).toBeNull()
  })

  it('renders no channel controls while the estimator is off', () => {
    mountEstimator({})
    expect(screen.queryByLabelText(API_KEY_LABEL)).toBeNull()
    expect(screen.queryByLabelText(BASE_URL_LABEL)).toBeNull()
    expect(screen.queryByLabelText(PROVIDER_LABEL)).toBeNull()
  })
})
