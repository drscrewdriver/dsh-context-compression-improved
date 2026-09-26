/**
 * Test-host shim for the removed 0.1.5-era `@deepseek-ai/dsh-settings`
 * `SettingsProvider` (the 0.1.7 host replaced it with the declarative
 * `SettingsForms`, which has neither `register` nor per-namespace `get`).
 *
 * The legacy testhost fixtures (host-preset-overlay, standing-generation,
 * preset-overlay-loader e2e, public-runtime, advice-never-withholds) extend
 * this class exactly as they extended the host one: they override `load` /
 * `persist` and drive the plugin through `settings.update(...)`. Production
 * code consumes only `describe()` (the 0.1.7 volatile mirror) and `get(ns)`
 * (the legacy fallback), both served from the seeded schema defaults.
 */
import { Service } from '@deepseek-ai/cordis'
import { DEFAULT_CONTEXT_COMPRESSION_SETTINGS } from '../../src/runtime/config.ts'

export type SettingsNamespace = string

export class SettingsProvider extends Service {
  /** Subclasses opt into mutation by overriding to `true`. */
  readonly writable = false

  private readonly sections = new Map<string, Record<string, unknown>>()

  constructor(ctx: ConstructorParameters<typeof Service>[0], name = 'settings') {
    super(ctx, name)
  }

  /** Hook for subclasses; the base starts from an empty persisted store. */
  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve({})
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }

  /** Legacy 0.1.5 seam: seed a namespace with its schema defaults. */
  register(ns: string, _schema?: unknown): void {
    const key = String(ns)
    if (!this.sections.has(key)) {
      this.sections.set(key, structuredClone(DEFAULT_CONTEXT_COMPRESSION_SETTINGS))
    }
  }

  /** 0.1.7 volatile mirror consumed by the runtime (`{ ns, value }[]`). */
  describe(): Array<{ ns: string, value: Record<string, unknown> }> {
    return [...this.sections.entries()].map(([ns, value]) => ({ ns, value: structuredClone(value) }))
  }

  /** Legacy 0.1.5 fallback read. */
  get(ns: SettingsNamespace): Record<string, unknown> | undefined {
    const value = this.sections.get(String(ns))
    return value === undefined ? undefined : structuredClone(value)
  }

  /** Legacy shallow merge write; persists the complete merged section. */
  async update(ns: SettingsNamespace, patch: Record<string, unknown>): Promise<void> {
    if (!this.writable) {
      throw new TypeError(`settings namespace "${String(ns)}" is read-only`)
    }
    const key = String(ns)
    const merged = { ...(this.sections.get(key) ?? structuredClone(DEFAULT_CONTEXT_COMPRESSION_SETTINGS)), ...patch }
    this.sections.set(key, merged)
    await this.persist(ns, structuredClone(merged))
  }

  /** Cordis service lifecycle: hydrate from the subclass's persisted store. */
  async start(): Promise<void> {
    const loaded = await this.load()
    for (const [ns, value] of Object.entries(loaded ?? {})) {
      if (value !== null && typeof value === 'object' && !this.sections.has(ns)) {
        this.sections.set(ns, value as Record<string, unknown>)
      }
    }
  }
}
