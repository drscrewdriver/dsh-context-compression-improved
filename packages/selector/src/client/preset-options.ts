/**
 * Field-wise writes for the `presetOptions` section of the
 * context-compression settings namespace.
 *
 * `settingsScope.set(field, value)` replaces the value AT that field, so
 * writing the section root with a patch deleted every sibling: choosing a
 * provider after choosing a channel erased `estimatorMode` and silently turned
 * the estimator back off, and the stored document kept exactly the last field
 * the user touched. The client reads the complete section (this namespace
 * declares no secret fields), so a patch is applied over the current document
 * and the merged result is what gets written.
 *
 * A patch member set to `undefined` means "clear this field" (it then
 * re-inherits the preset default); absent members stay untouched.
 */

import type { PresetOptionsSettings } from '../profiles.ts'

/** Every field a patch may address, in the schema's own order. */
const PRESET_OPTION_KEYS = [
  'dedupeToolResults', 'summaryLocator', 'prefixStabilizer', 'readState', 'estimatorMode',
  'estimatorProvider', 'estimatorModel', 'estimatorBaseUrl', 'estimatorApiKey', 'estimatorTimeoutMs',
  'reviewMode', 'reviewTimeoutTurns', 'cacheHitDiscountAlpha', 'reviewHighImpactTokens',
] as const

/** One partial edit of `presetOptions`; `undefined` clears the named field. */
export type PresetOptionsPatch = {
  readonly [K in keyof PresetOptionsSettings]?: PresetOptionsSettings[K] | undefined
}

/**
 * Apply one patch over the stored section.
 *
 * @param current - the decoded `presetOptions` section, when one is stored.
 * @param patch - the fields to write or clear.
 * @returns the complete section to store.
 */
export function mergePresetOptionsPatch(
  current: PresetOptionsSettings | undefined,
  patch: PresetOptionsPatch,
): PresetOptionsSettings {
  const source = current as Record<string, unknown> | undefined
  const merged: Record<string, unknown> = {}
  for (const key of PRESET_OPTION_KEYS) {
    const stored = source?.[key]
    if (stored !== undefined) merged[key] = stored
  }
  for (const key of Object.keys(patch)) {
    const value = (patch as Record<string, unknown>)[key]
    if (value === undefined) delete merged[key]
    else merged[key] = value
  }
  return merged as PresetOptionsSettings
}

/**
 * Compare two sections field by field, so an unchanged patch neither rewrites
 * the document nor reports a save the Host never committed.
 *
 * @param left - one section (or none).
 * @param right - the other section.
 * @returns whether every known field holds the same value.
 */
export function presetOptionsEqual(
  left: PresetOptionsSettings | undefined,
  right: PresetOptionsSettings | undefined,
): boolean {
  const a = left as Record<string, unknown> | undefined
  const b = right as Record<string, unknown> | undefined
  return PRESET_OPTION_KEYS.every(key => a?.[key] === b?.[key])
}
