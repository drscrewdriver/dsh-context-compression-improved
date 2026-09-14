// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'
import type { CompressionSelectorInjected } from '../src/client/CompressionProfileSelector.tsx'
import type { ContextCompressionSettings } from '../src/profiles.ts'

/**
 * `settingsScope.set(field, value)` replaces the value at that field, so the
 * write path is asserted through the document it stores: writing the bare
 * patch is what silently deleted `estimatorMode` (and every sibling override)
 * whenever the user touched a second field of the TokenPilot-inspired card.
 */

type ScopeFace = {
  getSnapshot: () => unknown
  subscribe: (listener: () => void) => () => void
  set: (field: string, value: unknown) => Promise<void>
  unset: (field: string) => Promise<void>
}

function createScopeStub(initial: ContextCompressionSettings, commit = true): {
  scope: ScopeFace
  writes: { field: string, value: unknown }[]
  section: () => Record<string, unknown>
  sectionOf: (key: string) => unknown
} {
  let revision = 1
  let value: Record<string, unknown> = structuredClone(initial) as unknown as Record<string, unknown>
  const writes: { field: string, value: unknown }[] = []
  const listeners = new Set<() => void>()
  const scope: ScopeFace = {
    getSnapshot: () => ({
      status: 'ready',
      value: value as unknown as ContextCompressionSettings,
      base: undefined,
      user: undefined,
      revision,
      writable: true,
      mode: 'host',
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (field: string, fieldValue: unknown) => {
      writes.push({ field, value: fieldValue })
      // The Host applies `set` AT the path: the section value is replaced.
      if (commit) {
        value = { ...value, [field]: structuredClone(fieldValue) }
        revision += 1
        for (const listener of listeners) listener()
      }
      return Promise.resolve()
    },
    unset: (field: string) => {
      writes.push({ field, value: undefined })
      if (commit) {
        delete value[field]
        revision += 1
        for (const listener of listeners) listener()
      }
      return Promise.resolve()
    },
  }
  return {
    scope,
    writes,
    section: () => value,
    sectionOf: (key: string) => value[key],
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

function bindInjected(
  presetOptions: ContextCompressionSettings['presetOptions'],
  commit = true,
): {
  injected: CompressionSelectorInjected
  writes: { field: string, value: unknown }[]
  sectionOf: (key: string) => unknown
} {
  const settings: ContextCompressionSettings = {
    profile: 'tokenpilot-inspired',
    custom: structuredClone(DEFAULT_CUSTOM),
    autoCompact: { thresholdPercent: 80 },
    codeSkeleton: { enabled: false },
    ...(presetOptions === undefined ? {} : { presetOptions }),
  }
  const stub = createScopeStub(settings, commit)
  let options: Record<string, unknown> | undefined
  const ctx = {
    effect: (factory: () => unknown) => { factory(); return () => {} },
    locale: { register: () => {}, bind: () => (key: string) => key },
    settingsScope: { bind: () => stub.scope },
    slots: {
      inject: (_slot: string, factory: () => (() => void) | Generator<() => void>) => {
        const result = factory()
        return typeof result === 'function' ? result : () => {}
      },
      register: (registerOptions: Record<string, unknown>) => {
        options = registerOptions
        return () => {}
      },
    },
  }
  apply(ctx as never)
  if (options === undefined) throw new Error('the settings card never registered')
  const factory = options['inject'] as () => CompressionSelectorInjected
  return { injected: factory(), writes: stub.writes, sectionOf: stub.sectionOf }
}

describe('presetOptions writes preserve sibling fields', () => {
  it('keeps the estimator channel when a provider is chosen afterwards', async () => {
    const { injected, sectionOf } = bindInjected({ estimatorMode: 'host' })
    await injected.savePresetOptions({ estimatorProvider: 'local-35b' })
    expect(sectionOf('presetOptions')).toEqual({ estimatorMode: 'host', estimatorProvider: 'local-35b' })
  })

  it('writes the merged document rather than the bare patch', async () => {
    const { injected, writes } = bindInjected({ estimatorMode: 'direct', estimatorBaseUrl: 'http://192.168.100.242:8200' })
    await injected.savePresetOptions({ estimatorModel: 'Qwen3.6-35B-A3B' })
    expect(writes).toEqual([{
      field: 'presetOptions',
      value: {
        estimatorMode: 'direct',
        estimatorBaseUrl: 'http://192.168.100.242:8200',
        estimatorModel: 'Qwen3.6-35B-A3B',
      },
    }])
  })

  it('keeps every unrelated override across successive edits', async () => {
    const { injected, sectionOf } = bindInjected({
      estimatorMode: 'direct',
      dedupeToolResults: false,
      readState: false,
    })
    await injected.savePresetOptions({ estimatorModel: 'Qwen3.6-35B-A3B' })
    await injected.savePresetOptions({ estimatorProvider: 'local-35b' })
    expect(sectionOf('presetOptions')).toEqual({
      estimatorMode: 'direct',
      dedupeToolResults: false,
      readState: false,
      estimatorModel: 'Qwen3.6-35B-A3B',
      estimatorProvider: 'local-35b',
    })
  })

  it('clears exactly the field a patch names with undefined', async () => {
    const { injected, sectionOf } = bindInjected({ estimatorMode: 'direct', estimatorApiKey: 'sk-stored' })
    await injected.savePresetOptions({ estimatorApiKey: undefined })
    expect(sectionOf('presetOptions')).toEqual({ estimatorMode: 'direct' })
  })

  it('writes nothing when the patch already matches the stored section', async () => {
    const { injected, writes } = bindInjected({ estimatorMode: 'host', estimatorProvider: 'local-35b' })
    await injected.savePresetOptions({ estimatorMode: 'host' })
    expect(writes).toEqual([])
  })

  it('reports a save the Host did not commit', async () => {
    const { injected } = bindInjected({ estimatorMode: 'host' }, false)
    await expect(injected.savePresetOptions({ estimatorProvider: 'local-35b' }))
      .rejects.toThrow(/were not saved/)
  })
})
