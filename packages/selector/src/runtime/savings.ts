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
 * 存储:本账本是**存量仪表**层(进程内 per-session,环形缓冲 + hash 注册表,
 * 重启归零——重进会话由投影播种重建)。统计口径共三层:
 *  1. 存量仪表(本账本):当前 surface 生效的毛节省/抵消/净额,随内容进出涨落;
 *  2. 持久 claims 流水(stats-sync → stats-db):land/retrieve/usage 事件级幂等
 *     行落库,跨重启保留,作审计与面板累计数据源;
 *  3. 累计积分(savings-integral,fresh 边界按 call 采样存量净额入库):回答
 *     "历史上省了多少",随 T15 积分器落地。
 *
 * 存量/流量分离(记账口径三件套):
 *  - offset 条目可带 sourceSeq,observeActive 按"召回文本存活面"收敛,离面即停罚;
 *  - 同 basis 召回经 foldRecall 折叠进源条目(贡献 a−(b+R),下限 −b,翻负后带
 *    negative-effect 标记供分项显示);跨 basis 禁折叠,退化为带 sourceSeq 的
 *    收敛 offset,守住"口径分列永不合并"原则;
 *  - 环形缓冲溢出优先淘汰离面/无源条目,replacementSeq 仍在面上的 saving 绝不清。
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
  /** 落盘替换事件的 seq;'saving' 条目靠它判定"当前是否仍在 surface 中生效"。 */
  replacementSeq?: number
  /**
   * 配对/收敛键(按 kind 区分):
   *  - 'saving':被压缩根源事件 seq(recordSaving 传入),foldRecall 按源配对的折叠键;
   *  - 'offset':决定罚项存活的事件 seq —— full-read 为全文重读事件自身
   *    (离面即停罚);retrieve 跨 basis 退化条目为根源事件 seq(必不在面上
   *    → 下一次收敛即停罚——不混口径的代价,投影归因路线整体解决)。
   */
  sourceSeq?: number
  /** foldRecall 折叠下限(= −tokensAfter,即全量召回翻负后的 −b)。仅 'saving' 条目有意义。 */
  foldFloor?: number
  /** 折叠后源条目贡献翻负(负效果骨架;分项显示用)。 */
  negativeEffect?: boolean
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

// 环形缓冲 cap:驱逐已改为“保护在面条目、优先淘汰离面/无源条目”(见 push),
// 活条目不再被静默丢弃,cap 相应放宽。
const MAX_ENTRIES_PER_SESSION = 800
const MAX_REGISTRY = 2048

export class SavingsLedger {
  private readonly entries = new Map<string, SavingsEntry[]>()
  private readonly registry = new Map<string, RegistryItem>()
  private readonly seenFullText = new Set<string>()
  /** 最近一次 observeActive 传入的存活 seq(驱逐保护判据;缺省 = 保守保护)。 */
  private readonly lastLiveSeqs = new Map<string, ReadonlySet<number>>()
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

