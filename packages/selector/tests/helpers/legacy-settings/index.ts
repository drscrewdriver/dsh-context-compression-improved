/**
 * Legacy test-host settings seam.
 *
 * Vendored verbatim from `@deepseek-ai/dsh-settings@0.1.5-rc.2`
 * (`lib/types/index.js` + `lib/types/redact.js`, with the
 * `@deepseek-ai/dsh-util-values@0.1.5-rc.2` helpers inlined as
 * `./legacy/util-values.js`): the 0.1.7 host replaced the
 * namespace-registry provider with declarative `SettingsForms`, while the
 * plugin keeps the legacy `ctx.settings.get(ns)` read as a host-shape
 * fallback (see src/index.ts). The host specs mount a provider subclassing
 * this base to exercise exactly that fallback against the real 0.1.7
 * baseline. Type declarations: `./legacy/provider.d.ts`.
 */
export { SettingsProvider as LegacySettingsProvider } from './legacy/provider.js'

