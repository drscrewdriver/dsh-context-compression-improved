/**
 * live 写路径薄封装(spec T6/T8/T9):land/offset 随写随刷,usage 秒级节流。
 *
 * 纪律:
 *  - 全部经 {@link StatsStore.recordClaims} 同步小事务(BEGIN IMMEDIATE +
 *    INSERT OR IGNORE)落库;claims 幂等键 (session_id, 绝对 seq, kind,
 *    component, basis),重放零新增(BC #2671 两教训已进 stats-db T4 断言)。
 *  - store 缺席(无驱动/未开成) = 空转 —— stats-db 打开失败已 warn 恰一次,
 *    本模块不重复播报;内存账本照常工作,面板 persisted:false 可见降级。
 *  - 写失败 = 进程级门闩 warn 恰一次且**绝不上抛**:统计持久化故障绝不
 *    阻塞压缩主路径(BC compaction-guard 失败方向不对称教训)。
 *  - 不"flush-on-dispose"独走:老代际不发 session/disposed 会静默丢
 *    (BC guard 教训)——land/offset 随写随刷,dispose 只是残量出口。
 *  - usage 走事件日志 `assistant/message.data.usage` 按事件绝对 seq 逐科目
 *    入账(零 tokenizer),每会话一秒 debounce;sessions.version 水位单调前推,
 *    与回填共用同一覆盖范围语义。
 *
 * 隐私红线:只有计数/seq/组件枚举值/时间戳入表;原文、savingsHash、
 * 自由文本绝不落库。offset claim 的 seq 用被召回源事件 seq(findings 定键
 * (sessionId, eventSeq)):同一源事件反复召回时首次入账,后续重放幂等去重。
 *
 * @module dsh-context-compression-improved/runtime/stats-sync
 */
import type { Session } from '@deepseek-ai/dsh-session'
import type { SavingsBasis } from './savings.ts'
import { getStatsStore, type StatsClaimRow } from './stats-db.ts'
import { sessionEvents } from './session-events.ts'

/** usage 逐科目枚举:claims.component 的封闭取值(进主键,禁自由文本)。 */
const USAGE_COMPONENTS: readonly { field: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'; component: string }[] = [
  { field: 'inputTokens', component: 'input' },
  { field: 'outputTokens', component: 'output' },
  { field: 'cacheReadTokens', component: 'cacheRead' },
  { field: 'cacheWriteTokens', component: 'cacheWrite' },
]

/** usage flush 的 debounce 窗口(秒级,spec T8)。 */
const USAGE_FLUSH_DEBOUNCE_MS = 1_000

// 写失败 warn 的进程级门闩:可见但不刷屏(与 stats-db 降级门闩同一纪律)。
let writeFailureWarned = false

function warnWriteFailureOnce(error: unknown): void {
  if (writeFailureWarned) return
  writeFailureWarned = true
  const message = String((error as Error)?.message ?? error)
  console.warn('context-compression stats persistence write failed (claims fall back to in-memory only): %s', message)
}

// 前台活跃压缩窗口旗标:pruner fresh 段进出各置一次,回填调度器在 chunk 间
// 据此让路——面板/回填绝不与前台压缩抢占(前台优先纪律)。
let livePathBusy = false

/** 标记前台压缩窗口开/关(pruner fresh 段 try/finally 驱动)。 */
export function setStatsLivePathBusy(busy: boolean): void {
  livePathBusy = busy
}

/** 前台压缩是否进行中(回填让路判据;查询零开销)。 */
export function isStatsLivePathBusy(): boolean {
  return livePathBusy
}

// 「当前会话」运行时指针:每个请求边界(fresh/usage flush)都真实跑在用户正在
// 使用的会话上——比客户端注入可靠(注入只在页面加载发生,切会话不更新)。
let activeRuntimeSessionId: string | undefined

/** 请求边界处记下活跃会话(pruner/stats-sync 调用;幂等写字符串)。 */
export function noteStatsSessionActive(sessionId: string): void {
  activeRuntimeSessionId = sessionId
}

/** 当前活跃会话指针(浮窗六值的解析基准;无请求活动 = undefined)。 */
export function getStatsActiveSessionId(): string | undefined {
  return activeRuntimeSessionId
}

