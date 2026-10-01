/**
 * 节省统计账本(诚实口径)。
 *
 * 原则(与 dsh-token-optimizer 类功能对齐的需求口径):
 *  1. **只记已实现**:抵扣来自真实落盘的 rewrite(published replacement)的
 *     tokensBefore − tokensAfter,不按"本可以压多少"的最大值计;
 *  2. **负节省(配对抵消)**:同一份原文先被压缩(代码骨架/历史老化/去重指针/
 *     尾裁引用)后,模型又请求了全文——原声称的节省被抵消:全文读取本身
 *     记为负项。净额因此可以为负(骨架 S + 全文 O,对比从未压缩的基线 O,
 *     净 −S),这正是"先骨架再全文 = 负节省"的诚实口径;
 *  3. **口径分列,不混算**:精确 tokenizer 与 chars/4 估算两个 basis 各自独立
 *     汇总,永不合并成一个数。
 *
 * 存储:进程内 per-session 账本(条目环形缓冲 + hash 注册表)。不落盘——
 * 节省统计是运行期面板数据,重启归零是可接受语义(审计日志里已有全量原始记录)。
 *
 * @module dsh-context-compression-improved/runtime/savings
 */
import { createHash } from 'node:crypto'

export type SavingsBasis = 'exact-tokenizer' | 'characters'

export interface SavingsEntry {
  kind: 'saving' | 'offset'
  /** 保存组件(fresh/aggregate/history/tail-trim/dedupe)或抵消原因(full-read/retrieve)。 */
  component: string
  tokens: number
  basis: SavingsBasis
  at: number
  note?: string
}

interface RegistryItem {
  sessionId: string
  component: string
  /** 压缩时声称省下的 token 数(抵消时按此科目回冲)。 */
  claimedTokens: number
  basis: SavingsBasis
  sourceSeq: number
  consumed: boolean
}

const MAX_ENTRIES_PER_SESSION = 400
const MAX_REGISTRY = 2048

export class SavingsLedger {
  private readonly entries = new Map<string, SavingsEntry[]>()
  private readonly registry = new Map<string, RegistryItem>()
  private readonly seenFullText = new Set<string>()
  private readonly usage = new Map<string, SessionUsageTotals>()
  private startedAt = Date.now()

