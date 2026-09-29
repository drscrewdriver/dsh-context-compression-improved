/**
 * Narrow type surface for the vendored 0.1.5 `SettingsProvider` (legacy test-host seam).
 *
 * The 0.1.7 `@deepseek-ai/dsh-settings` host replaced the namespace-registry
 * provider with the declarative `SettingsForms` projector, but the plugin
 * deliberately keeps the legacy `ctx.settings.get(ns)` read as a fallback
 * "so a host that still serves the old service shape keeps working (test
 * hosts do exactly that)" (src/index.ts). The host specs drive that fallback
 * through this vendored base class — the verbatim 0.1.5-rc.2 implementation,
 * not a behavioral re-implementation.
 *
 * Only the members the specs and the production fallback actually touch are
 * declared; the full 0.1.5 surface exists at runtime in provider.js.
 */
import { Service } from '@deepseek-ai/cordis'

export declare abstract class SettingsProvider extends Service {
  /** Register as the `settings` service of `ctx` (implementation: `super(ctx, 'settings')`). */
  constructor(ctx: Context)
  /** Whether {@linkcode LegacySettingsProvider.update} may persist through this provider. */
  abstract readonly writable: boolean
  /** Load the provider's raw document (namespace → raw section) once at init. */
  protected abstract load(): Promise<Record<string, unknown>>
  /** Durably store one namespace's merged user section. */
  protected abstract persist(ns: string, section: Record<string, unknown>): Promise<void>
  /** Register a namespace schema; duplicate registration fails loud. */
  register(ns: string, schema: unknown, options?: unknown): unknown
  /** Read one registered namespace's resolved value (undefined while unregistered). */
  get(ns: string): unknown
  /** Merge a patch into one registered namespace's user layer, validate, persist. */
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
  /** Replace one registered namespace's user section wholesale, validate, persist. */
  replace(ns: string, section: object, expectedRevision?: number): Promise<void>
  /** Apply path-addressed edits to one registered namespace's user section. */
  mutate(ns: string, ops: readonly unknown[], expectedRevision?: number): Promise<void>
  /** Describe every registered namespace for configuration surfaces. */
  describe(options?: { redactSecrets?: boolean }): unknown[]
  /** Non-file providers expose no open-document affordance. */
  get documentPath(): string | undefined
  prepareDocument(): Promise<string | undefined>
}
