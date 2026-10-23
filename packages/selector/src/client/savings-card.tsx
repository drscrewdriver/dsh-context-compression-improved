/**
 * 节省统计卡片(设置分节内,只读):存量(本进程口径) + 累计(按 N 次 call) +
 * 省钱估计三行并存(T26),会话账本服务端分页(T24 数据面),持久化徽标与降级
 * 标注,显示偏好经载荷 displayPrefs 实时拾取(T32,/ccip 的落点)。
 * 数据源 = `/api/.../savings`(存量)与 `/api/.../savings/sessions`(分页面板),
 * 5s 自调度轮询,失败静默——统计卡片永不打扰设置页主功能。
 *
 * @module dsh-context-compression-improved/client/savings-card
 */
import { useEffect, useRef, useState } from 'react'
import css from './CompressionProfileSelector.module.css'
import type { CompressionProfileSelectorProps } from './CompressionProfileSelector.tsx'

const SAVINGS_ROUTE = '/api/dsh-context-compression-improved/savings'
const SESSIONS_ROUTE = '/api/dsh-context-compression-improved/savings/sessions'
const PAGE_SIZE = 20

interface BasisPair { exact: number; estimated: number }
interface IntegralTotals { netExact: number; netEstimated: number; cachedInput: number; uncachedInput: number; calls: number }
interface DisplayPrefs {
  rows: { stock: boolean; total: boolean; money: boolean }
  mode: 'full' | 'compact'
  focusSessionId: string | null
}

interface SavingsSnapshot {
  ok?: boolean
  startedAt: string
  sessions: number
  gross: BasisPair
  offsets: BasisPair
  net: BasisPair
  perComponent: Array<{ component: string; tokens: number; basis: string; kind: string }>
  recentOffsets: Array<{ component: string; tokens: number; basis: string; at: string; note?: string }>
  usage?: { requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheHitRate: number | null }
  perSession?: Array<{ sessionId: string; net: BasisPair; requests: number; cacheHitRate: number | null }>
  pricing?: { currency: string; actualCost?: string; estimatedSavedCost?: string }
}

interface SessionsPayload {
  ok?: boolean
  persisted: { persisted: true; driver: string } | { persisted: false; reason: string }
  displayPrefs: DisplayPrefs
  total: number
  offset: number
  limit: number
  integralTotal: IntegralTotals
  integralMoney?: { decimal: string; currency: string }
  sessions: Array<{
    sessionId: string
    net: BasisPair
    integral: IntegralTotals
    money?: { decimal: string; currency: string }
    source: string
    liveStock?: BasisPair
  }>
  liveOnly: Array<{ sessionId: string; net: BasisPair; requests: number; cacheHitRate: number | null }>
}

