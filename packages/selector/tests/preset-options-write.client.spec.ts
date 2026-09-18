// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'
import type { CompressionSelectorInjected } from '../src/client/CompressionProfileSelector.tsx'
import { DEFAULT_CUSTOM_COMPRESSION_POLICY, type ContextCompressionSettings } from '../src/profiles.ts'

/**
 * The settings transport applies a `set` op AT its path, so the write path is
 * asserted through the ops it submits: a whole-section write is what silently
 * deleted `estimatorMode` (and every sibling override) whenever the user
 * touched a second field of the TokenPilot-inspired card.
 */

type PathOp = { op: 'set', path: string[], value: unknown } | { op: 'unset', path: string[] }

interface ScopeStub {
  readonly writes: PathOp[][]
  readonly snapshot: () => Record<string, unknown>
}

/** Emulate the Host settings service: apply ops at their path, then bump the revision. */
function createScopeStub(initial: ContextCompressionSettings, commit = true): ScopeStub {
  let revision = 1
  let value: Record<string, unknown> = structuredClone(initial) as unknown as Record<string, unknown>
  const writes: PathOp[][] = []
  const listeners = new Set<() => void>()
  const applyOps = (ops: readonly PathOp[]): void => {
    const before = JSON.stringify(value)
    for (const op of ops) {
      const [head, ...rest] = op.path
      if (head === undefined) continue
      if (rest.length === 0) {
        if (op.op === 'set') value = { ...value, [head]: op.value }
        else delete value[head]
        continue
      }
      const child = { ...(value[head] as Record<string, unknown> | undefined) }
      const leaf = rest[rest.length - 1] as string
      if (op.op === 'set') child[leaf] = op.value
      else delete child[leaf]
      value = { ...value, [head]: child }
    }
    // The Host bumps its revision only when the RAW section actually changed
    // (`deepEqualJson` guard in dsh-settings `bumpRevision`), so a write that
    // merely restates the stored value leaves the revision where it was.
    // Bumping unconditionally made this double MORE forgiving than the Host and
    // hid the no-op false failure below.
    if (JSON.stringify(value) === before) return
    revision += 1
    for (const listener of listeners) listener()
  }
  return {
    writes,
    snapshot: () => value,
    // The scope face the injection factory binds.
    scope: {
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
        const ops: PathOp[] = [{ op: 'set', path: [field], value: fieldValue }]
        writes.push(ops)
        // A refused or lost write changes no document, whichever verb carried
        // it — `set` must honour `commit` exactly as `mutate` does.
        if (commit) applyOps(ops)
        return Promise.resolve()
      },
      unset: (field: string) => {
        const ops: PathOp[] = [{ op: 'unset', path: [field] }]
        writes.push(ops)
        if (commit) applyOps(ops)
        return Promise.resolve()
      },
      mutate: (ops: readonly PathOp[]) => {
        writes.push([...ops])
        // A refused or lost write changes no document, so the revision the
        // confirmation read fences on never moves.
        if (commit) applyOps(ops)
        return Promise.resolve()
      },
    },
  } as ScopeStub & { scope: unknown }
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
  custom: ContextCompressionSettings['custom'] = structuredClone(DEFAULT_CUSTOM),
): {
  injected: CompressionSelectorInjected
  writes: PathOp[][]
  snapshot: () => Record<string, unknown>
} {
  const settings: ContextCompressionSettings = {
    profile: 'tokenpilot-inspired',
    custom,
    autoCompact: { thresholdPercent: 80 },
    codeSkeleton: { enabled: false },
    ...(presetOptions === undefined ? {} : { presetOptions }),
  }
  const stub = createScopeStub(settings, commit)
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
    // (ctx.locale / ctx.settingsScope), the same shape cordis binds on the host.
    locale: { bind: () => (key: string) => key, register: () => {} },
    settingsScope: { bind: () => (stub as unknown as { scope: unknown }).scope },
  }
  apply(ctx as never)
  if (options === undefined) throw new Error('the settings card never registered')
  const factory = options['inject'] as () => CompressionSelectorInjected
  return { injected: factory(), writes: stub.writes, snapshot: stub.snapshot }
}

