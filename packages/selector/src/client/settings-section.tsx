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
import { AutoCompactThresholdControls, CodeSkeletonControls, SedimentControls, IntentSummaryControls, MonitorPanelControls } from './CompressionProfileControls.tsx'
import { EstimatorControls, EstimatorInactiveNotice } from './EstimatorControls.tsx'
import { CustomPolicyEditor, editableCustom } from './CustomPolicyEditor.tsx'
import { SavingsCard } from './savings-card'
import { GuidePanel, GuideRestartButton, guideSteps, isGuideSkipped } from './guide.tsx'
import { CCI_GUIDE_STEPS } from './guide-steps.ts'

/** Full-page Settings surface backed by the same durable selector state. */
export function ContextCompressionSettingsSection(props: CompressionProfileSelectorProps) {
  return <SettingsCompressionProfileControls {...props} />
}

export function SettingsCompressionProfileControls({
  useCompression, select, saveCustom, resetCustom, savePtcCustom, resetPtcCustom, saveAutoCompact, saveCodeSkeleton, saveSediment, saveIntentSummary, saveMonitorPanel,
  savePresetOptions, t,
}: CompressionProfileSelectorProps) {
  const state = useCompression(snapshot => snapshot)
  // Harness 0.1.5 dropped browser-side agentPreset from session summaries, so
  // the old Minimal-preset gate has no data source; the selector stays enabled.
  const selectorAvailable = true
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [draft, setDraft] = useState<CustomCompressionPolicyV3 | null>(null)
  const [ptcDraft, setPtcDraft] = useState<CustomCompressionPolicyV3 | null>(null)
  // 引导开合状态必须在最早的 `return null` 之前声明：hook 顺序对每次渲染恒定。
  const [guideOpen, setGuideOpen] = useState(() => !isGuideSkipped('context-compression'))
  const current = state.value?.profile ?? 'balanced'
  useEffect(() => {
    const custom = state.value?.custom
    setDraft((current === 'custom' || current === 'tokenpilot-inspired') && custom !== undefined ? editableCustom(custom) : null)
  }, [current, state.value?.custom])
  useEffect(() => {
    const ptcCustom = state.value?.ptcCustom
    setPtcDraft(current === 'ptc' && ptcCustom !== undefined ? editableCustom(ptcCustom) : null)
  }, [current, state.value?.ptcCustom])
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
      {/* 引导重启入口放在设置面上方：贴士也渲染在同一位置，跳过之后一眼就能重开。 */}
      <p style={{ margin: '0 0 10px' }}>
        <GuideRestartButton ns="context-compression" onOpen={() => { setGuideOpen(true) }} />
      </p>
      {guideOpen && (
        <GuidePanel
          ns="context-compression"
          steps={guideSteps(CCI_GUIDE_STEPS)}
          onClose={() => { setGuideOpen(false) }}
        />
      )}
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
      <CodeSkeletonControls
        value={state.value?.codeSkeleton?.enabled ?? false}
        disabled={busy || !state.writable || !selectorAvailable}
        save={saveCodeSkeleton}
        settle={settle}
        t={t}
      />
      <SedimentControls
        value={state.value?.sediment?.enabled ?? false}
        disabled={busy || !state.writable || !selectorAvailable}
        save={saveSediment}
        settle={settle}
        t={t}
      />
      <IntentSummaryControls
        value={state.value?.intentSummary?.enabled ?? false}
        disabled={busy || !state.writable || !selectorAvailable}
        save={saveIntentSummary}
        settle={settle}
        t={t}
      />
      <MonitorPanelControls
        value={state.value?.monitorPanel?.enabled ?? false}
        disabled={busy || !state.writable || !selectorAvailable}
        save={saveMonitorPanel}
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
      <SavingsCard t={t} />
      <div className={css.pricing}>{t('pricing.disclosure')}</div>
      {current !== 'custom' && current !== 'tokenpilot-inspired' || draft === null || !selectorAvailable ? null : (
        <CustomPolicyEditor value={draft} disabled={busy || !state.writable} setValue={setDraft}
          save={() => saveCustom(structuredClone(draft))} reset={resetCustom} settle={settle} t={t} />
      )}
      {current !== 'ptc' || ptcDraft === null || !selectorAvailable ? null : (
        <CustomPolicyEditor value={ptcDraft} disabled={busy || !state.writable} setValue={setPtcDraft}
          save={() => savePtcCustom(structuredClone(ptcDraft))} reset={resetPtcCustom} settle={settle} t={t} />
      )}
      {saveError === null ? null : <div className={css.error} role="alert">{saveError}</div>}
    </section>
  )
}