export interface SavingsCardProps {
  /** locale 文案函数(与设置分节同一 translator,键受字典类型约束)。 */
  t: CompressionProfileSelectorProps['t']
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

/** 节省统计卡片:存量/累计双口径 + 会话账本分页;口径分列永不混算。 */
export function SavingsCard({ t }: SavingsCardProps) {
  const [snap, setSnap] = useState<SavingsSnapshot | null>(null)
  const [panel, setPanel] = useState<SessionsPayload | null>(null)
  const [offset, setOffset] = useState(0)
  const offsetRef = useRef(0)
  offsetRef.current = offset
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
      try {
        const response = await fetch(`${SESSIONS_ROUTE}?offset=${String(offsetRef.current)}&limit=${String(PAGE_SIZE)}`, { headers: { 'cache-control': 'no-cache' } })
        if (response.ok) {
          const data = (await response.json()) as SessionsPayload
          if (data?.ok === true && !stopped.current) setPanel(data)
        }
      } catch {
        /* 分页面板缺席(老版本宿主):静默,存量口径照常显示 */
      }
      if (!stopped.current) setTimeout(tick, 5000)
    }
    void tick()
    return () => {
      stopped.current = true
    }
  }, [offset])

  const prefs = panel?.displayPrefs
  const stockVisible = prefs?.rows.stock !== false
  const totalVisible = prefs?.rows.total !== false
  const moneyVisible = prefs?.rows.money !== false
  const compact = prefs?.mode === 'compact'
  const focus = prefs?.focusSessionId ?? null
  const persisted = panel?.persisted?.persisted === true

  const integral = panel?.integralTotal
  const stockEmpty = snap === null || (snap.gross.exact + snap.gross.estimated === 0)
  const integralEmpty = integral === undefined || integral.calls === 0
  // 桩数据/部分载荷可能缺数组字段:统一兜底,账本判据与渲染共用同一视图。
  const panelSessions = panel?.sessions ?? []
  const panelLiveOnly = panel?.liveOnly ?? []
  // 本会话存量/累计为零时若账本已有回填数据,仍要落全卡渲染——早退会把
  // 会话账本一起吞掉(存量空 ≠ 无历史节省)。
  const ledgerReady = panelSessions.length > 0 || panelLiveOnly.length > 1
  if (stockEmpty && integralEmpty && !ledgerReady) {
    return <div className={css.pricing}>{t('savings.empty')}</div>
  }
  const hasExact = snap !== null && (snap.gross.exact > 0 || snap.offsets.exact > 0)
  const hasEstimated = snap !== null && (snap.gross.estimated > 0 || snap.offsets.estimated > 0)
  const netTone = snap !== null && (snap.net.exact + snap.net.estimated) >= 0 ? css.savingsNetPositive : css.savingsNetNegative
  return (
    <div className={`${css.savingsCard}`} data-testid="savings-card">
      <div className={css.savingsRow}>
        <span>{t('savings.title')}</span>
        {panel === null ? null : (
          <span className={css.savingsMuted} data-testid="savings-persisted">
            {persisted ? `✓ ${t('savings.persisted')}` : `⚠ ${t('savings.degraded')}`}
          </span>
        )}
      </div>
      {stockVisible && snap !== null ? (
        <>
          {hasExact ? (
            <div className={`${css.savingsRow} ${netTone}`} data-testid="savings-stock-exact">
              <span>{t('savings.netExact')}</span>
              <strong>{fmt(snap.net.exact)}</strong>
            </div>
          ) : null}
          {hasEstimated ? (
            <div className={css.savingsRow} data-testid="savings-stock-estimated">
              <span>{t('savings.netEstimated')}</span>
              <strong>{fmt(snap.net.estimated)}</strong>
            </div>
          ) : null}
          {!compact ? (
            <>
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
            </>
          ) : null}
        </>
      ) : null}
      {totalVisible && integral !== undefined && integral.calls > 0 ? (
        <div className={css.savingsRow} data-testid="savings-cumulative">
          <span>{t('savings.cumulative').replace('N', fmt(integral.calls))}</span>
          <strong>
            {integral.netExact !== 0 ? fmt(integral.netExact) : ''}{integral.netExact !== 0 && integral.netEstimated !== 0 ? ' · ' : ''}{integral.netEstimated !== 0 ? `≈ ${fmt(integral.netEstimated)}` : ''}
          </strong>
        </div>
      ) : null}
      {moneyVisible && panel?.integralMoney !== undefined ? (
        <div className={css.savingsRow} data-testid="savings-money">
          <span className={css.savingsMuted}>{t('savings.money')}</span>
          <span className={css.savingsMuted}>{panel.integralMoney.currency} {panel.integralMoney.decimal}</span>
        </div>
      ) : null}
      {stockVisible && snap !== null && !compact && snap.usage !== undefined && snap.usage.requests > 0 ? (
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
      {ledgerReady ? (
        <div className={css.savingsBreakdown} data-testid="savings-session-list">
          <div className={css.savingsRow}>
            <span className={css.savingsMuted}>{t('savings.sessions')}{panel !== null && panel.total > 0 ? ` (${fmt(panel.total)})` : ''}</span>
            <span className={css.savingsMuted}>
              {panel !== null && (panel.total > panelSessions.length || panel.offset > 0) ? (
                <>
                  <a
                    href="#"
                    data-testid="savings-page-prev"
                    onClick={(event) => { event.preventDefault(); setOffset(value => Math.max(0, value - PAGE_SIZE)) }}
                  >{t('savings.pagePrev')}</a>
                  {' · '}
                </>
              ) : null}
              {panel !== null && panel.offset + panelSessions.length < panel.total ? (
                <a
                  href="#"
                  data-testid="savings-page-next"
                  onClick={(event) => { event.preventDefault(); setOffset(value => value + PAGE_SIZE) }}
                >{t('savings.pageNext')}</a>
              ) : null}
            </span>
          </div>
          {panelSessions.slice(0, 8).map(row => (
            <div key={row.sessionId} className={css.savingsRow}>
              <span className={css.savingsMuted}>
                {row.sessionId === focus ? `◎ ${t('savings.focus')} · ` : ''}{row.sessionId.slice(0, 8)}… · {fmt(row.integral.calls)} calls
              </span>
              <span className={css.savingsMuted}>
                {fmt(row.net.exact)}{row.money !== undefined ? ` · ${row.money.currency} ${row.money.decimal}` : ''}
              </span>
            </div>
          ))}
          {panelLiveOnly.slice(0, 3).map(row => (
            <div key={row.sessionId} className={css.savingsRow}>
              <span className={css.savingsMuted}>{row.sessionId.slice(0, 8)}… · {t('savings.netEstimated')}</span>
              <span className={css.savingsMuted}>{fmt(row.net.exact + row.net.estimated)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {stockVisible && snap !== null && !compact && snap.perComponent.length > 0 ? (
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