  /**
   * 记录一次已落盘的压缩节省(land 成功后调用;tokensRemoved ≤ 0 忽略)。
   *
   * 仪表口径:该条目在替换事件离开当前 surface 前一直计入"当前生效毛节省"
   * (由 {@link observeActive} 每回合收敛),不再一次性永久累加。
   */
  recordSaving(input: {
    sessionId: string
    component: string
    tokensBefore: number
    tokensAfter: number
    basis: SavingsBasis
    sourceSeq: number
    /** 落盘替换事件的 seq;仪表口径用它判定"当前是否仍生效"。 */
    replacementSeq?: number
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
      sourceSeq: input.sourceSeq,
      // 折叠下限 −b:全量召回后源条目最多翻负到骨架本身的费用。
      foldFloor: -Math.max(0, input.tokensAfter),
      ...(input.replacementSeq === undefined ? {} : { replacementSeq: input.replacementSeq }),
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
    if (hit === undefined || hit.sessionId !== input.sessionId) return
    // 每次重读都罚:不再一次性消费——只要首次压缩(骨架/老化/去重/尾裁)存在,
    // 之后每次把该原文全文重新读入上下文都记一条负项。
    const { tokens, basis } = input.measure(input.text)
    if (tokens <= 0) return
    this.push(input.sessionId, {
      kind: 'offset',
      component: 'full-read',
      tokens,
      basis,
      at: Date.now(),
      // 收敛键 = 全文重读事件自身:它在面上一天,罚就压一天;被后续压缩老化
      // 出面即停(见 observeActive)。
      sourceSeq: input.seq,
      note: `#${hit.sourceSeq} ${hit.component} 的原文被全文重读(原声称 −${hit.claimedTokens})`,
    })
  }

  /** retrieve 回读(部分或全部)重新进入上下文:按返回内容计量记负项。 */
  recordOffset(input: {
    sessionId: string
    component: 'retrieve' | 'tailtrim-retrieve'
    tokens: number
    basis: SavingsBasis
    /** 收敛键(见 SavingsEntry.sourceSeq):带它的条目离面即停罚,缺省保持永久流水。 */
    sourceSeq?: number
    note?: string
  }): void {
    if (!Number.isFinite(input.tokens) || input.tokens <= 0) return
    this.push(input.sessionId, {
      kind: 'offset',
      component: input.component,
      tokens: input.tokens,
      basis: input.basis,
      at: Date.now(),
      ...(input.sourceSeq === undefined ? {} : { sourceSeq: input.sourceSeq }),
      ...(input.note === undefined ? {} : { note: input.note }),
    })
  }

  /**
   * 召回翻负折叠:把一次召回(实测 R)折进同 (sessionId, sourceSeq, basis) 的源
   * saving 条目:贡献 a−(b+R),下限 −b(多次召回累计不再下探)。翻负后条目带
   * negative-effect 标记,snapshot 分项里以负值呈现,净额与旧行为(毛节省 +(a−b)
   * 叠加流水 −R)等值。
   *
   * 跨 basis 不折叠(口径分列永不合并):退化为带 sourceSeq 的收敛 offset,
   * 下一次 observeActive 即离面停罚。未找到源条目(已离面/投影播种无配对键)同路。
   *
   * @returns 是否折进了源条目(false = 走了退化 offset 流水或无效入参)。
   */
  foldRecall(
    sessionId: string,
    sourceSeq: number,
    recalledTokens: number,
    basis: SavingsBasis,
    fallback?: { component?: 'retrieve' | 'tailtrim-retrieve'; note?: string },
  ): boolean {
    if (!Number.isFinite(recalledTokens) || recalledTokens <= 0) return false
    const list = this.entries.get(sessionId)
    if (list !== undefined) {
      // 同根源可能叠多条递进压缩条目(后一次替换前一次):取最新可折者,
      // 其下限 −b 恰好等于整条压缩链的真骨架成本。
      for (let i = list.length - 1; i >= 0; i--) {
        const entry = list[i]!
        if (entry.kind !== 'saving' || entry.sourceSeq !== sourceSeq || entry.basis !== basis) continue
        entry.tokens = Math.max(entry.tokens - recalledTokens, entry.foldFloor ?? 0)
        if (entry.tokens < 0) entry.negativeEffect = true
        return true
      }
    }
    this.push(sessionId, {
      kind: 'offset',
      component: fallback?.component ?? 'retrieve',
      tokens: recalledTokens,
      basis,
      at: Date.now(),
      sourceSeq,
      ...(fallback?.note === undefined ? {} : { note: fallback.note }),
    })
    return false
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
    if (list.length <= MAX_ENTRIES_PER_SESSION) return
    // 溢出驱逐:从最旧端优先淘汰"可驱逐"条目(离面/无源的 saving、一切 offset),
    // replacementSeq 仍在面上的 saving 绝不清;若全条列表都受保护则允许暂时超 cap
    // (宁胀不误删生效中条目——旧 splice(0,..) 静默丢活条目的缺陷)。
    const live = this.lastLiveSeqs.get(sessionId)
    while (list.length > MAX_ENTRIES_PER_SESSION) {
      const idx = list.findIndex(candidate => !isSurfaceProtected(candidate, live))
      if (idx === -1) break
      list.splice(idx, 1)
    }
  }

  /**
   * 仪表口径收敛:
   *  - 'saving' 条目只在其替换事件仍位于当前 surface 时计为"当前生效毛节省",
   *    离开 surface 即从毛节省中扣除;无 replacementSeq 的保持原样(无法追踪者不收敛)。
   *  - 带 sourceSeq 的 'offset' 条目按"召回文本存活面"收敛:sourceSeq 离面即停罚
   *    (full-read = 重读事件自身);无 sourceSeq 的 offset 保持原样(永久流水)。
   */
  observeActive(sessionId: string, liveSeqs: ReadonlySet<number>): void {
    this.lastLiveSeqs.set(sessionId, liveSeqs)
    const list = this.entries.get(sessionId)
    if (list === undefined) return
    const kept = list.filter(entry => {
      if (entry.kind === 'saving') {
        return entry.replacementSeq === undefined || liveSeqs.has(entry.replacementSeq)
      }
      return entry.sourceSeq === undefined || liveSeqs.has(entry.sourceSeq)
    })
    if (kept.length !== list.length) this.entries.set(sessionId, kept)
  }

  /** 该会话是否已有账本条目(重进会话时用于避免投影与实时叠加)。 */
  hasSession(sessionId: string): boolean {
    return this.entries.has(sessionId)
  }

  /**
   * 用会话日志投影播种一个会话的账本(重进/重启会话时调用一次)。写入
   * savings/offsets 条目及其原文配对 registry,后续实时增量(observeActive /
   * noteFullText)在同一条目集合上继续工作。调用方负责只播种一次。
   */
  seedProjected(sessionId: string, projection: {
    savings: readonly { component: string; tokens: number; basis: SavingsBasis; at: number; replacementSeq: number }[]
    offsets: readonly { component: string; tokens: number; basis: SavingsBasis; at: number; note?: string }[]
    registry: readonly { hash: string; claimedTokens: number; basis: SavingsBasis; sourceSeq: number }[]
  }): void {
    for (const entry of projection.savings) {
      if (!Number.isFinite(entry.tokens) || entry.tokens <= 0) continue
      this.push(sessionId, {
        kind: 'saving',
        component: entry.component,
        tokens: entry.tokens,
        basis: entry.basis,
        at: entry.at,
        replacementSeq: entry.replacementSeq,
      })
    }
    for (const entry of projection.offsets) {
      if (!Number.isFinite(entry.tokens) || entry.tokens <= 0) continue
      this.push(sessionId, {
        kind: 'offset',
        component: entry.component,
        tokens: entry.tokens,
        basis: entry.basis,
        at: entry.at,
        ...(entry.note === undefined ? {} : { note: entry.note }),
      })
    }
    for (const item of projection.registry) {
      if (this.registry.size >= MAX_REGISTRY && !this.registry.has(item.hash)) {
        const oldest = this.registry.keys().next().value
        if (oldest !== undefined) this.registry.delete(oldest)
      }
      this.registry.set(item.hash, {
        sessionId,
        component: 'projection',
        claimedTokens: item.claimedTokens,
        basis: item.basis,
        sourceSeq: item.sourceSeq,
        consumed: false,
      })
    }
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
        if (entry.kind === 'saving' && entry.tokens >= 0) {
          if (exact) totals.grossExact += entry.tokens
          else totals.grossEstimated += entry.tokens
        } else if (entry.kind === 'saving') {
          // 翻负折叠后的负效果骨架:毛节省不再持有贡献,溢出部分计入抵消列,
          // 保持净额公式(gross − offsets)与旧行为数值等值。
          if (exact) totals.offsetExact += -entry.tokens
          else totals.offsetEstimated += -entry.tokens
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
    this.lastLiveSeqs.clear()
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

/**
 * 驱逐保护判据:'saving' 条目的 replacementSeq 仍在当前面上(或面信息未知时
 * 保守视为在面)则绝不清;其余(离面/无追踪键的 saving、一切 offset)可驱逐。
 */
function isSurfaceProtected(entry: SavingsEntry, live: ReadonlySet<number> | undefined): boolean {
  return entry.kind === 'saving'
    && entry.replacementSeq !== undefined
    && (live === undefined || live.has(entry.replacementSeq))
}

const singleton = new SavingsLedger()

/** 模块级单例:pruner 与 retrieve 分处两文件,共享同一本账。 */
export function getSavingsLedger(): SavingsLedger {
  return singleton
}
