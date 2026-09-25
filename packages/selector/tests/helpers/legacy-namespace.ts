/**
 * Test-host helper: registers the legacy `context-compression` settings
 * namespace on a 0.1.5-shaped test settings service, so specs can drive the
 * plugin through `settings.update(...)` exactly as they did before the 0.1.7
 * declarative migration. Production code reads the volatile entry field first
 * and falls back to this namespace; on a real 0.1.7 host neither the
 * registration nor this helper exists.
 */
import {
  CONTEXT_COMPRESSION_SETTINGS_NAMESPACE,
  ContextCompressionSettingsSchema,
} from '../../src/runtime/config.ts'

export const LegacyNamespaceRegistrar = {
  name: 'context-compression:test/legacy-namespace-registrar',
  async apply(ctx: {
    inject(deps: readonly string[], fn: (s: { settings: { register(ns: never, schema: unknown): unknown } }) => void): void
  }): Promise<void> {
    await new Promise<void>((resolve) => {
      ctx.inject(['settings'], (s) => {
        try {
          s.settings.register(
            CONTEXT_COMPRESSION_SETTINGS_NAMESPACE as never,
            ContextCompressionSettingsSchema,
          )
        } catch { /* already registered by an earlier row */ }
        resolve()
      })
    })
  },
}
