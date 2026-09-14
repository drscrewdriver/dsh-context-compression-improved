/**
 * CompressionProfileControls: dropdown selector for compression profiles,
 * plus AutoCompactThresholdControls and CodeSkeletonControls sub-components.
 *
 * Extracted from CompressionProfileSelector.tsx to reduce god-module size.
 *
 * @module dsh-context-compression-improved/client/CompressionProfileControls
 */

import { useEffect, useId, useState } from 'react'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextCompressionLocaleKey } from './locales.ts'
import css from './CompressionProfileSelector.module.css'
import {
  AUTO_COMPACT_THRESHOLD_LIMITS,
  COMPRESSION_PROFILES,
  isValidAutoCompactThresholdPercent,
  type CompressionProfile,
  type CustomCompressionPolicyV3,
} from '../profiles.ts'
import type { CompressionProfileSelectorProps } from './CompressionProfileSelector.tsx'
import { CustomPolicyEditor, editableCustom } from './CustomPolicyEditor.tsx'

export function CompressionProfileControls({
  useCompression, useSessions, select, saveCustom, resetCustom, t, showCustomEditor,
}: CompressionProfileSelectorProps & { showCustomEditor: boolean }) {
  const state = useCompression(snapshot => snapshot)
  const currentPreset = useSessions((sessions) => {
    const current = sessions.current
    return current === undefined ? undefined : sessions.byId[current]?.agentPreset
  })
  // A profile is Host-global. A cold Session may not have reported a live
  // capability yet, so only Minimal blocks initial configuration.
  const contextCompressionAvailable = currentPreset !== 'minimal'
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [draft, setDraft] = useState<CustomCompressionPolicyV3 | null>(null)
  const unavailableId = useId()
  const current = state.value?.profile ?? 'balanced'
  useEffect(() => {
    if (state.status === 'ready' && state.writable && contextCompressionAvailable) return
    setOpen(false)
  }, [contextCompressionAvailable, state.status, state.writable])
  useEffect(() => {
    const custom = state.value?.custom
    setDraft(current === 'custom' && custom !== undefined ? editableCustom(custom) : null)
  }, [current, state.value?.custom])
  if (state.status === 'unavailable') return null
  const busy = state.status === 'loading' || saving
  const label = busy ? t('status.loading') : t(`profile.${current}`)
  return (
    <div className={css.root}>
      <Menu
        open={open && contextCompressionAvailable}
        onClose={() => { setOpen(false) }}
        selectedId={current}
        items={COMPRESSION_PROFILES.map(profile => ({
          id: profile,
          label: (
            <span className={css.menuCopy}>
              <span className={css.menuTitle}>{t(`profile.${profile}`)}</span>
              <span className={css.menuDetail}>{t(`detail.${profile}`)}</span>
            </span>
          ),
        }))}
        onSelect={(id) => {
          setOpen(false)
          if (id === current || !COMPRESSION_PROFILES.includes(id as CompressionProfile)) return
          setSaveError(null)
          setSaving(true)
          void select(id as CompressionProfile).then(
            () => { setSaving(false) },
            (error: unknown) => {
              setSaving(false)
              setSaveError(error instanceof Error && error.message !== '' ? error.message : t('status.saveFailed'))
            },
          )
        }}
        align="start"
        portal
        anchor={(
          <button
            type="button"
            className={css.button}
            aria-haspopup="menu"
            aria-expanded={open && contextCompressionAvailable}
            aria-describedby={contextCompressionAvailable ? undefined : unavailableId}
            disabled={busy || !state.writable || !contextCompressionAvailable}
            onClick={() => { setOpen(value => !value) }}
          >
            <span className={css.copy}>
              <span className={css.label}>{t('label')}</span>
              <span className={css.value}>{label}</span>
            </span>
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
      {contextCompressionAvailable ? null : (
        <div id={unavailableId} className={css.unavailable} role="status">
          {t('status.minimalUnavailable')}
        </div>
      )}
      <div className={css.pricing}>{t('pricing.disclosure')}</div>
      <div className={css.settingsHint}>
        {t('autoCompact.summaryHint').replace('{percent}', String(state.value?.autoCompact?.thresholdPercent ?? AUTO_COMPACT_THRESHOLD_LIMITS.default))}
      </div>
      {current !== 'custom' || showCustomEditor ? null : (
        <div className={css.settingsHint}>{t('custom.settingsHint')}</div>
      )}
      {current !== 'custom' || draft === null || !showCustomEditor ? null : (
        <CustomPolicyEditor
          value={draft}
          disabled={busy || !state.writable || !contextCompressionAvailable}
          setValue={setDraft}
          save={() => saveCustom(structuredClone(draft))}
          reset={resetCustom}
          settle={(operation) => {
            setSaveError(null)
            setSaving(true)
            void operation().then(
              () => { setSaving(false) },
              (error: unknown) => {
                setSaving(false)
                setSaveError(error instanceof Error && error.message !== '' ? error.message : t('status.saveFailed'))
              },
            )
          }}
          t={t}
        />
      )}
      {saveError === null ? null : <div className={css.error} role="alert">{saveError}</div>}
    </div>
  )
}

interface AutoCompactThresholdControlsProps {
  value: number
  disabled: boolean
  save: (thresholdPercent: number) => Promise<void>
  settle: (operation: () => Promise<void>) => void
  t: (key: ContextCompressionLocaleKey) => string
}

/**
 * The authoritative Auto Compact threshold editor for the context-compression
 * section. A typed number input and its save path are kept deliberately simple;
 * values outside the recommended 70–85 band warn without blocking.
 */
export function AutoCompactThresholdControls({ value, disabled, save, settle, t }: AutoCompactThresholdControlsProps) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  const parsed = Number(draft)
  // Number inputs legally produce value-equivalent drafts such as '8e1';
  // only the parsed value needs to be a valid threshold.
  const valid = isValidAutoCompactThresholdPercent(parsed)
  const risk = !valid
    ? 'autoCompact.invalid'
    : parsed < 70 ? 'autoCompact.riskLow'
      : parsed > 85 ? 'autoCompact.riskHigh'
        : undefined
  return (
    <section className={css.autoCompact} aria-labelledby="context-compression-autocompact-title">
      <h3 id="context-compression-autocompact-title" className={css.autoCompactTitle}>{t('autoCompact.title')}</h3>
      <p className={css.customNote}>{t('autoCompact.description')}</p>
      <label className={css.field}>
        <span>{t('autoCompact.inputLabel')}</span>
        <input
          type="number"
          value={draft}
          min={AUTO_COMPACT_THRESHOLD_LIMITS.min}
          max={AUTO_COMPACT_THRESHOLD_LIMITS.max}
          step={AUTO_COMPACT_THRESHOLD_LIMITS.step}
          disabled={disabled}
          aria-invalid={!valid}
          onChange={(event) => { setDraft(event.currentTarget.value) }}
        />
      </label>
      {risk === undefined ? null : (
        <div className={risk === 'autoCompact.invalid' ? css.error : css.autoCompactRisk} role={risk === 'autoCompact.invalid' ? 'alert' : 'note'}>
          {t(risk)}
        </div>
      )}
      <div className={css.actions}>
        <button
          type="button"
          disabled={disabled || !valid || parsed === value}
          onClick={() => { settle(() => save(parsed)) }}
        >
          {t('autoCompact.save')}
        </button>
      </div>
    </section>
  )
}

interface CodeSkeletonControlsProps {
  value: boolean
  disabled: boolean
  save: (enabled: boolean) => Promise<void>
  settle: (operation: () => Promise<void>) => void
  t: (key: ContextCompressionLocaleKey) => string
}

/**
 * The authoritative code-skeleton reducer gate for the context-compression
 * section. Deliberately minimal — an on/off select plus its own save path —
 * because the gate is orthogonal to every profile and carries no parameters.
 */
export function CodeSkeletonControls({ value, disabled, save, settle, t }: CodeSkeletonControlsProps) {
  return (
    <section className={css.autoCompact} aria-labelledby="context-compression-codeskeleton-title">
      <h3 id="context-compression-codeskeleton-title" className={css.autoCompactTitle}>{t('codeSkeleton.title')}</h3>
      <p className={css.customNote}>{t('codeSkeleton.description')}</p>
      <label className={css.field}>
        <span>{t('codeSkeleton.enabled')}</span>
        <select
          value={value ? 'on' : 'off'}
          disabled={disabled}
          onChange={(event) => { settle(() => save(event.currentTarget.value === 'on')) }}
        >
          <option value="on">{t('codeSkeleton.enabled.on')}</option>
          <option value="off">{t('codeSkeleton.enabled.off')}</option>
        </select>
      </label>
    </section>
  )
}