  /**
   * 累计一次官方 usage(request-boundary 读取上一已完成请求;末次请求在
   * dispose 汇总前未入账属可接受低估)。usage 字段缺省按 0 计。
   */
  recordUsage(sessionId: string, usage: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }): void {
    let total = this.usage.get(sessionId)
    if (total === undefined) {
      total = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      this.usage.set(sessionId, total)
    }
    total.requests += 1
    total.inputTokens += positiveOrZero(usage.inputTokens)
    total.outputTokens += positiveOrZero(usage.outputTokens)
    total.cacheReadTokens += positiveOrZero(usage.cacheReadTokens)
    total.cacheWriteTokens += positiveOrZero(usage.cacheWriteTokens)
  }

  private totalsFor(scope: readonly string[]): SessionUsageTotals {
    const sum: SessionUsageTotals = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    for (const sid of scope) {
      const t = this.usage.get(sid)
      if (t === undefined) continue
      sum.requests += t.requests
      sum.inputTokens += t.inputTokens
      sum.outputTokens += t.outputTokens
      sum.cacheReadTokens += t.cacheReadTokens
      sum.cacheWriteTokens += t.cacheWriteTokens
    }
    return sum
  }

  /** 单行会话汇总(session/disposed 日志用)。 */
  sessionSummaryLine(sessionId: string): string {
    const snap = this.snapshot(sessionId)
    const hit = snap.usage.cacheHitRate
    return `net=${snap.net.exact}(exact)/${snap.net.estimated}(est) ` +
      `gross=${snap.gross.exact}/${snap.gross.estimated} offsets=${snap.offsets.exact}/${snap.offsets.estimated} ` +
      `requests=${snap.usage.requests} cacheHit=${hit === null ? '–' : `${Math.round(hit * 100)}%`}`
  }

  /** 记录一次已落盘的压缩节省(land 成功后调用;tokensRemoved ≤ 0 忽略)。 */
  recordSaving(input: {
    sessionId: string
    component: string
    tokensBefore: number
    tokensAfter: number
    basis: SavingsBasis
    sourceSeq: number
    /** 原文全文(配对键;哈希后不存原文)。 */
    originalText?: string
  }): void {
    const removed = input.tokensBefore - input.tokensAfter
    if (!Number.isFinite(removed) || removed <= 0) return
    this.push(input.sessionId, {
      kind: 'saving',
      component: input.component,
      tokens: removed,
      basis: input.basis,
      at: Date.now(),
    })
    if (typeof input.originalText === 'string' && input.originalText.length > 0) {
      const hash = savingsHash(input.originalText)
      if (this.registry.size >= MAX_REGISTRY && !this.registry.has(hash)) {
        const oldest = this.registry.keys().next().value
        if (oldest !== undefined) this.registry.delete(oldest)
      }
      this.registry.set(hash, {
        sessionId: input.sessionId,
        component: input.component,
        claimedTokens: removed,
        basis: input.basis,
        sourceSeq: input.sourceSeq,
        consumed: false,
      })
    }
  }

  /**
   * 新的全文工具结果进入上下文(每个 (session, seq) 只看一次):若其原文哈希
   * 命中之前压缩过的条目且未消费过抵消 → 记负项并消费。
   * @param measure 返回 {tokens, basis}——全文按当前可用口径计量。
   */
  noteFullText(input: {
    sessionId: string
    seq: number
    text: string
    measure: (text: string) => { tokens: number; basis: SavingsBasis }
  }): void {
    if (typeof input.text !== 'string' || input.text.length === 0) return
    const seenKey = `${input.sessionId}:${input.seq}`
    if (this.seenFullText.has(seenKey)) return
    this.seenFullText.add(seenKey)
    if (this.seenFullText.size > MAX_REGISTRY * 4) {
      // 粗放防胀:超过容量上限时整体清空(成员只是防重哨兵,漏一次重复探测无害)
      this.seenFullText.clear()
      this.seenFullText.add(seenKey)
    }
    const hit = this.registry.get(savingsHash(input.text))
    if (hit === undefined || hit.consumed || hit.sessionId !== input.sessionId) return
    hit.consumed = true
    const { tokens, basis } = input.measure(input.text)
    if (tokens <= 0) return
    this.push(input.sessionId, {
      kind: 'offset',
      component: 'full-read',
      tokens,
      basis,
      at: Date.now(),
      note: `#${hit.sourceSeq} ${hit.component} 的原文被全文重读(原声称 −${hit.claimedTokens})`,
    })
  }

  /** retrieve 回读(部分或全部)重新进入上下文:按返回内容计量记负项。 */
  recordOffset(input: {
    sessionId: string
    component: 'retrieve' | 'tailtrim-retrieve'
    tokens: number
    basis: SavingsBasis
    note?: string
  }): void {
    if (!Number.isFinite(input.tokens) || input.tokens <= 0) return
    this.push(input.sessionId, {
      kind: 'offset',
      component: input.component,
      tokens: input.tokens,
      basis: input.basis,
      at: Date.now(),
      ...(input.note === undefined ? {} : { note: input.note }),
    })
  }

  private sourceSeqOf(item: RegistryItem): number {
    return item.sourceSeq
  }

  private push(sessionId: string, entry: SavingsEntry): void {
    let list = this.entries.get(sessionId)
    if (list === undefined) {
      list = []
      this.entries.set(sessionId, list)
    }
    list.push(entry)
    if (list.length > MAX_ENTRIES_PER_SESSION) list.splice(0, list.length - MAX_ENTRIES_PER_SESSION)
  }

  /** 汇总快照。sessionId 缺省 = 全会话聚合。两个 basis 分列,永不合并。 */
  snapshot(sessionId?: string): SavingsSnapshot {
    const scope = sessionId === undefined ? [...this.entries.keys()] : [sessionId]
    const totals = { grossExact: 0, grossEstimated: 0, offsetExact: 0, offsetEstimated: 0 }
    const perComponent = new Map<string, { component: string; tokens: number; basis: SavingsBasis; kind: 'saving' | 'offset' }>()
    const recentOffsets: SavingsEntry[] = []
    for (const sid of scope) {
      for (const entry of this.entries.get(sid) ?? []) {
        const exact = entry.basis === 'exact-tokenizer'
        if (entry.kind === 'saving') {
          if (exact) totals.grossExact += entry.tokens
          else totals.grossEstimated += entry.tokens
        } else {
          if (exact) totals.offsetExact += entry.tokens
          else totals.offsetEstimated += entry.tokens
          recentOffsets.push(entry)
        }
        const key = `${entry.kind}:${entry.component}:${entry.basis}`
        const agg = perComponent.get(key)
        if (agg === undefined) {
          perComponent.set(key, { component: entry.component, tokens: entry.tokens, basis: entry.basis, kind: entry.kind })
        } else {
          agg.tokens += entry.tokens
        }
      }
    }
    recentOffsets.sort((a, b) => b.at - a.at)
    const usageTotals = this.totalsFor(scope)
    // 按会话分桶(monitor 口径):净额精确口径降序,前 8
    const perSession = sessionId === undefined
      ? [...new Set([...this.entries.keys(), ...this.usage.keys()])]
        .map(sid => {
          const s = this.snapshot(sid)
          return {
            sessionId: sid,
            gross: s.gross,
            offsets: s.offsets,
            net: s.net,
            requests: s.usage.requests,
            cacheHitRate: s.usage.cacheHitRate,
          }
        })
        .sort((a, b) => (b.net.exact - a.net.exact) || (b.net.estimated - a.net.estimated))
        .slice(0, 8)
      : []
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      sessions: sessionId === undefined ? this.entries.size : this.entries.has(sessionId) ? 1 : 0,
      gross: { exact: totals.grossExact, estimated: totals.grossEstimated },
      offsets: { exact: totals.offsetExact, estimated: totals.offsetEstimated },
      net: {
        exact: totals.grossExact - totals.offsetExact,
        estimated: totals.grossEstimated - totals.offsetEstimated,
      },
      perComponent: [...perComponent.values()].sort((a, b) => b.tokens - a.tokens),
      recentOffsets: recentOffsets.slice(0, 8).map((e) => ({
        component: e.component,
        tokens: e.tokens,
        basis: e.basis,
        at: new Date(e.at).toISOString(),
        ...(e.note === undefined ? {} : { note: e.note }),
      })),
      usage: { ...usageTotals, cacheHitRate: cacheHitRateOf(usageTotals) },
      perSession,
    }
  }

  /** 测试与停机清理。 */
  clear(): void {
    this.entries.clear()
    this.registry.clear()
    this.seenFullText.clear()
    this.usage.clear()
    this.startedAt = Date.now()
  }
}

