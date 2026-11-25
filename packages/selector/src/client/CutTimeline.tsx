/**
 * CutTimeline: per-cut audit timeline with strategy classification.
 *
 * Plan: cci-longterm-refactor v0.14.3 (F6)
 *
 * Displays a scrollable table of all cuts from cuts.jsonl.
 * Each row: timestamp | strategy badge | before→after | netGain | cacheRecompute
 * Top KPIs: total cut / net saved / active savings / card count
 *
 * @module dsh-context-compression-improved/client/CutTimeline
 */
import { useEffect, useState } from 'react'

interface CutRow {
  ts: string
  strategy: 'small-knife' | 'big-knife' | 'card-merge' | 'skeleton'
  component: string
  tokensBefore: number
  tokensAfter: number
  netGain: number
  cacheRecomputeEst: number
}

const STRATEGY_COLORS: Record<string, string> = {
  'small-knife': '#4a9eff',
  'big-knife': '#ff6b35',
  'card-merge': '#9b59b6',
  'skeleton': '#27ae60',
}

const STRATEGY_LABELS: Record<string, string> = {
  'small-knife': '小刀',
  'big-knife': '大刀',
  'card-merge': '中刀',
  'skeleton': '骨架',
}

export interface CutTimelineProps {
  /** Fetch URL for cuts data. Default: '/api/dsh-context-compression-cuts'. */
  readonly fetchUrl?: string
  readonly sessionId?: string
}

export function CutTimeline({ fetchUrl = '/api/dsh-context-compression-cuts', sessionId }: CutTimelineProps) {
  const [cuts, setCuts] = useState<CutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    const url = sessionId ? `${fetchUrl}?session=${sessionId}` : fetchUrl
    fetch(url)
      .then(r => r.ok ? r.json() : [])
      .then((data: CutRow[]) => { setCuts(data); setLoading(false) })
      .catch(() => { setLoading(false) })
  }, [fetchUrl, sessionId])

  const filtered = filter === 'all' ? cuts : cuts.filter(c => c.strategy === filter)
  const totalSaved = filtered.reduce((s, c) => s + Math.max(0, c.netGain), 0)
  const totalCuts = filtered.length

  if (loading) return <div role="status">加载刀法记录...</div>

  return (
    <div style={{ fontSize: '0.85em' }}>
      {/* KPI */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <span>总刀数: <strong>{totalCuts}</strong></span>
        <span>累计净省: <strong>{totalSaved.toLocaleString()}</strong> tokens</span>
      </div>
      {/* Filter */}
      <div style={{ marginBottom: 8 }}>
        <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="策略筛选">
          <option value="all">全部</option>
          <option value="small-knife">小刀</option>
          <option value="big-knife">大刀</option>
          <option value="card-merge">中刀</option>
          <option value="skeleton">骨架</option>
        </select>
      </div>
      {/* Table */}
      <div style={{ maxHeight: 400, overflow: 'auto', border: '1px solid #ddd', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', position: 'sticky', top: 0 }}>
              <th style={{ padding: 4, textAlign: 'left' }}>时间</th>
              <th style={{ padding: 4 }}>策略</th>
              <th style={{ padding: 4, textAlign: 'right' }}>Before→After</th>
              <th style={{ padding: 4, textAlign: 'right' }}>净省</th>
              <th style={{ padding: 4, textAlign: 'right' }}>重算</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((cut, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 4, whiteSpace: 'nowrap' }}>{new Date(cut.ts).toLocaleTimeString()}</td>
                <td style={{ padding: 4, textAlign: 'center' }}>
                  <span style={{ color: '#fff', background: STRATEGY_COLORS[cut.strategy], padding: '1px 5px', borderRadius: 3, fontSize: '0.8em' }}>
                    {STRATEGY_LABELS[cut.strategy] ?? cut.strategy}
                  </span>
                </td>
                <td style={{ padding: 4, textAlign: 'right' }}>{cut.tokensBefore.toLocaleString()}→{cut.tokensAfter.toLocaleString()}</td>
                <td style={{ padding: 4, textAlign: 'right', color: cut.netGain > 0 ? '#27ae60' : '#e74c3c' }}>{cut.netGain.toLocaleString()}</td>
                <td style={{ padding: 4, textAlign: 'right', opacity: 0.7 }}>{cut.cacheRecomputeEst.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 ? <div style={{ padding: 8, opacity: 0.7 }}>显示前 200 条，共 {filtered.length} 条</div> : null}
      </div>
    </div>
  )
}
