/**
 * Path-addressed writes for the `presetOptions` section of the
 * context-compression settings namespace.
 *
 * The settings Host applies a `set` op AT its path, so a field write must name
 * only the field it changes. Writing the whole section — `scope.set(
 * 'presetOptions', patch)` — replaces the section root with the patch, which
 * deleted every sibling field: choosing a provider after choosing a channel
 * erased `estimatorMode` and silently turned the estimator back off, and the
 * saved document kept exactly the last field the user touched.
 *
 * A patch member set to `undefined` means "clear this field" (the section then
 * re-inherits the preset default) rather than "leave it alone"; absent members
 * are untouched by construction.
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import type { PresetOptionsSettings } from '../profiles.ts'

/** The namespace key holding every tokenpilot-inspired sub-capability override. */
const PRESET_OPTIONS_KEY = 'presetOptions'

/** Every field a patch may address, in the schema's own order. The retired
 *  review-gate keys are deliberately absent: nothing writes them any more, and
 *  a stored document that still carries them is tolerated by the decoders. */
const PRESET_OPTION_KEYS = [
  'dedupeToolResults', 'summaryLocator', 'prefixStabilizer', 'readState', 'estimatorMode',
  'estimatorProvider', 'estimatorModel', 'estimatorBaseUrl', 'estimatorApiKey', 'estimatorTimeoutMs',
  'advisorMode', 'advisorTimeoutMs', 'advisorRefreshTurns', 'advisorScoreThreshold', 'advisorSampleLimit',
  'advisorMinTokens',
] as const

/** One partial edit of `presetOptions`; `undefined` clears the named field. */
export type PresetOptionsPatch = {
  readonly [K in keyof PresetOptionsSettings]?: PresetOptionsSettings[K] | undefined
}

/**
 * Plan the path ops one patch needs against the section currently stored.
 *
 * Fields already at their requested value produce no op, so a re-selected
 * value neither rewrites the document nor reports a save the Host never
 * committed.
 *
 * @param current - the decoded `presetOptions` section, when one is stored.
 * @param patch - the fields to write or clear.
 * @returns the ordered ops, empty when the patch changes nothing.
 */
export function planPresetOptionsOps(
  current: PresetOptionsSettings | undefined,
  patch: PresetOptionsPatch,
): SettingsPathOpView[] {
  const stored = current as Record<string, unknown> | undefined
  const ops: SettingsPathOpView[] = []
  for (const key of PRESET_OPTION_KEYS) {
    if (!Object.hasOwn(patch, key)) continue
    const value = patch[key]
    const path = [PRESET_OPTIONS_KEY, key]
    if (value === undefined) {
      if (stored?.[key] !== undefined) ops.push({ op: 'unset', path })
      continue
    }
    if (stored?.[key] === value) continue
    ops.push({ op: 'set', path, value })
  }
  return ops
}

/**
 * Test whether one resolved settings document already carries every planned op.
 *
 * @param settings - the resolved namespace section after a write.
 * @param ops - the ops that write submitted.
 * @returns whether every named field holds its requested state.
 */
export function presetOptionsOpsAccepted(
  presetOptions: PresetOptionsSettings | undefined,
  ops: readonly SettingsPathOpView[],
): boolean {
  if (ops.length === 0) return true
  if (presetOptions === undefined) return false
  const stored = presetOptions as Record<string, unknown>
  return ops.every((op) => {
    const key = op.path[op.path.length - 1]
    if (key === undefined) return false
    return op.op === 'set' ? stored[key] === op.value : stored[key] === undefined
  })
}
