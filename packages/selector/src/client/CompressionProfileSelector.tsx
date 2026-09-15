/**
 * CompressionProfileSelector — thin re-export hub.
 *
 * Component implementations now live in dedicated modules to keep the
 * god-module under control. This file preserves the public API surface so
 * existing consumers see no change.
 *
 * @module dsh-context-compression-improved/client/CompressionProfileSelector
 */

import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  COMPRESSION_PROFILES,
  isCustomCompressionPolicy,
  type CompressionProfile,
  type CustomCompressionPolicy,
  type ContextCompressionSettings,
  type PresetOptionsSettings,
} from '../profiles.ts'

export { COMPRESSION_PROFILES, isCustomCompressionPolicy }
export type { CompressionProfile, CustomCompressionPolicy, ContextCompressionSettings, PresetOptionsSettings }

export interface CompressionSelectorInjected {
  hooks: { compression: SettingsScope<ContextCompressionSettings> }
  select: (profile: CompressionProfile) => Promise<void>
  saveCustom: (custom: CustomCompressionPolicy) => Promise<void>
  resetCustom: () => Promise<void>
  saveAutoCompact: (thresholdPercent: number) => Promise<void>
  saveCodeSkeleton: (enabled: boolean) => Promise<void>
  /** Patch of `presetOptions` members; an explicit `undefined` clears that field. */
  savePresetOptions: (options: import('./preset-options.ts').PresetOptionsPatch) => Promise<void>
}

/**
 * Owner-agnostic panel props: the same component registers under the 0.1.5
 * `settings.plugins.tab` card (no owner props) and the legacy
 * `settings.section` page (whose shell supplies `close`), so the section
 * owner share stays optional.
 */
export type CompressionProfileSelectorProps =
  { close?: () => void }
  & PropsLocale<'context-compression'>
  & InjectFace<CompressionSelectorInjected>

// Re-export sub-components from dedicated modules.
export {
  ContextCompressionSettingsSection,
  SettingsCompressionProfileControls,
} from './settings-section.tsx'

export {
  CompressionProfileControls,
  AutoCompactThresholdControls,
  CodeSkeletonControls,
} from './CompressionProfileControls.tsx'

export {
  EstimatorControls,
} from './EstimatorControls.tsx'

export {
  CustomPolicyEditor,
  StageFields,
  editableCustom,
} from './CustomPolicyEditor.tsx'

// Imported for the wrapper component below; re-exported above.
import { CompressionProfileControls } from './CompressionProfileControls.tsx'

/** Full-page Settings surface backed by the same durable selector state. */
export function CompressionProfileSelector({
  ...props
}: CompressionProfileSelectorProps) {
  return <CompressionProfileControls {...props} showCustomEditor={false} />
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'context-compression': import('./locales.ts').ContextCompressionLocaleKey
  }
}