describe('presetOptions writes are path-addressed', () => {
  it('keeps the estimator channel when a provider is chosen afterwards', async () => {
    const { injected, writes, snapshot } = bindInjected({ estimatorMode: 'host' })
    await injected.savePresetOptions({ estimatorProvider: 'local-35b' })
    expect(snapshot()['presetOptions']).toEqual({ estimatorMode: 'host', estimatorProvider: 'local-35b' })
    expect(writes).toEqual([[{ op: 'set', path: ['presetOptions', 'estimatorProvider'], value: 'local-35b' }]])
  })

  it('writes and clears the review-mode fields without touching estimator siblings', async () => {
    const { injected, writes, snapshot } = bindInjected({ estimatorMode: 'host' })
    await injected.savePresetOptions({
      reviewMode: true,
      reviewTimeoutTurns: 8,
      cacheHitDiscountAlpha: 0.2,
      reviewHighImpactTokens: 6000,
    })
    expect(snapshot()['presetOptions']).toEqual({
      estimatorMode: 'host',
      reviewMode: true,
      reviewTimeoutTurns: 8,
      cacheHitDiscountAlpha: 0.2,
      reviewHighImpactTokens: 6000,
    })
    await injected.savePresetOptions({ reviewMode: undefined })
    expect(snapshot()['presetOptions']).toEqual({
      estimatorMode: 'host',
      reviewTimeoutTurns: 8,
      cacheHitDiscountAlpha: 0.2,
      reviewHighImpactTokens: 6000,
    })
    for (const batch of writes) {
      for (const op of batch) {
        expect(op.path).toEqual(['presetOptions', op.path[1] ?? ''])
        expect(['reviewMode', 'reviewTimeoutTurns', 'cacheHitDiscountAlpha', 'reviewHighImpactTokens'])
          .toContain(op.path[1])
      }
    }
  })

  it('never replaces the whole section, so sibling overrides survive', async () => {
    const { injected, writes, snapshot } = bindInjected({
      estimatorMode: 'direct',
      estimatorBaseUrl: 'http://192.168.100.242:8200',
      dedupeToolResults: false,
      readState: false,
    })
    await injected.savePresetOptions({ estimatorModel: 'Qwen3.6-35B-A3B' })
    await injected.savePresetOptions({ estimatorProvider: 'local-35b' })
    expect(snapshot()['presetOptions']).toEqual({
      estimatorMode: 'direct',
      estimatorBaseUrl: 'http://192.168.100.242:8200',
      dedupeToolResults: false,
      readState: false,
      estimatorModel: 'Qwen3.6-35B-A3B',
      estimatorProvider: 'local-35b',
    })
    for (const batch of writes) {
      for (const op of batch) expect(op.path.length).toBe(2)
    }
  })

  it('clears exactly the field a patch names with undefined', async () => {
    const { injected, writes, snapshot } = bindInjected({ estimatorMode: 'direct', estimatorApiKey: 'sk-stored' })
    await injected.savePresetOptions({ estimatorApiKey: undefined })
    expect(snapshot()['presetOptions']).toEqual({ estimatorMode: 'direct' })
    expect(writes).toEqual([[{ op: 'unset', path: ['presetOptions', 'estimatorApiKey'] }]])
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

/**
 * F15 — a write that restates the stored value is a legitimate no-op, not a
 * failure.
 *
 * The Host's `bumpRevision` is guarded by `deepEqualJson`: the revision moves
 * only when the RAW section changes. So re-saving the value that is already
 * stored can never move it, and confirming on the revision alone reported the
 * SECOND save of the same value as "Context compression settings were not
 * saved." Only `savePresetOptions` escaped it, because `planPresetOptionsOps`
 * filters no-ops at its own layer — the other five writers did not.
 *
 * The same no-op value must still be a real success: the user's intent is
 * already satisfied, and refusing it is indistinguishable from the genuine
 * Host rejection that the existing test above fences.
 */
describe('re-saving the stored value is a success, not a failed save', () => {
  const cases: [string, (injected: CompressionSelectorInjected) => Promise<void>][] = [
    ['select', injected => injected.select('tokenpilot-inspired')],
    ['saveCodeSkeleton', injected => injected.saveCodeSkeleton(false)],
    ['saveAutoCompact', injected => injected.saveAutoCompact(80)],
    ['savePresetOptions', injected => injected.savePresetOptions({ estimatorMode: 'host' })],
  ]

  it.each(cases)('%s', async (_name, save) => {
    const { injected } = bindInjected({ estimatorMode: 'host' })
    await expect(save(injected)).resolves.toBeUndefined()
  })

  it.each([
    ['saveCustom', (injected: CompressionSelectorInjected) => injected.saveCustom(
      structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY),
    )],
    ['resetCustom', (injected: CompressionSelectorInjected) => injected.resetCustom()],
  ] as typeof cases)('%s', async (_name, save) => {
    const { injected } = bindInjected(
      { estimatorMode: 'host' },
      true,
      structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY),
    )
    await expect(save(injected)).resolves.toBeUndefined()
  })

  it('still reports a real write the Host refused', async () => {
    const { injected } = bindInjected({ estimatorMode: 'host' }, false)
    await expect(injected.saveCodeSkeleton(true)).rejects.toThrow(/were not saved/)
  })
})