/** store 在场才执行写体;缺席空转,异常一律门闩 warn,绝不上抛。 */
function withStoreWrite(label: string, fn: (store: NonNullable<ReturnType<typeof getStatsStore>>) => void): void {
  const store = getStatsStore()
  if (store === null) return
  try {
    fn(store)
  } catch (error) {
    warnWriteFailureOnce(`${label}: ${String((error as Error)?.message ?? error)}`)
  }
}

/** 单条 saving claim(land 成功点与内存账本同位同值)。 */
function claimSaving(input: {
  sessionId: string
  component: string
  tokensRemoved: number
  basis: SavingsBasis
  /** 落盘替换事件的绝对 seq(投影条目的天然幂等键)。 */
  replacementSeq: number
}): void {
  if (!Number.isFinite(input.tokensRemoved) || input.tokensRemoved <= 0) return
  const row: StatsClaimRow = {
    seq: Math.trunc(input.replacementSeq),
    kind: 'saving',
    component: input.component,
    basis: input.basis,
    tokens: Math.trunc(input.tokensRemoved),
    at: Date.now(),
  }
  withStoreWrite('claim saving', store => {
    store.recordClaims(input.sessionId, [row])
  })
}

/** 主 land(pruner land() recordSaving 同点):已落盘削减的 saving claim。 */
export function claimFromLand(input: {
  sessionId: string
  component: string
  tokensBefore: number
  tokensAfter: number
  basis: SavingsBasis
  replacementSeq: number
}): void {
  claimSaving({
    sessionId: input.sessionId,
    component: input.component,
    tokensRemoved: input.tokensBefore - input.tokensAfter,
    basis: input.basis,
    replacementSeq: input.replacementSeq,
  })
}

/** tail-trim 组回收(同 land 纪律,component 固定 'tail-trim')。 */
export function reclaimFromTailTrim(input: {
  sessionId: string
  tokensBefore: number
  tokensAfter: number
  basis: SavingsBasis
  replacementSeq: number
}): void {
  claimSaving({
    sessionId: input.sessionId,
    component: 'tail-trim',
    tokensRemoved: input.tokensBefore - input.tokensAfter,
    basis: input.basis,
    replacementSeq: input.replacementSeq,
  })
}

/** retrieve 回读抵消的 offset claim;seq = 被召回源事件绝对 seq(定键见头注)。 */
export function claimOffset(input: {
  sessionId: string
  component: 'retrieve' | 'tailtrim-retrieve'
  tokens: number
  basis: SavingsBasis
  sourceSeq: number
}): void {
  if (!Number.isFinite(input.tokens) || input.tokens <= 0) return
  const row: StatsClaimRow = {
    seq: Math.trunc(input.sourceSeq),
    kind: 'offset',
    component: input.component,
    basis: input.basis,
    tokens: Math.trunc(input.tokens),
    at: Date.now(),
  }
  withStoreWrite('claim offset', store => {
    store.recordClaims(input.sessionId, [row])
  })
}

/**
 * 立即扫描事件日志并把水位之后的 usage 逐科目落库;sessions.version 水位
 * 单调前推(source=live,即便本轮零新增也 upsert 会话行——dispose 的
 * "标记 source=live" 出口)。无 store 时空转。
 */
export function flushUsage(session: Session): void {
  withStoreWrite('usage flush', store => {
    const sid = String(session.id)
    const watermark = store.getSessionWatermark(sid)
    const rows: StatsClaimRow[] = []
    let covered = watermark
    for (const event of sessionEvents(session)) {
      const seq = Number(event.seq)
      // 事件日志 append-only 且 seq 单调;水位以内(含已消费旧事件)直接跳过。
      if (!Number.isFinite(seq) || seq <= watermark) continue
      if (seq > covered) covered = seq
      if (event.type !== 'assistant/message') continue
      const usage = event.data.usage
      if (usage === undefined) continue
      const at = Number(event.time) || Date.now()
      for (const { field, component } of USAGE_COMPONENTS) {
        const tokens = usage[field]
        if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0) {
          rows.push({ seq, kind: 'usage', component, basis: '', tokens: Math.trunc(tokens), at })
        }
      }
    }
    if (rows.length > 0) store.recordClaims(sid, rows)
    if (covered > 0) store.setSessionWatermark(sid, covered, { source: 'live' })
  })
}

// 每会话一个 debounce 槽位:窗口内的重复 schedule 合并为一次扫描。
const pendingUsageFlushes = new Map<string, { session: Session; timer: ReturnType<typeof setTimeout> }>()

