/**
 * CustomPolicyEditor: full custom compression policy editor with StageFields.
 *
 * Extracted from CompressionProfileSelector.tsx to reduce god-module size.
 *
 * @module dsh-context-compression-improved/client/CustomPolicyEditor
 */

import type { ContextCompressionLocaleKey } from './locales.ts'
import css from './CompressionProfileSelector.module.css'
import {
  isCustomCompressionPolicy,
  type CustomCompressionBudget,
  type CustomCompressionPolicy,
  type CustomCompressionPolicyV3,
  type CustomHistoryPolicy,
} from '../profiles.ts'

interface CustomPolicyEditorProps {
  value: CustomCompressionPolicyV3
  disabled: boolean
  setValue: (value: CustomCompressionPolicyV3) => void
  save: () => Promise<void>
  reset: () => Promise<void>
  settle: (operation: () => Promise<void>) => void
  t: (key: ContextCompressionLocaleKey) => string
}

export function CustomPolicyEditor({ value, disabled, setValue, save, reset, settle, t }: CustomPolicyEditorProps) {
  const valid = isCustomCompressionPolicy(value)
  const unitStep = value.unit === 'tokens' ? 1 : 0.01
  const unitMax = value.unit === 'tokens' ? undefined : 100
  const unitBounds = unitMax === undefined ? {} : { max: unitMax }
  const setBudget = (
    stage: 'fresh' | 'aggregate',
    patch: Partial<CustomCompressionBudget>,
  ): void => {
    setValue({ ...value, [stage]: { ...value[stage], ...patch } })
  }
  const setHistory = (patch: Partial<CustomHistoryPolicy>): void => {
    setValue({ ...value, history: { ...value.history, ...patch } })
  }
  return (
    <section className={css.custom} aria-labelledby="context-compression-custom-title">
      <h3 id="context-compression-custom-title" className={css.customTitle}>{t('custom.title')}</h3>
      <p className={css.customNote}>{t('custom.sessionScope')}</p>
      <p className={css.customNote}>{t('custom.measurement')}</p>
      <label className={css.field}>
        <span>{t('custom.unit')}</span>
        <select
          value={value.unit}
          disabled={disabled}
          onChange={(event) => {
            setValue({
              ...value,
              unit: event.currentTarget.value as CustomCompressionPolicy['unit'],
            })
          }}
        >
          <option value="tokens">{t('custom.unit.tokens')}</option>
          <option value="context-percent">{t('custom.unit.contextPercent')}</option>
        </select>
      </label>
      <StageFields
        t={t}
        title={t('custom.fresh.enabled')}
        enabled={value.fresh.enabled}
        disabled={disabled}
        onEnabled={(enabled) => { setBudget('fresh', { enabled }) }}
        fields={[
          { label: t('custom.fresh.trigger'), value: value.fresh.trigger, set: (trigger) => { setBudget('fresh', { trigger }) }, ...unitBounds },
          { label: t('custom.fresh.target'), value: value.fresh.target, set: (target) => { setBudget('fresh', { target }) }, ...unitBounds },
        ]}
        step={unitStep}
      />
      <StageFields
        t={t}
        title={t('custom.aggregate.enabled')}
        enabled={value.aggregate.enabled}
        disabled={disabled}
        onEnabled={(enabled) => { setBudget('aggregate', { enabled }) }}
        fields={[
          { label: t('custom.aggregate.trigger'), value: value.aggregate.trigger, set: (trigger) => { setBudget('aggregate', { trigger }) }, ...unitBounds },
          { label: t('custom.aggregate.target'), value: value.aggregate.target, set: (target) => { setBudget('aggregate', { target }) }, ...unitBounds },
        ]}
        step={unitStep}
      />
      <StageFields
        t={t}
        title={t('custom.history.enabled')}
        enabled={value.history.enabled}
        disabled={disabled}
        onEnabled={(enabled) => { setHistory({ enabled }) }}
        fields={[
          { label: t('custom.history.trigger'), value: value.history.trigger, set: (trigger) => { setHistory({ trigger }) }, ...unitBounds },
          { label: t('custom.history.keepRecentToolCalls'), value: value.history.keepRecentToolCalls, set: (keepRecentToolCalls) => { setHistory({ keepRecentToolCalls }) }, integer: true, allowZero: true },
          { label: t('custom.history.keepRecentTokens'), value: value.history.keepRecentTokens, set: (keepRecentTokens) => { setHistory({ keepRecentTokens }) }, allowZero: true, ...unitBounds },
          { label: t('custom.history.minReclaim'), value: value.history.minReclaim, set: (minReclaim) => { setHistory({ minReclaim }) }, ...unitBounds },
        ]}
        step={unitStep}
        fieldsEnabled={value.history.enabled || value.tailTrim.enabled}
      />
      <label className={css.field}>
        <span>{t('custom.prefixPolicy')}</span>
        <select
          value={value.prefixPolicy}
          disabled={disabled || !value.history.enabled}
          onChange={(event) => {
            setValue({
              ...value,
              prefixPolicy: event.currentTarget.value as CustomCompressionPolicy['prefixPolicy'],
            })
          }}
        >
          <option value="preserve">{t('custom.prefixPolicy.preserve')}</option>
          <option value="pressure-break">{t('custom.prefixPolicy.pressureBreak')}</option>
        </select>
      </label>
      <div className={css.customNote}>{t('custom.experimental')}</div>
      <StageFields
        t={t}
        title={t('custom.tailTrim.enabled')}
        enabled={value.tailTrim.enabled}
        disabled={disabled}
        onEnabled={(enabled) => {
          setValue({ ...value, tailTrim: { ...value.tailTrim, enabled } })
        }}
        fields={[{
          label: t('custom.tailTrim.trigger'),
          value: value.tailTrim.trigger,
          set: (trigger) => {
            setValue({ ...value, tailTrim: { ...value.tailTrim, trigger } })
          },
          ...unitBounds,
        }]}
        step={unitStep}
      />
      <p className={css.customNote}>{t('custom.tailTrim.warning')}</p>
      {valid ? null : <div className={css.error} role="alert">{t('custom.invalid')}</div>}
      <div className={css.actions}>
        <button type="button" disabled={disabled || !valid} onClick={() => { settle(save) }}>{t('custom.save')}</button>
        <button type="button" disabled={disabled} onClick={() => { settle(reset) }}>{t('custom.reset')}</button>
      </div>
    </section>
  )
}