export interface SavingsSnapshot {
  startedAt: string
  sessions: number
  gross: { exact: number; estimated: number }
  offsets: { exact: number; estimated: number }
  net: { exact: number; estimated: number }
  perComponent: Array<{ component: string; tokens: number; basis: SavingsBasis; kind: 'saving' | 'offset' }>
  recentOffsets: Array<{ component: string; tokens: number; basis: SavingsBasis; at: string; note?: string }>
  /** 真实 usage 聚合(monitor 模块学到的口径:官方 usage 而非估算)。 */
  usage: SessionUsageTotals & { cacheHitRate: number | null }
  /** 按会话分桶(仅全会话聚合时;按净额精确口径降序,前 8)。 */
  perSession: Array<{
    sessionId: string
    gross: { exact: number; estimated: number }
    offsets: { exact: number; estimated: number }
    net: { exact: number; estimated: number }
    requests: number
    cacheHitRate: number | null
  }>
}

/** 单会话真实 usage 累计(官方 TokenMeter 口径)。 */
export interface SessionUsageTotals {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

function cacheHitRateOf(t: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number | null {
  const denom = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens
  return denom <= 0 ? null : Math.round((t.cacheReadTokens / denom) * 1000) / 1000
}

/** 原文配对哈希(规整行尾与首尾空白——同一文件两次读取的 innocuous 差异不配错)。 */
export function savingsHash(text: string): string {
  return createHash('sha256')
    .update(
      text
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/(^\s+)|(\s+$)/g, ''),
      'utf8',
    )
    .digest('hex')
}

function positiveOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0
}

const singleton = new SavingsLedger()

/** 模块级单例:pruner 与 retrieve 分处两文件,共享同一本账。 */
export function getSavingsLedger(): SavingsLedger {
  return singleton
}