/** 秒级 debounce 的 usage flush 入口(fresh 边界 recordUsage 同点调度)。 */
export function scheduleUsageFlush(session: Session): void {
  const sid = String(session.id)
  noteStatsSessionActive(sid)
  const existing = pendingUsageFlushes.get(sid)
  if (existing !== undefined) {
    // 刷新引用即可:flush 运行时刻重新扫描全量事件,后来的 usage 自然被覆盖
    existing.session = session
    return
  }
  const timer = setTimeout(() => {
    const entry = pendingUsageFlushes.get(sid)
    if (entry === undefined) return
    pendingUsageFlushes.delete(sid)
    flushUsage(entry.session)
  }, USAGE_FLUSH_DEBOUNCE_MS)
  // 计时器不吊住进程退出(插件热重载/单测环境同等安全)
  timer.unref?.()
  pendingUsageFlushes.set(sid, { session, timer })
}

/**
 * session/disposed 残量出口(T9):取消在途 debounce、立即 flush 全部未落库
 * usage,并 upsert 会话行标记 source=live。老代际不发该事件时本函数只是
 * 不被调用——随写随刷路径不受影响(不依赖 dispose 的可靠性)。
 */
export function flushUsageOnDispose(session: Session): void {
  const sid = String(session.id)
  const entry = pendingUsageFlushes.get(sid)
  if (entry !== undefined) {
    clearTimeout(entry.timer)
    entry.timer.unref?.()
    pendingUsageFlushes.delete(sid)
  }
  flushUsage(session)
  // 零事件/零 usage 会话也要落 source=live 会话行(面板 live/backfill 归属);
  // 水位原值回写——setSessionWatermark 单调不减,同值 upsert 只刷 source。
  withStoreWrite('dispose session row', store => {
    store.setSessionWatermark(sid, store.getSessionWatermark(sid), { source: 'live' })
  })
}

/**
 * 积分器采样落库（spec T15）：fresh 边界的存量净快照 + 该次调用 usage 拆分。
 * 行形 kind='sample'、basis=''、component ∈ {netExact, netEstimated,
 * cachedInput, uncachedInput}（与 StatsStore.sumSamples 的读取面一致），幂等键
 * (session_id, boundarySeq, 'sample', component, '')——同一边界重放零新增，
 * calls（distinct seq 数）不涨。零值行不写（无信息量）；负净额照写（召回后
 * 存量转负正是积分回落的语义）。sample 不前推 sessions 水位——覆盖语义归
 * flushUsage 的 usage 行。
 */
export function recordIntegralSample(input: {
  sessionId: string
  boundarySeq: number
  netExact: number
  netEstimated: number
  cachedInput: number
  uncachedInput: number
}): void {
  if (!Number.isFinite(input.boundarySeq) || input.boundarySeq < 0) return
  const candidates: readonly [component: 'netExact' | 'netEstimated' | 'cachedInput' | 'uncachedInput', tokens: number][] = [
    ['netExact', input.netExact],
    ['netEstimated', input.netEstimated],
    ['cachedInput', input.cachedInput],
    ['uncachedInput', input.uncachedInput],
  ]
  const rows: StatsClaimRow[] = []
  for (const [component, tokens] of candidates) {
    if (!Number.isFinite(tokens) || tokens === 0) continue
    rows.push({ seq: Math.trunc(input.boundarySeq), kind: 'sample', component, basis: '', tokens: Math.trunc(tokens), at: Date.now() })
  }
  if (rows.length === 0) return
  withStoreWrite('integral sample', store => {
    store.recordClaims(input.sessionId, rows)
  })
}

/**
 * /ccip `flush` 的抓手（spec T31）：立即冲刷全部在途 usage debounce（等价于
 * 对每个挂起会话跑一次 dispose 出口,但不 upsert source——活跃会话的归属不变）。
 */
export function flushPendingUsageNow(): void {
  const entries = [...pendingUsageFlushes.values()]
  pendingUsageFlushes.clear()
  for (const entry of entries) {
    clearTimeout(entry.timer)
    entry.timer.unref?.()
  }
  for (const entry of entries) flushUsage(entry.session)
}

/** 测试/卸载清理:丢弃全部在途 debounce(已落库数据不回滚)。 */
export function cancelPendingUsageFlushes(): void {
  for (const entry of pendingUsageFlushes.values()) {
    clearTimeout(entry.timer)
    entry.timer.unref?.()
  }
  pendingUsageFlushes.clear()
}
