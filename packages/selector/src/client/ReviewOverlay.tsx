/**
 * TokenPilot-inspired R4: the review floating window.
 *
 * Mounted on the host `shell.overlay` slot (dsh-tidychat precedent: the layer
 * is click-through by default and only the card opts back in), showing a
 * bottom-right badge while any session has pending proposals and a card with
 * the four-state summary row plus one row per proposal. Every 10s it polls the
 * review-queue route; when the queue is empty or review mode is off the
 * component renders null, so it never disturbs the session.
 *
 * Styles carry the `dsh-cc-review-` prefix and ride a one-shot style tag.
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { SettingsScopeLike } from './review-scope.ts'

const QUEUE_ROUTES = [
  '/api/dsh-context-compression-improved/review-queue',
  '/endpoint/dsh-context-compression-improved/review-queue',
] as const
const DECIDE_ROUTES = [
  '/api/dsh-context-compression-improved/review-decide',
  '/endpoint/dsh-context-compression-improved/review-decide',
] as const

export interface PendingProposal {
  readonly sessionId: string
  readonly id: string
  readonly kind: string
  readonly items: readonly { readonly seq: number, readonly tokensBefore: number, readonly tokensAfter: number }[]
  readonly benefit: {
    readonly recoveredTokens: number
    readonly paybackTurns?: number
    readonly expectedSaving?: number
  }
}

export interface ReviewSummary {
  readonly autoApplied: number
  readonly reviewApplied: number
  readonly expired: number
  readonly voided: number
}

interface ReviewOverlayProps {
  /** Bound settings scope; supplies the reviewMode switch. */
  scope: SettingsScopeLike
  t: (key: string) => string
}

const CSS = `
.dsh-cc-review-badge {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 70;
  pointer-events: auto;
  box-sizing: border-box;
  min-width: 34px;
  height: 34px;
  padding: 0 10px;
  border-radius: 17px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4));
  background: var(--dsw-alias-bg-layer-3, #fff);
  color: var(--dsw-alias-label-primary, #222);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
}
.dsh-cc-review-card {
  position: fixed;
  right: 20px;
  bottom: 62px;
  z-index: 70;
  pointer-events: auto;
  box-sizing: border-box;
  width: min(420px, calc(100vw - 40px));
  max-height: min(60vh, 520px);
  overflow: auto;
  background: var(--dsw-alias-bg-layer-3, #fff);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4));
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  padding: 12px 14px;
  color: var(--dsw-alias-label-primary, #222);
  font-size: 13px;
}
.dsh-cc-review-title {
  font-weight: 600;
  margin: 0 0 6px;
  font-size: 13px;
}
.dsh-cc-review-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--dsw-alias-label-tertiary, #888);
  font-size: 12px;
  margin-bottom: 8px;
}
.dsh-cc-review-row {
  border-top: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25));
  padding: 8px 0;
}
.dsh-cc-review-row-meta {
  color: var(--dsw-alias-label-tertiary, #888);
  font-size: 12px;
  margin-bottom: 4px;
}
.dsh-cc-review-actions {
  display: flex;
  gap: 8px;
}
.dsh-cc-review-btn {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4));
  background: transparent;
  color: inherit;
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}
.dsh-cc-review-btn-primary {
  background: var(--dsw-alias-state-business-primary, #3b82f6);
  border-color: transparent;
  color: #fff;
}
`

function injectOnce(): () => void {
  const tag = document.createElement('style')
  tag.setAttribute('data-plugin-css', 'dsh-context-compression-improved-review')
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}

async function fetchJson(route: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(route, { headers: { 'cache-control': 'no-cache' }, ...init })
  if (!response.ok) return undefined
  return response.json()
}

async function pollQueue(): Promise<{ pending: PendingProposal[], summary?: ReviewSummary | undefined } | undefined> {
  for (const route of QUEUE_ROUTES) {
    const body = await fetchJson(route) as {
      ok?: boolean
      total?: number
      pending?: PendingProposal[]
      summary?: ReviewSummary
    } | undefined
    if (body?.ok === true) {
      return { pending: body.pending ?? [], summary: body.summary }
    }
  }
  return undefined
}

async function postDecide(proposal: PendingProposal, decision: string): Promise<boolean> {
  for (const route of DECIDE_ROUTES) {
    try {
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: proposal.sessionId, proposalId: proposal.id, decision }),
      })
      if (response.status !== 404) return response.ok
    } catch {
      // Try the next prefix.
    }
  }
  return false
}

