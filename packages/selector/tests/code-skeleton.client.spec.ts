// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CUSTOM_COMPRESSION_POLICY } from '../src/profiles.ts'
import { apply } from '../src/client/index.ts'
import type { CompressionSelectorInjected } from '../src/client/CompressionProfileSelector.tsx'
import type { ContextCompressionSettings } from '../src/profiles.ts'
import type { ClientContext } from '../src/client/index.ts'

/**
 * 0.1.7 contract: `codeSkeleton` rides the entry config as part of the volatile
 * `settings` whole-object field. Every write commits the full doc through
 * `configForms.set('settings', doc)`; the confirm-on-write semantics are
 * unchanged — a host that silently drops (or flips) the section fails the
 * acceptance check on the post-commit snapshot.
 */

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
    const form = {
      getSnapshot: vi.fn(() => ({
        status: 'ready' as const,
        value: { settings: value },
        base: undefined,
        user: undefined,
        revision,
        writable: true,
        mode: 'host' as const,
      })),
      subscribe: vi.fn(() => () => {}),
      set: vi.fn(async (_field: string, next: unknown) => {
        if (!commit) return false
        revision += 1
        const doc = structuredClone(next) as ContextCompressionSettings
        if (flipEnabled) {
          const accepted = structuredClone(doc.codeSkeleton)
          accepted.enabled = !accepted.enabled
          value = { ...doc, codeSkeleton: accepted }
          return true
        }
        value = doc
        return true
      }),
      unset: vi.fn(async () => false),
    }
    let injected: (() => CompressionSelectorInjected) | undefined
    const ctx = {
      effect: (install: () => unknown) => { install() },
      locale: { register: vi.fn(() => () => {}) },
      configForms: { get: vi.fn(() => form) },
      slots: {
        inject: (_slot: string, install: () => unknown) => { install() },
        register: (registration: { inject?: () => CompressionSelectorInjected }) => {
          // The R4 overlay registration carries no inject face; keep the card's.
          if (typeof registration.inject === 'function') injected = registration.inject
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

    // A committed write resolves and persists the exact section payload under
    // the volatile `settings` field.
    commit = true
    await expect(actions.saveCodeSkeleton(true)).resolves.toBeUndefined()
    expect(form.set).toHaveBeenLastCalledWith('settings', expect.objectContaining({ codeSkeleton: { enabled: true } }))
    expect(value.codeSkeleton).toEqual({ enabled: true })

    // A host that flips the toggled bit fails the acceptance check.
    flipEnabled = true
    await expect(actions.saveCodeSkeleton(false)).rejects.toThrow('were not saved')

    flipEnabled = false
    await expect(actions.saveCodeSkeleton(false)).resolves.toBeUndefined()
    expect(form.set).toHaveBeenLastCalledWith('settings', expect.objectContaining({ codeSkeleton: { enabled: false } }))
    expect(value.codeSkeleton).toEqual({ enabled: false })
  })
})
