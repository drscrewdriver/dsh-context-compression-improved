/**
 * Test-host helper: registers the legacy `context-compression` settings
 * namespace on a 0.1.5-shaped test settings service, so specs can drive the
 * plugin through `settings.update(...)` exactly as they did before the 0.1.7
 * declarative migration. Production code reads the volatile entry field first
 * and falls back to this namespace; on a real 0.1.7 host neither the
 * registration nor this helper exists.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  CONTEXT_COMPRESSION_SETTINGS_NAMESPACE,
  ContextCompressionSettingsSchema,
} from '../../src/runtime/config.ts'

export const LegacyNamespaceRegistrar = {
  name: 'context-compression:test/legacy-namespace-registrar',
  async apply(ctx: Context): Promise<void> {
    await new Promise<void>((resolve) => {
      ctx.inject(['settings'], (s) => {
        try {
          // The test host mounts a vendored 0.1.5-shaped provider whose
          // static type is the 0.1.7 Context augmentation (`SettingsForms`);
          // narrow to the legacy registry surface at the seam.
          ;(s.settings as unknown as {
            register(ns: never, schema: unknown): unknown
          }).register(
            CONTEXT_COMPRESSION_SETTINGS_NAMESPACE as never,
            ContextCompressionSettingsSchema,
          )
        } catch { /* already registered by an earlier row */ }
        resolve()
      })
    })
  },
}