/**
 * Slot factory helper: the client entry is a .ts file and cannot carry JSX,
 * so the element construction lives here.
 */
export function renderReviewOverlay(
  scope: SettingsScopeLike,
  t: (key: string) => string,
): ReactElement {
  return <ReviewOverlay scope={scope} t={t} />
}

/**
 * The floating window itself: renders null (and stays silent) while review
 * mode is off or nothing is pending.
 */
export function ReviewOverlay({ scope, t }: ReviewOverlayProps) {
  const [reviewMode, setReviewMode] = useState(false)
  const [pending, setPending] = useState<PendingProposal[]>([])
  const [summary, setSummary] = useState<ReviewSummary | undefined>()
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(injectOnce, [])
  useEffect(() => {
    const pull = (): void => {
      try {
        const snapshot = scope.getSnapshot()
        setReviewMode(snapshot.status === 'ready' && snapshot.value?.presetOptions?.reviewMode === true)
      } catch {
        setReviewMode(false)
      }
    }
    pull()
    let unsubscribe: () => void
    try {
      unsubscribe = scope.subscribe(pull)
    } catch {
      unsubscribe = (): void => {}
    }
    return unsubscribe
  }, [scope])

  useEffect(() => {
    if (!reviewMode) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      void pollQueue().then((result) => {
        if (!alive) return
        setPending(result?.pending ?? [])
        setSummary(result?.summary)
        timer = setTimeout(tick, 10_000)
      })
    }
    tick()
    return () => {
      alive = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [reviewMode])

  if (!reviewMode || pending.length === 0) return null

  const decide = (proposal: PendingProposal, decision: string): void => {
    setBusy(true)
    void postDecide(proposal, decision).then(() => {
      return pollQueue().then((result) => {
        setPending(result?.pending ?? [])
        setSummary(result?.summary)
        setBusy(false)
      })
    }).catch(() => { setBusy(false) })
  }

  const seqRange = (proposal: PendingProposal): string => {
    const seqs = proposal.items.map(item => item.seq)
    const min = Math.min(...seqs)
    const max = Math.max(...seqs)
    return min === max ? `#${String(min)}` : `#${String(min)}–#${String(max)}`
  }

  return (
    <>
      {expanded ? (
        <div className="dsh-cc-review-card">
          <p className="dsh-cc-review-title">{t('review.title')}</p>
          {summary !== undefined ? (
            <div className="dsh-cc-review-summary">
              <span>{t('review.summary.autoApplied')}: {String(summary.autoApplied)}</span>
              <span>{t('review.summary.reviewApplied')}: {String(summary.reviewApplied)}</span>
              <span>{t('review.summary.expired')}: {String(summary.expired)}</span>
              <span>{t('review.summary.voided')}: {String(summary.voided)}</span>
            </div>
          ) : null}
          {pending.map(proposal => (
            <div className="dsh-cc-review-row" key={proposal.id}>
              <div className="dsh-cc-review-row-meta">
                {proposal.kind} · {seqRange(proposal)} · R ≈ {String(proposal.benefit.recoveredTokens)}
                {proposal.benefit.paybackTurns !== undefined
                  ? ` · ${t('review.row.payback')}: ${String(Math.round(proposal.benefit.paybackTurns * 100) / 100)}`
                  : ''}
                {proposal.benefit.expectedSaving !== undefined
                  ? ` · ${t('review.row.expectedSaving')}: ${String(Math.round(proposal.benefit.expectedSaving))} (${t('review.row.estimated')})`
                  : ''}
              </div>
              <div className="dsh-cc-review-actions">
                <button
                  type="button" className="dsh-cc-review-btn dsh-cc-review-btn-primary"
                  disabled={busy}
                  onClick={() => { decide(proposal, 'approved') }}
                >
                  {t('review.action.approve')}
                </button>
                <button
                  type="button" className="dsh-cc-review-btn"
                  disabled={busy}
                  onClick={() => { decide(proposal, 'rejected') }}
                >
                  {t('review.action.reject')}
                </button>
                <button
                  type="button" className="dsh-cc-review-btn"
                  disabled={busy}
                  onClick={() => { decide(proposal, 'ignored') }}
                >
                  {t('review.action.ignore')}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <button
        type="button" className="dsh-cc-review-badge"
        onClick={() => { setExpanded(value => !value) }}
      >
        {t('review.badge')} {String(pending.length)}
      </button>
    </>
  )
}
