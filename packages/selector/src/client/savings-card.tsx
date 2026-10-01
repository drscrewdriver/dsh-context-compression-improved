/**
 * 节省统计卡片(设置分节内,只读):净/毛/抵消 + 分项条。
 * 数据源 = `/api/.../savings` 只读快照路由(忙 2s / 闲 5s 自调度轮询,
 * 失败静默——统计卡片永不打扰设置页主功能)。
 *
 * @module dsh-context-compression-improved/client/savings-card
 */
import { useEffect, useRef, useState } from 'react'
import css from './CompressionProfileSelector.module.css'
import type { CompressionProfileSelectorProps } from './CompressionProfileSelector.tsx'

const SAVINGS_ROUTE = '/api/dsh-context-compression-improved/savings'

interface SavingsSnapshot {
  ok?: boolean
  startedAt: string
  sessions: number
  gross: { exact: number; estimated: number }
  offsets: { exact: number; estimated: number }
  net: { exact: number; estimated: number }
  perComponent: Array<{ component: string; tokens: number; basis: string; kind: string }>
  recentOffsets: Array<{ component: string; tokens: number; basis: string; at: string; note?: string }>
  usage?: { requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheHitRate: number | null }
  perSession?: Array<{ sessionId: string; net: { exact: number; estimated: number }; requests: number; cacheHitRate: number | null }>
  pricing?: { currency: string; actualCost?: string; estimatedSavedCost?: string }
}

export interface SavingsCardProps {
  /** locale 文案函数(与设置分节同一 translator,键受字典类型约束)。 */
  t: CompressionProfileSelectorProps['t']
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

/** 节省统计卡片:口径分列(精确 tokenizer vs chars/4 估算),永不混算。 */
export function SavingsCard({ t }: SavingsCardProps) {
  const [snap, setSnap] = useState<SavingsSnapshot | null>(null)
  const stopped = useRef(false)
  useEffect(() => {
    stopped.current = false
    const tick = async (): Promise<void> => {
      try {
        const response = await fetch(SAVINGS_ROUTE, { headers: { 'cache-control': 'no-cache' } })
        if (response.ok) {
          const data = (await response.json()) as SavingsSnapshot
          if (data?.startedAt !== undefined && !stopped.current) setSnap(data)
        }
      } catch {
        /* 路由未注册/网络不可用:静默 */
      }
      if (!stopped.current) setTimeout(tick, 5000)
    }
    void tick()
    return () => {
      stopped.current = true
    }
  }, [])

  if (snap === null || (snap.gross.exact + snap.gross.estimated === 0)) {
    return <div className={css.pricing}>{t('savings.empty')}</div>
  }
  const hasExact = snap.gross.exact > 0 || snap.offsets.exact > 0
  const hasEstimated = snap.gross.estimated > 0 || snap.offsets.estimated > 0
  const netTone = (snap.net.exact + snap.net.estimated) >= 0 ? css.savingsNetPositive : css.savingsNetNegative
  return (
    <div className={`${css.savingsCard}`} data-testid="savings-card">
      <div className={css.savingsRow}>
        <span>{t('savings.title')}</span>
      </div>
      {hasExact ? (
        <div className={`${css.savingsRow} ${netTone}`}>
          <span>{t('savings.netExact')}</span>
          <strong>{fmt(snap.net.exact)}</strong>
        </div>
      ) : null}
      {hasEstimated ? (
        <div className={css.savingsRow}>
          <span>{t('savings.netEstimated')}</span>
          <strong>{fmt(snap.net.estimated)}</strong>
        </div>
      ) : null}
      <div className={css.savingsRow}>
        <span className={css.savingsMuted}>{t('savings.gross')}</span>
        <span className={css.savingsMuted}>
          {hasExact ? `✓ ${fmt(snap.gross.exact)}` : ''}{hasExact && hasEstimated ? ' · ' : ''}{hasEstimated ? `≈ ${fmt(snap.gross.estimated)}` : ''}
        </span>
      </div>
      <div className={css.savingsRow}>
        <span className={css.savingsMuted}>{t('savings.offsets')}</span>
        <span className={css.savingsMuted}>
          {hasExact ? `−${fmt(snap.offsets.exact)}` : ''}{hasExact && hasEstimated ? ' · ' : ''}{hasEstimated ? `−${fmt(snap.offsets.estimated)}` : ''}
        </span>
      </div>
      {snap.usage !== undefined && snap.usage.requests > 0 ? (
        <>
          <div className={css.savingsRow}>
            <span className={css.savingsMuted}>{t('savings.requests')}</span>
            <span className={css.savingsMuted}>{fmt(snap.usage.requests)}</span>
          </div>
          <div className={css.savingsRow}>
            <span className={css.savingsMuted}>{t('savings.cacheHit')}</span>
            <span className={css.savingsMuted}>
              {snap.usage.cacheHitRate === null ? '–' : `${Math.round(snap.usage.cacheHitRate * 100)}%`}
            </span>
          </div>
          {snap.pricing?.actualCost !== undefined ? (
            <div className={css.savingsRow}>
              <span className={css.savingsMuted}>{t('savings.actualCost')}</span>
              <span className={css.savingsMuted}>{snap.pricing.currency} {snap.pricing.actualCost}</span>
            </div>
          ) : null}
          {snap.pricing?.estimatedSavedCost !== undefined ? (
            <div className={css.savingsRow}>
              <span className={css.savingsMuted}>{t('savings.savedMoney')}</span>
              <span className={css.savingsMuted}>{snap.pricing.currency} {snap.pricing.estimatedSavedCost}</span>
            </div>
          ) : null}
        </>
      ) : null}
      {snap.perSession !== undefined && snap.perSession.length > 1 ? (
        <div className={css.savingsBreakdown}>
          {snap.perSession.slice(0, 5).map(row => (
            <div key={row.sessionId} className={css.savingsRow}>
              <span className={css.savingsMuted}>
                {t('savings.perSession')} · {row.sessionId.slice(0, 8)}…{row.requests > 0 ? ` · ${t('savings.cacheHit')} ${row.cacheHitRate === null ? '–' : `${Math.round(row.cacheHitRate * 100)}%`}` : ''}
              </span>
              <span className={css.savingsMuted}>{fmt(row.net.exact)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {snap.perComponent.length > 0 ? (
        <div className={css.savingsBreakdown}>
          {snap.perComponent.slice(0, 6).map((row) => (
            <div key={`${row.kind}:${row.component}:${row.basis}`} className={css.savingsRow}>
              <span className={css.savingsMuted}>
                {row.kind === 'offset' ? '−' : '+'} {row.component}
                <small> ({row.basis === 'exact-tokenizer' ? t('savings.basisExact') : t('savings.basisEstimated')})</small>
              </span>
              <span className={css.savingsMuted}>{fmt(row.tokens)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className={css.savingsNote}>{t('savings.basisNote')}</div>
    </div>
  )
}
