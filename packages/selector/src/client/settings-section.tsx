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
  type PresetOptionsSettings,
  type SedimentSettings,
} from '../profiles.ts'
import type { CompressionProfileSelectorProps } from './CompressionProfileSelector.tsx'
import type { ContextCompressionLocaleKey } from './locales.ts'
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

/** Estimate the estimator channel route for display ('' when unconfigured). */
function estimatorRouteLabel(options: PresetOptionsSettings | undefined, t: (key: ContextCompressionLocaleKey) => string): { label: string, host: boolean } {
  const mode = options?.estimatorMode ?? ''
  if (mode === '') return { label: t('llm.route.off'), host: false }
  const provider = options?.estimatorProvider?.trim() ?? ''
  const model = options?.estimatorModel?.trim() ?? ''
  if (mode === 'direct') {
    const base = options?.estimatorBaseUrl?.trim() ?? ''
    const route = [base, model].filter(part => part !== '').join(' · ') || '—'
    return { label: t('llm.route.direct').replace('{route}', route), host: false }
  }
  const route = [provider, model].filter(part => part !== '').join(' / ') || '—'
  return { label: t('llm.route.host').replace('{route}', route), host: true }
}

/** Resolve the turn-tail fold route for display ('' when foldMode is unset). */
function foldRouteLabel(sediment: SedimentSettings | undefined, t: (key: ContextCompressionLocaleKey) => string): { label: string, host: boolean } {
  const mode = sediment?.foldMode ?? ''
  if (mode === '') return { label: t('llm.route.off'), host: false }
  const strata = sediment?.foldStrataModel?.trim() ?? ''
  const local35 = sediment?.foldLocal35Model?.trim() ?? ''
  if (mode === 'direct') {
    const base = sediment?.foldBaseUrl?.trim() ?? ''
    const route = [base, strata === '' ? '' : `≤2K: ${strata}`, local35 === '' ? '' : `2–8K: ${local35}`].filter(part => part !== '').join(' · ') || '—'
    return { label: t('llm.route.direct').replace('{route}', route), host: false }
  }
  const provider = sediment?.foldStrataProvider?.trim() ?? ''
  const route = [provider, strata].filter(part => part !== '').join(' / ') || '—'
  return { label: t('llm.route.host').replace('{route}', route), host: true }
}

/**
 * 压缩使用 LLM 能力（费用提示 + 本地端点建议）——设置面**第一区块**。
 *
 * 原则：凡用到 LLM 的处理（压缩/轮尾折叠/估计器），费用提示与本地端点建议永远
 * 排在第一位；样式美化排在其次。停在「宿主模型」时压缩与对话共用 provider/model，
 * 每轮裁剪都会消耗对话 token 与费用——这一行必须在用户打开面板的第一屏可见。
 */
export function LlmCapabilityNotice({ presetOptions, sediment, t }: {
  presetOptions: PresetOptionsSettings | undefined
  sediment: SedimentSettings | undefined
  t: (key: ContextCompressionLocaleKey) => string
}) {
  const estimator = estimatorRouteLabel(presetOptions, t)
  const fold = foldRouteLabel(sediment, t)
  // 两步关闭：我已知晓 → 弹窗确认 → 写专门 flag（与引导跳过标记分开）
  const HIDDEN_FLAG = 'dsh.llm-notice.cci.hidden.v1'
  const isEn = typeof document !== 'undefined' && (document.documentElement.lang || '').toLowerCase().startsWith('en')
  const readHidden = (): boolean => { try { return typeof localStorage !== 'undefined' && localStorage.getItem(HIDDEN_FLAG) === '1' } catch { return false } }
  const [hidden, setHidden] = useState(() => readHidden())
  if (hidden) return null
  return (
    <section className={css.llmNotice} aria-labelledby="context-compression-llm-title">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h3 id="context-compression-llm-title" className={css.autoCompactTitle} style={{ margin: 0 }}>{t('llm.title')}</h3>
        <span style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            className={css.btnChip}
            onClick={() => {
              let ok = false
              try {
                ok = typeof window !== 'undefined' && window.confirm(isEn
                  ? 'Hide the “LLM usage notice”? Clear the localStorage key dsh.llm-notice.cci.hidden.v1 to restore.'
                  : '确定隐藏「LLM 使用提示」？确认后设置页不再展示；清空 localStorage 键 dsh.llm-notice.cci.hidden.v1 可恢复。')
              } catch { ok = false }
              if (!ok) return
              try { localStorage.setItem(HIDDEN_FLAG, '1') } catch {}
              setHidden(true)
            }}
          >
            {isEn ? 'Got it' : '我已知晓'}
          </button>
        </span>
      </div>
      <p className={css.customNote}>{t('llm.recommend')}</p>
      <p className={css.customNote}>{t('llm.status').replace('{estimator}', estimator.label).replace('{fold}', fold.label)}</p>
      {estimator.host || fold.host ? (
        <p className={css.autoCompactRisk} role="note">⚠ {t('llm.hostWarning')}</p>
      ) : null}
      <p className={css.customNote}>{t('llm.foldHint')}</p>
    </section>
  )
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
      {/* 费用提示与本地端点建议永远是第一区块；引导（美化）排在其后。 */}
      <LlmCapabilityNotice presetOptions={state.value?.presetOptions} sediment={state.value?.sediment} t={t} />
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
        fold={state.value?.sediment}
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