interface StageNumberField {
  label: string
  value: number
  set: (value: number) => void
  integer?: boolean
  allowZero?: boolean
  max?: number
}

export function StageFields({ title, enabled, disabled, onEnabled, fields, step, fieldsEnabled = enabled, t }: {
  title: string
  enabled: boolean
  disabled: boolean
  onEnabled: (enabled: boolean) => void
  fields: readonly StageNumberField[]
  step: number
  fieldsEnabled?: boolean
  t: (key: ContextCompressionLocaleKey) => string
}) {
  return (
    <fieldset className={css.stage} disabled={disabled}>
      <legend>{title}</legend>
      <label className={css.field}>
        <span>{t('custom.enabled')}</span>
        <select aria-label={title} value={enabled ? 'on' : 'off'}
          onChange={(event) => { onEnabled(event.currentTarget.value === 'on') }}>
          <option value="on">{t('custom.enabled.on')}</option>
          <option value="off">{t('custom.enabled.off')}</option>
        </select>
      </label>
      <div className={css.fieldGrid}>
        {fields.map(field => (
          <label className={css.field} key={field.label}>
            <span>{field.label}</span>
            <input
              type="number"
              value={field.value}
              min={field.allowZero === true ? 0 : field.integer === true ? 1 : step}
              max={field.max}
              step={field.integer === true ? 1 : step}
              disabled={!fieldsEnabled || disabled}
              onChange={(event) => { field.set(Number(event.currentTarget.value)) }}
            />
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Convert a legacy custom policy to V3 format. */
export function editableCustom(value: CustomCompressionPolicy): CustomCompressionPolicyV3 {
  if (value.version === 3) return structuredClone(value)
  return {
    version: 3,
    unit: value.unit,
    fresh: structuredClone(value.fresh),
    aggregate: structuredClone(value.aggregate),
    history: {
      enabled: value.history.enabled,
      trigger: value.history.trigger,
      keepRecentToolCalls: 10,
      keepRecentTokens: value.history.keepRecent,
      minReclaim: value.history.minReclaim,
    },
    prefixPolicy: value.prefixPolicy,
    tailTrim: value.version === 1 ? { enabled: false, trigger: 700_000 } : structuredClone(value.tailTrim),
  }
}
