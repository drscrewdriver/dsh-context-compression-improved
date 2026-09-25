// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'
import type { CompressionSelectorInjected } from '../src/client/CompressionProfileSelector.tsx'
import type { ContextCompressionSettings } from '../src/profiles.ts'

/**
 * 0.1.7 contract: the compression document rides the entry config as ONE
 * volatile whole-object field, so every write commits the full document
 * through `configForms.set('settings', doc)`. The sibling-safety that the old
 * path-addressed settings service provided is now enforced CLIENT-side:
 * `planPresetOptionsOps` is still computed against the current doc and applied
 * locally before the commit, so a second field write never erases the first.
 */

interface FormStub {
  form: Record<string, unknown>
  /** Whole-doc commits the fake Host accepted. */
  readonly commits: Record<string, unknown>[]
  /** Whole-doc writes the fake Host refused. */
  readonly refused: Record<string, unknown>[]
  readonly snapshot: () => Record<string, unknown>
}

function createFormStub(initial: ContextCompressionSettings, commit = true): FormStub {
  let revision = 1
  let value: Record<string, unknown> = { settings: structuredClone(initial) as unknown as Record<string, unknown> }
  const commits: Record<string, unknown>[] = []
  const refused: Record<string, unknown>[] = []
  const listeners = new Set<() => void>()
  return {
    commits,
    refused,
    snapshot: () => structuredClone(value.settings as Record<string, unknown>),
    form: {
      getSnapshot: () => ({
        status: 'ready' as const,
        value: value as unknown as Record<string, unknown>,
        revision,
        writable: true,
        base: undefined,
        user: undefined,
        mode: 'host' as const,
      }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: (_field: string, doc: unknown) => {
        if (!commit) {
          refused.push(doc as Record<string, unknown>)
          return Promise.resolve(false)
        }
        value = { settings: structuredClone(doc) as unknown as Record<string, unknown> }
        revision += 1
        commits.push({ settings: structuredClone(doc) as unknown as Record<string, unknown> })
        for (const listener of listeners) listener()
        return Promise.resolve(true)
      },
      unset: () => Promise.resolve(false),
    },
  } as FormStub & { form: Record<string, unknown> }
}

const DEFAULT_CUSTOM = {
  version: 1,
  unit: 'tokens',
  fresh: { enabled: true, trigger: 4_096, target: 2_048 },
  aggregate: { enabled: true, trigger: 16_384, target: 8_192 },
  history: {
    enabled: true,
    trigger: 16_384,
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
  stub: FormStub
} {
  const settings: ContextCompressionSettings = {
    profile: 'tokenpilot-inspired',
    custom: structuredClone(DEFAULT_CUSTOM),
    autoCompact: { thresholdPercent: 80 },
    codeSkeleton: { enabled: false },
    ...(presetOptions === undefined ? {} : { presetOptions }),
  }
  const stub = createFormStub(settings, commit)
  let options: Record<string, unknown> | undefined
  const ctx = {
    slots: {
      inject: (_slot: string, factory: () => (() => void) | Generator<() => void>) => {
        const result = factory()
        return typeof result === 'function' ? result : () => {}
      },
      register: (registerOptions: Record<string, unknown>) => {
        // The R4 overlay registration rides the same slots service; only the
        // settings card carries the inject factory these tests drive.
        if (registerOptions.name === 'settings.section') options = registerOptions
        return () => {}
      },
    },
    // apply consumes the services through their declarative-inject faces
    // (ctx.locale / ctx.configForms), the same shape cordis binds on the host.
    locale: { bind: () => (key: string) => key, register: () => {} },
    configForms: { get: () => (stub.form as unknown as { getSnapshot(): unknown }) },
  }
  apply(ctx as never)
  if (options === undefined) throw new Error('the settings card never registered')
  const factory = options['inject'] as () => CompressionSelectorInjected
  return { injected: factory(), stub }
}

describe('presetOptions writes commit the whole doc through configForms', () => {
  it('keeps the estimator channel when a provider is chosen afterwards', async () => {
    const { injected, stub } = bindInjected({ estimatorMode: 'host' })
    await injected.savePresetOptions({ estimatorProvider: 'local-35b' })
    expect(stub.snapshot()['presetOptions']).toEqual({ estimatorMode: 'host', estimatorProvider: 'local-35b' })
    expect(stub.commits.length).toBe(1)
  })

  it('treats a retired review-gate patch as a no-op instead of a write', async () => {
    const { injected, stub } = bindInjected({ estimatorMode: 'host' })
    // The patch surface no longer carries these keys, and the decoders accept
    // them only so a legacy document keeps loading. Cast past the removed type
    // so the test pins the RUNTIME behaviour: nothing is written.
    await injected.savePresetOptions({
      reviewMode: true,
      reviewTimeoutTurns: 8,
      cacheHitDiscountAlpha: 0.2,
      reviewHighImpactTokens: 6000,
    } as unknown as Parameters<typeof injected.savePresetOptions>[0])
    expect(stub.commits.length).toBe(0)
    expect(stub.snapshot()['presetOptions']).toEqual({ estimatorMode: 'host' })
  })

  it('never loses sibling overrides across whole-doc commits', async () => {
    const { injected, stub } = bindInjected({
      estimatorMode: 'direct',
      estimatorBaseUrl: 'http://192.168.100.242:8200',
      dedupeToolResults: false,
      readState: false,
    })
    await injected.savePresetOptions({ estimatorModel: 'Qwen3.6-35B-A3B' })
    await injected.savePresetOptions({ estimatorProvider: 'local-35b' })
    expect(stub.snapshot()['presetOptions']).toEqual({
      estimatorMode: 'direct',
      estimatorBaseUrl: 'http://192.168.100.242:8200',
      dedupeToolResults: false,
      readState: false,
      estimatorModel: 'Qwen3.6-35B-A3B',
      estimatorProvider: 'local-35b',
    })
    // Two user actions, two whole-doc commits.
    expect(stub.commits.length).toBe(2)
    for (const doc of stub.commits) {
      // Each commit carries the complete document under the volatile field.
      expect(Object.keys(doc)).toEqual(['settings'])
    }
  })

  it('clears exactly the field a patch names with undefined', async () => {
    const { injected, stub } = bindInjected({ estimatorMode: 'direct', estimatorApiKey: 'sk-stored' })
    await injected.savePresetOptions({ estimatorApiKey: undefined })
    expect(stub.snapshot()['presetOptions']).toEqual({ estimatorMode: 'direct' })
  })

  it('writes nothing when the patch already matches the stored section', async () => {
    const { injected, stub } = bindInjected({ estimatorMode: 'host', estimatorProvider: 'local-35b' })
    await injected.savePresetOptions({ estimatorMode: 'host' })
    expect(stub.commits.length).toBe(0)
    expect(stub.refused.length).toBe(0)
  })

  it('reports a save the Host did not commit', async () => {
    const { injected } = bindInjected({ estimatorMode: 'host' }, false)
    await expect(injected.savePresetOptions({ estimatorProvider: 'local-35b' }))
      .rejects.toThrow(/were not saved/)
  })
})
