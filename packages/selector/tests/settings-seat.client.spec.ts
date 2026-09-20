/**
 * Settings-seat contract pin for dsh-context-compression-improved's client.
 *
 * This spec locks WHERE the compression settings panel mounts: exactly ONE
 * seat — the standalone `settings.section` entry (设置 → 上下文压缩) — and
 * explicitly NOT the Plugins-section surfaces, and NOT a `shell.overlay` float
 * (the retired review panel's seat was removed with the gate). History this
 * pins against: the 0.1.5 line first lost every entry (a lazy `ctx.get` of
 * locale/settingsScope raced the settings client and apply bailed), then showed
 * the panel twice (item card + tab on top of the standalone section). Both were
 * fixed by the declarative-inject + single-section shape below. When a future
 * DSH line moves the seat again, migrate src/client/index.ts AND this file
 * together.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/client/index.ts'
import { ContextCompressionSettingsSection } from '../src/client/CompressionProfileSelector.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
  Menu: () => null,
}))

interface CapturedRegistration {
  readonly slot: string
  readonly options: Record<string, unknown>
  readonly component: unknown
}

/** Drive apply against a stub host and capture every slot registration. */
function collectRegistrations(): { declared: string[]; registrations: CapturedRegistration[] } {
  const declared: string[] = []
  const registrations: CapturedRegistration[] = []
  const ctx = {
    locale: { register: vi.fn(() => () => {}), bind: () => (key: string) => key },
    settingsScope: { bind: vi.fn(() => ({}) as never) },
    slots: {
      inject: (slot: string, factory: () => (() => void) | Generator<() => void>) => {
        declared.push(slot)
        const result = factory()
        const steps: Iterable<() => void> = typeof (result as { [Symbol.iterator]?: unknown })?.[Symbol.iterator] === 'function'
          ? (result as Generator<() => void>)
          : [result as () => void]
        for (const step of steps) { void step }
        return () => {}
      },
      register: (options: Record<string, unknown>, component: unknown) => {
        registrations.push({ slot: String(options['name']), options, component })
        return () => {}
      },
    },
  }
  apply(ctx as unknown as ClientContext)
  return { declared, registrations }
}

describe('settings-seat contract (standalone settings.section only)', () => {
  it('declares the services apply consumes (cordis waits; no lazy-get race)', () => {
    expect(inject).toEqual(['slots', 'locale', 'settingsScope'])
  })

  it('injects exactly the settings.section seat and nothing else', () => {
    const { declared, registrations } = collectRegistrations()
    expect(declared).toEqual(['settings.section'])
    expect(registrations).toHaveLength(1)
    expect(registrations[0]!.slot).toBe('settings.section')
  })

  it('no longer claims a shell.overlay float (the review panel it served is gone)', () => {
    const { declared } = collectRegistrations()
    expect(declared).not.toContain('shell.overlay')
  })

  it('pins the section identity (id/order/label/locale) and the panel component', () => {
    const { registrations } = collectRegistrations()
    const { options, component } = registrations[0]!
    expect(options['id']).toBe('context-compression')
    expect(options['order']).toBe(17)
    expect(options['locale']).toBe('context-compression')
    expect((options['label'] as () => string)()).toBe('nav')
    expect(typeof options['inject']).toBe('function')
    const face = (options['inject'] as () => Record<string, unknown>)()
    expect(Object.keys(face).sort()).toEqual(['hooks', 'saveAutoCompact', 'saveCodeSkeleton', 'saveCustom', 'savePresetOptions', 'select', 'resetCustom'].sort())
    expect(component).toBe(ContextCompressionSettingsSection)
  })

  it('never adds a Plugins-section card or tab alongside the standalone section', () => {
    const { declared } = collectRegistrations()
    expect(declared).not.toContain('settings.plugins.tab')
    expect(declared).not.toContain('settings.plugin.item')
  })
})
