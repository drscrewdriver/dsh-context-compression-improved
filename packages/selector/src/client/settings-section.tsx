/**
 * Full-page Settings surface backed by the same durable selector state.
 *
 * Extracted from CompressionProfileSelector.tsx to reduce god-module size.
 *
 * @module dsh-context-compression-improved/client/settings-section
 */

import { useEffect, useState } from 'react'
import css from './CompressionProfileSelector.module.css'
import {
  AUTO_COMPACT_THRESHOLD_LIMITS,
  COMPRESSION_PROFILES,
  type CompressionProfile,
  type CustomCompressionPolicyV3,
} from '../profiles.ts'
import type { CompressionProfileSelectorProps } from './CompressionProfileSelector.tsx'
import { AutoCompactThresholdControls } from './CompressionProfileControls.tsx'
import { EstimatorControls, EstimatorInactiveNotice } from './EstimatorControls.tsx'
import { CustomPolicyEditor, editableCustom } from './CustomPolicyEditor.tsx'

/** Full-page Settings surface backed by the same durable selector state. */
export function ContextCompressionSettingsSection(props: CompressionProfileSelectorProps) {
  return <SettingsCompressionProfileControls {...props} />
}

export function SettingsCompressionProfileControls({
  useCompression, useSessions, select, saveCustom, resetCustom, saveAutoCompact, saveCodeSkeleton,
  savePresetOptions, t,
}: CompressionProfileSelectorProps) {
  const state = useCompression(snapshot => snapshot)
  const currentPreset = useSessions((sessions) => {
    const current = sessions.current
    return current === undefined ? undefined : sessions.byId[current]?.agentPreset
  })
  const selectorAvailable = currentPreset !== 'minimal'
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [draft, setDraft] = useState<CustomCompressionPolicyV3 | null>(null)
  const current = state.value?.profile ?? 'balanced'
  useEffect(() => {
    const custom = state.value?.custom
    setDraft(current === 'custom' && custom !== undefined ? editableCustom(custom) : null)
  }, [current, state.value?.custom])
  if (state.status === 'unavailable') return null

  const busy = state.status === 'loading' || saving
  const selectProfile = (profile: CompressionProfile): void => {
    if (!selectorAvailable || !state.writable || profile === current) return
    setSaveError(null)
    setSaving(true)
    void select(profile).then(
      () => { setSaving(false) },
      (error: unknown) => {
        setSaving(false)
        setSaveError(error instanceof Error && error.message !== '' ? error.message : t('status.saveFailed'))
      },
    )
  }
  const settle = (operation: () => Promise<void>): void => {
    setSaveError(null)
    setSaving(true)
    void operation().then(
      () => { setSaving(false) },
      (error: unknown) => {
        setSaving(false)
        setSaveError(error instanceof Error && error.message !== '' ? error.message : t('status.saveFailed'))
      },
    )
  }

  return (
    <section className={css.settingsSection}>
      <h2 className={css.settingsTitle}>{t('settings.title')}</h2>
      <p className={css.settingsDescription}>{t('settings.description')}</p>
      {selectorAvailable ? (
        <div className={css.profileGrid} aria-label={t('label')}>
          {COMPRESSION_PROFILES.map((profile) => {
            const selected = profile === current
            return (
              <button key={profile} type="button" className={css.profileCard} aria-pressed={selected}
                disabled={busy || !state.writable} onClick={() => { selectProfile(profile) }}>
                <span className={css.profileCardTop}>
                  <span className={css.profileCardTitle}>{t(`profile.${profile}`)}</span>
                  {selected ? <span className={css.profileCurrent}>{t('profile.current')}</span> : null}
                </span>
                <span className={css.profileCardDetail}>{t(`detail.${profile}`)}</span>
              </button>
            )
          })}
        </div>
      ) : <div className={css.unavailable} role="status">{t('status.minimalUnavailable')}</div>}
      <AutoCompactThresholdControls
        value={state.value?.autoCompact?.thresholdPercent ?? AUTO_COMPACT_THRESHOLD_LIMITS.default}
        disabled={busy || !state.writable || !selectorAvailable}
        save={saveAutoCompact}
        settle={settle}
        t={t}
      />
      {current !== 'tokenpilot-inspired' ? (
        <EstimatorInactiveNotice profile={t(`profile.${current}`)} t={t} />
      ) : (
        <EstimatorControls
          options={state.value?.presetOptions ?? {}}
          disabled={busy || !state.writable || !selectorAvailable}
          save={savePresetOptions}
          settle={settle}
          t={t}
        />
      )}
      <div className={css.pricing}>{t('pricing.disclosure')}</div>
      {current !== 'custom' || draft === null || !selectorAvailable ? null : (
        <CustomPolicyEditor value={draft} disabled={busy || !state.writable} setValue={setDraft}
          save={() => saveCustom(structuredClone(draft))} reset={resetCustom} settle={settle} t={t} />
      )}
      {saveError === null ? null : <div className={css.error} role="alert">{saveError}</div>}
    </section>
  )
}
