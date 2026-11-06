// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CUSTOM_COMPRESSION_POLICY,
  DEFAULT_PTC_COMPRESSION_POLICY,
  type ContextCompressionSettings,
} from '../src/profiles.ts'
import { apply } from '../src/client/index.ts'
import type { CompressionSelectorInjected } from '../src/client/CompressionProfileSelector.tsx'

/**
 * PTC writes only touch `ptcCustom`: the scope commits the whole settings
 * document with the single field replaced, so `custom` / `tokenpilot-inspired`
 * policies are never collateral damage.
 */
describe('ptcCustom write isolation', () => {
  it('writes only ptcCustom and leaves custom untouched', async () => {
    const originalCustom = structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY)
    const originalPtc = structuredClone(DEFAULT_PTC_COMPRESSION_POLICY)
    let revision = 1
    let value: ContextCompressionSettings = {
      profile: 'ptc',
      custom: originalCustom,
      ptcCustom: originalPtc,
      autoCompact: { thresholdPercent: 80 },
      codeSkeleton: { enabled: false },
      intentSummary: { enabled: false },
    }
    const form = {
      getSnapshot: () => ({
        status: 'ready' as const,
        value: { settings: value },
        base: undefined,
        user: undefined,
        revision,
        writable: true,
        mode: 'host' as const,
      }),
      subscribe: () => () => {},
      set: vi.fn(async (_field: string, next: unknown) => {
        revision += 1
        value = structuredClone(next) as ContextCompressionSettings
        return true
      }),
      unset: vi.fn(async () => false),
    }
    let injected: (() => CompressionSelectorInjected) | undefined
    const ctx = {
      effect: (install: () => unknown) => { install() },
      locale: { register: vi.fn(() => () => {}) },
      configForms: { get: vi.fn(() => form) },
      inject: (services: string[], cb: (service: unknown) => void) => {
        if (services.includes('configForms')) cb(ctx.configForms)
      },
      slots: {
        inject: (_slot: string, install: () => unknown) => { install() },
        register: (registration: { name?: string, inject?: () => CompressionSelectorInjected }) => {
          if (registration.name === 'settings.section' && typeof registration.inject === 'function') injected = registration.inject
          return () => {}
        },
      },
    } as unknown as Parameters<typeof apply>[0]

    apply(ctx)
    const actions = injected?.()
    expect(actions).toBeDefined()
    if (actions === undefined) throw new Error('selector injection was not registered')

    const editedPtc = {
      ...structuredClone(DEFAULT_PTC_COMPRESSION_POLICY),
      history: { ...structuredClone(DEFAULT_PTC_COMPRESSION_POLICY).history, trigger: 18_000 },
    }
    await expect(actions.savePtcCustom(editedPtc)).resolves.toBeUndefined()
    expect(form.set).toHaveBeenLastCalledWith('settings', expect.objectContaining({
      ptcCustom: expect.objectContaining({ history: expect.objectContaining({ trigger: 18_000 }) }),
    }))
    expect(value.ptcCustom?.history.trigger).toBe(18_000)
    // custom must be byte-identical to its pre-write value.
    expect(value.custom).toEqual(originalCustom)

    await expect(actions.resetPtcCustom()).resolves.toBeUndefined()
    expect(value.ptcCustom).toEqual(DEFAULT_PTC_COMPRESSION_POLICY)
    expect(value.custom).toEqual(originalCustom)
  })
})
