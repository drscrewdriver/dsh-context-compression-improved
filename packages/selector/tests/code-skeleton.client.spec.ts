import { describe, expect, it, vi } from 'vitest'
import type { ClientContext, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_CUSTOM_COMPRESSION_POLICY } from '../src/profiles.ts'
import { apply } from '../src/client/index.ts'
import type {
  CompressionSelectorInjected,
  ContextCompressionSettings,
} from '../src/client/CompressionProfileSelector.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
  Menu: () => null,
}))

describe('codeSkeleton confirm-on-write client contract', () => {
  it('resolves only when the host confirms the toggled value and rejects silent drops', async () => {
    let revision = 3
    let commit = false
    let flipEnabled = false
    let value: ContextCompressionSettings = {
      profile: 'balanced',
      custom: structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY),
      autoCompact: { thresholdPercent: 80 },
      codeSkeleton: { enabled: false },
    }
    const snapshot = (): SettingsScopeSnapshot<ContextCompressionSettings> => ({
      status: 'ready',
      value,
      base: undefined,
      user: undefined,
      revision,
      writable: true,
      mode: 'host',
    })
    const scope = {
      getSnapshot: snapshot,
      subscribe: vi.fn(() => () => {}),
      set: vi.fn(async (field: string, next: unknown) => {
        if (!commit) return
        revision += 1
        if (field === 'codeSkeleton' && flipEnabled) {
          const accepted = structuredClone(next as ContextCompressionSettings['codeSkeleton'])
          accepted.enabled = !accepted.enabled
          value = { ...value, codeSkeleton: accepted }
          return
        }
        value = { ...value, [field]: next }
      }),
      unset: vi.fn(async () => {}),
    }
    let injected: (() => CompressionSelectorInjected) | undefined
    const ctx = {
      effect: (install: () => unknown) => { install() },
      locale: { register: vi.fn(() => () => {}) },
      settingsScope: { bind: vi.fn(() => scope) },
      slots: {
        inject: (_slot: string, install: () => unknown) => { install() },
        register: (registration: { inject: () => CompressionSelectorInjected }) => {
          injected = registration.inject
          return () => {}
        },
      },
    } as unknown as ClientContext

    apply(ctx)
    const actions = injected?.()
    expect(actions).toBeDefined()
    if (actions === undefined) throw new Error('selector injection was not registered')

    // A silent host drop leaves the revision untouched: the write must reject.
    await expect(actions.saveCodeSkeleton(true)).rejects.toThrow('were not saved')

    // A committed write resolves and persists the exact section payload.
    commit = true
    await expect(actions.saveCodeSkeleton(true)).resolves.toBeUndefined()
    expect(scope.set).toHaveBeenLastCalledWith('codeSkeleton', { enabled: true })
    expect(value.codeSkeleton).toEqual({ enabled: true })

    // A host that flips the toggled bit fails the acceptance check.
    flipEnabled = true
    await expect(actions.saveCodeSkeleton(false)).rejects.toThrow('were not saved')

    flipEnabled = false
    await expect(actions.saveCodeSkeleton(false)).resolves.toBeUndefined()
    expect(scope.set).toHaveBeenLastCalledWith('codeSkeleton', { enabled: false })
    expect(value.codeSkeleton).toEqual({ enabled: false })
  })
})
