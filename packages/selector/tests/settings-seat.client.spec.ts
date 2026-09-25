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
import { DEFAULT_CUSTOM_COMPRESSION_POLICY } from '../src/profiles.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutlineMedium: () => null,
  Menu: () => null,
}))

interface CapturedRegistration {
  readonly slot: string
  readonly options: Record<string, unknown>
  readonly component: unknown
}

/**
 * Drive apply against a stub host and capture every slot registration.
 * @param options - `registerThrows` models an older host that does not declare
 * the seat: the slot boundary rejects the registration, exactly the shape the
 * 0.1.2-era hosts had.
 */
function collectRegistrations(
  options: { readonly registerThrows?: boolean } = {},
): { declared: string[]; registrations: CapturedRegistration[] } {
  const declared: string[] = []
  const registrations: CapturedRegistration[] = []
  const ctx = {
    locale: { register: vi.fn(() => () => {}), bind: () => (key: string) => key },
    configForms: { get: vi.fn(() => ({}) as never) },
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
      register: (record: Record<string, unknown>, component: unknown) => {
        if (options.registerThrows === true) throw new Error(`unknown slot ${String(record['name'])}`)
        registrations.push({ slot: String(record['name']), options: record, component })
        return () => {}
      },
    },
  }
  apply(ctx as unknown as ClientContext)
  return { declared, registrations }
}

describe('settings-seat contract (standalone settings.section only)', () => {
  it('declares the services apply consumes (cordis waits; no lazy-get race)', () => {
    expect(inject).toEqual(['slots', 'locale', 'configForms'])
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

  it('projects an identity-stable snapshot between form changes (React #185 regression)', () => {
    // The 0.1.7 adapter wraps configForms into the legacy scope shape. Its
    // getSnapshot MUST return the same object reference until the underlying
    // form snapshot changes: a fresh literal per call re-renders
    // useSyncExternalStore forever — "Minified React error #185" (maximum
    // update depth exceeded), and the slot boundary abdicates the whole
    // settings.section on the production host.
    let source = {
      status: 'ready' as const,
      value: { settings: { profile: 'balanced', custom: DEFAULT_CUSTOM_COMPRESSION_POLICY } },
      revision: 1, writable: true, base: undefined, user: undefined, mode: 'host' as const,
    }
    const listeners: (() => void)[] = []
    const ctx = {
      locale: { register: vi.fn(() => () => {}), bind: () => (key: string) => key },
      configForms: { get: () => ({
        getSnapshot: () => source,
        subscribe: (listener: () => void) => { listeners.push(listener); return () => {} },
        set: async () => true,
      }) },
      slots: {
        inject: (_slot: string, factory: () => (() => void) | Generator<() => void>) => { void factory() },
        register: (record: Record<string, unknown>) => {
          registrations.push({ slot: String(record['name']), options: record, component: null })
          return () => {}
        },
      },
    }
    const registrations: CapturedRegistration[] = []
    apply(ctx as unknown as ClientContext)
    const face = (registrations[0]!.options['inject'] as () => { hooks: { compression: { getSnapshot(): unknown; subscribe(l: () => void): () => void } } })()
    const scope = face.hooks.compression

    const first = scope.getSnapshot()
    expect(scope.getSnapshot()).toBe(first)
    // value decodes through the whole strict validator
    expect(first && typeof first === 'object' && 'value' in first && (first as { value?: { profile?: string } }).value?.profile).toBe('balanced')

    // Host accepts a change → NEW form snapshot object → projection recomputes
    source = { ...source, revision: 2, value: { settings: { profile: 'off', custom: DEFAULT_CUSTOM_COMPRESSION_POLICY } } }
    for (const listener of listeners) listener()
    const second = scope.getSnapshot()
    expect(second).not.toBe(first)
    expect(second && typeof second === 'object' && 'value' in second && (second as { value?: { profile?: string } }).value?.profile).toBe('off')
  })

  it('survives an older host that does not declare the seat, warning instead of crashing', () => {
    // Cross-version tolerance: a host without this seat rejects the
    // registration at the slot boundary. apply() must swallow that and warn —
    // the historical failure mode was apply() bailing out, which silently took
    // EVERY settings entry down with it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { declared } = collectRegistrations({ registerThrows: true })
      // It tried the seat (so the degradation is "loud", not a silent no-op)…
      expect(declared).toEqual(['settings.section'])
      // …and the rejection never escaped apply().
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
