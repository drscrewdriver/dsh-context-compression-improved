/**
 * 旧会话回填主体（spec 持久层主干 T18/T20）——双后端共用同一 claims 提取核心。
 *
 * **后端 A**（优先）：宿主 `sessionQuery` 服务的 listSessions/readSession +
 * version 水位 diff（结构照 SI sync.ts:106-153）。服务面零格式风险；服务缺席
 * 返回 `available:false` 标记，不抛。
 *
 * **后端 B**（fallback，满足"按磁盘行为记录统计旧会话"的显式需求）：
 * `<dshHome>/sessions/**` 目录发现（判据 = 目录里有规范代次产物或迁移暂存，
 * 不要求任何具体文件名，照 SS scan.ts:62-102）→ T19 叶子模块解码 → 同一提取
 * 核心。**绝不写会话文件**（SS 红线先例）。
 *
 * fail-soft 接线（T19 留的裁决位）：header 代次未知/缺失/非会话头 → 跳过该
 * 会话 + 整进程恰一条聚合 warn（门闩在模块级，测试 resetModules 隔离）。
 *
 * 计数口径（裁决 7）：零 tokenizer——savings/offsets 由 projectSavingsCore
 * 注入"拒绝精确计数"的假计数器得到 chars/4 口径行；usage 从
 * `assistant/message.data.usage` 的固定科目白名单逐事件求和。所有行以
 * (sessionId, 绝对 seq, kind, component, basis) 主键 INSERT OR IGNORE 幂等。
 *
 * live 护栏：会话行 `source='live'` 即整段跳过——live 路径的组件名
 * (fresh/history/…)与投影行 ('projection') 主键不同，若两边都写会双计。
 *
 * @module dsh-context-compression-improved/runtime/stats-backfill
 */
import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { unavailableTokenCount } from './token-count.ts'
import { projectSavingsCore, type SavingsTextCounter } from './savings-projection.ts'
import {
  classifySessionHeader,
  decodeSessionLogBytes,
  loadOfficialDecoders,
  readSessionGenerations,
  type GenerationArtifact,
  type OfficialDecoders,
} from './session-file-decode.ts'
import { resolveStatsDshHome, type StatsDbPathOptions } from './stats-schema.ts'
import { getStatsStore, type StatsClaimRow, type StatsStore } from './stats-db.ts'
import { isStatsLivePathBusy } from './stats-sync.ts'

/** 一次回填可消费的日志事件记录（两个后端的共同形状：宿主裸事件/解码事件的结构子集）。 */
export interface BackfillEventRecord {
  seq: number
  type: string
  time?: number
  surfaceOp?: unknown
  data?: Record<string, unknown>
}

/** 回填计数口径的注入计数器：恒拒绝精确计数 → 投影全部落 chars/4 分列。 */
const BACKFILL_COUNTER: SavingsTextCounter = () =>
  unavailableTokenCount('stats backfill counts without tokenizer by design')

/** usage 落库科目白名单：字段名(磁盘) → claim component(固定模板，无自由文本)。 */
const USAGE_FIELDS: readonly (readonly [field: string, component: string])[] = [
  ['inputTokens', 'input'],
  ['outputTokens', 'output'],
  ['cacheReadTokens', 'cacheRead'],
  ['cacheWriteTokens', 'cacheWrite'],
]

/** 语料枚举上限——SS 实测教训：这是防无界遍历的边界而非策略，取宽量级。 */
const DISCOVERY_LIMIT = 100_000

/**
 * 从事件流重建当前 surface 节点集合：顺序走 append/replace 语义
 * （replace 事件把 [start,end] 移出 surface、自身入 surface）。
 * 两后端共用——同 feed 必同 surface，这是"双后端结果一致"的前提。
 */
export function replaySurfaceNodes(events: readonly BackfillEventRecord[]): number[] {
  const surface = new Set<number>()
  for (const event of events) {
    const op = event.surfaceOp as { op?: unknown; startSeq?: unknown; endSeq?: unknown } | null | undefined
    if (op !== null && typeof op === 'object' && op.op === 'replace') {
      const start = Number(op.startSeq)
      const end = Number(op.endSeq)
      if (Number.isFinite(start) && Number.isFinite(end)) {
        for (let seq = start; seq <= end; seq += 1) surface.delete(seq)
      }
    }
    surface.add(Number(event.seq))
  }
  return [...surface]
}

/** claims 提取核心的输出。 */
export interface BackfillClaimsExtraction {
  rows: StatsClaimRow[]
  /** 事件流里最大的绝对 seq（后端 B 用它记覆盖水位）。 */
  maxSeq: number
}

/**
 * 同一 claims 提取核心（后端 A/B 共用，T23 的一致性对象）：
 * 投影 savings/offsets + `assistant/message` 的 usage 固定科目求和。
 * 纯函数：不落库、不告警、不抛事件形状问题（坏行走投影内部 fail-open）。
 */
export function extractBackfillClaims(events: readonly BackfillEventRecord[]): BackfillClaimsExtraction {
  if (events.length === 0) return { rows: [], maxSeq: 0 }
  let maxSeq = 0
  for (const event of events) maxSeq = Math.max(maxSeq, Number(event.seq))
  const projection = projectSavingsCore({
    events: events as unknown as SessionEvent[],
    surfaceNodes: replaySurfaceNodes(events),
    counter: BACKFILL_COUNTER,
  })
  const rows: StatsClaimRow[] = []
  for (const saving of projection.savings) {
    rows.push({ seq: saving.replacementSeq, kind: 'saving', component: 'projection', basis: saving.basis, tokens: saving.tokens, at: saving.at })
  }
  for (const offset of projection.offsets) {
    rows.push({ seq: offset.seq, kind: 'offset', component: offset.component, basis: offset.basis, tokens: offset.tokens, at: offset.at })
  }
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const usage = event.data?.['usage'] as Record<string, unknown> | undefined
    if (usage === undefined || typeof usage !== 'object') continue
    for (const [field, component] of USAGE_FIELDS) {
      const value = usage[field]
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
      rows.push({ seq: Number(event.seq), kind: 'usage', component, basis: '', tokens: Math.round(value), at: Number(event.time) || 0 })
    }
  }
  return { rows, maxSeq }
}

/** 一轮回填的汇总（面板/日志消费；失败按会话隔离，绝不停整轮）。 */
export interface StatsBackfillPassResult {
  backend: 'sessionQuery' | 'files'
  /** 后端能力在场（服务缺席/列举失败 = false，本轮无事发生）。 */
  available: boolean
  /** 本轮实际提取的会话数。 */
  sessions: number
  /** 本轮跳过数：水位未变、live 护栏、fail-soft 代次、仅暂存。 */
  skipped: number
  /** recordClaims 实际新增行数和（重放 = 0，幂等对账锚点）。 */
  claimsAdded: number
  /** 仅后端 B：本轮发现的总会话目录数（切片前的全集，调度器游标推进依据）。 */
  totalDiscovered?: number
  failures: { sessionId: string; error: string }[]
}

function newPassResult(backend: StatsBackfillPassResult['backend'], available: boolean): StatsBackfillPassResult {
  return { backend, available, sessions: 0, skipped: 0, claimsAdded: 0, failures: [] }
}

/** live 护栏：会话行已被 live 路径认领 → 回填整段跳过（防双计）。 */
function isLiveOwned(store: StatsStore, sessionId: string): boolean {
  return store.getSessionRecord(sessionId)?.source === 'live'
}

// ─────────────────────────── 后端 A：sessionQuery 服务面 ───────────────────────────

/** 宿主 sessionQuery 的结构镜像（与 SI sync.ts 的 face 同形；只读）。 */
export interface BackfillSessionQueryFace {
  listSessions(): Promise<readonly { header: { id: string; version: number; cwd?: string } }[]>
  readSession(sessionId: string): Promise<{
    session: { version: number; cwd?: string }
    events: readonly BackfillEventRecord[]
  }>
}

/**
 * 后端 A 一轮：listSessions → 与 sessions.version 水位 diff → 新/变更会话
 * readSession → 提取核心落库 → 写回 version 水位。
 * 服务缺席（老线宿主无该可选服务）→ available:false，调用方应退后端 B。
 */
export async function backfillViaSessionQuery(
  store: StatsStore,
  sessionQuery: BackfillSessionQueryFace | undefined,
  options: { maxSessions?: number } = {},
): Promise<StatsBackfillPassResult> {
  const result = newPassResult('sessionQuery', sessionQuery !== undefined)
  if (sessionQuery === undefined) return result
  let records: readonly { header: { id: string; version: number; cwd?: string } }[]
  try {
    records = await sessionQuery.listSessions()
  } catch (error) {
    result.available = false
    result.failures.push({ sessionId: '*', error: String((error as Error)?.message ?? error) })
    return result
  }
  const limit = options.maxSessions ?? records.length
  for (const record of records.slice(0, Math.max(0, limit))) {
    const sessionId = String(record.header.id)
    if (isLiveOwned(store, sessionId)) { result.skipped += 1; continue }
    const existing = store.getSessionRecord(sessionId)
    if (existing !== undefined && existing.version === record.header.version) { result.skipped += 1; continue }
    try {
      const log = await sessionQuery.readSession(sessionId)
      const { rows } = extractBackfillClaims(log.events)
      result.claimsAdded += store.recordClaims(sessionId, rows)
      const version = Number.isFinite(log.session.version) ? log.session.version : record.header.version
      store.setSessionWatermark(sessionId, version, {
        project: log.session.cwd ?? record.header.cwd ?? '',
        source: 'backfill',
      })
      result.sessions += 1
    } catch (error) {
      result.failures.push({ sessionId, error: String((error as Error)?.message ?? error) })
    }
  }
  return result
}

// ─────────────────────────── 后端 B：目录发现 + 文件解码 ───────────────────────────

/** 一个被发现的会话目录及其当前代产物。 */
export interface DiscoveredSessionLog {
  /** 目录名（header 无 id 时的兜底会话 id）。 */
  dirSessionId: string
  dir: string
  artifact: GenerationArtifact
}

/**
 * `<dshHome>/sessions/**` 递归发现：判据 = 目录内有规范代次产物或迁移暂存
 * （不要求具体文件名，照 SS scan 的栈遍历）。仅暂存（迁移进行中）的目录
 * 不构成可解码产物，跳过。
 */
export function discoverBackfillSessionLogs(dshHome: string, limit = DISCOVERY_LIMIT): DiscoveredSessionLog[] {
  const root = join(dshHome, 'sessions')
  const out: DiscoveredSessionLog[] = []
  if (!existsSync(root)) return out
  const stack: string[] = [root]
  while (stack.length > 0 && out.length < limit) {
    const dir = stack.pop()
    if (dir === undefined) continue
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const path = join(dir, entry.name)
      const generations = readSessionGenerations(path)
      if (generations.canonical.length === 0 && generations.staging.length === 0) {
        stack.push(path)
        continue
      }
      const current = generations.current
      if (current === undefined) continue
      if (out.length >= limit) break
      out.push({ dirSessionId: entry.name, dir: path, artifact: current })
    }
  }
  return out
}

/** 后端 B 一轮的选项；路径解析复用统计层同一 dshHome 优先级链。 */
export interface StatsBackfillFilesOptions extends StatsDbPathOptions {
  maxSessions?: number
  /** 官方解码器；缺省现场软加载（不可用走本地等价实现，decoder 字段如实标注）。 */
  decoders?: OfficialDecoders | undefined
  /** 降级告警出口（缺省 console.warn，进程级恰一次）。 */
  warn?: (message: string) => void
  /**
   * 处理窗口（调度器 T21 分块用）：offset/limit 切片已发现的会话列表。
   * 缺省 = 全量发现全量处理（T18-T20 语义原样保留）。`totalDiscovered` 回填
   * 发现总数，供调度器推进游标。
   */
  slice?: { offset: number; limit: number }
}

// 整进程一次的 fail-soft 门闩（T19 留给本模块的裁决位）：resetModules 可测。
let unknownGenerationWarned = false

function emitFailSoftWarnOnce(sink: (message: string) => void, skipped: readonly { sessionId: string; state: string }[]): void {
  if (unknownGenerationWarned || skipped.length === 0) return
  unknownGenerationWarned = true
  const sample = skipped.slice(0, 3).map(entry => `${entry.sessionId}(${entry.state})`).join(', ')
  sink(`${skipped.length} session log(s) skipped: header generation unknown (${sample}${skipped.length > 3 ? ', …' : ''})`)
}

/**
 * 后端 B 一轮：目录发现 → 当前代产物只读解码 → fail-soft 代次裁决 →
 * 提取核心落库（source=backfill，水位 = 观测 maxSeq）。
 * 绝不写会话文件；单会话失败隔离进 failures。
 */
export async function backfillViaSessionFiles(
  store: StatsStore,
  options: StatsBackfillFilesOptions = {},
): Promise<StatsBackfillPassResult> {
  const result = newPassResult('files', true)
  const dshHome = options.dshHome ?? resolveStatsDshHome(options)
  const decoders = options.decoders !== undefined ? options.decoders : await loadOfficialDecoders()
  const sink = options.warn ?? ((message: string) => { console.warn('context-compression stats backfill: %s', message) })
  const softSkipped: { sessionId: string; state: string }[] = []
  const limit = options.maxSessions ?? DISCOVERY_LIMIT
  const discovered = discoverBackfillSessionLogs(dshHome, limit)
  result.totalDiscovered = discovered.length
  const offset = Math.max(0, options.slice?.offset ?? 0)
  const windowLimit = Math.max(0, options.slice?.limit ?? discovered.length)
  const windowed = discovered.slice(offset, offset + windowLimit)
  for (const found of windowed) {
    if (isLiveOwned(store, found.dirSessionId)) { result.skipped += 1; continue }
    let log
    try {
      // 只读纪律：readFileSync 是唯一触碰会话文件的调用，永远没有写对偶。
      log = decodeSessionLogBytes(readFileSync(found.artifact.path), decoders)
    } catch (error) {
      result.failures.push({ sessionId: found.dirSessionId, error: String((error as Error)?.message ?? error) })
      continue
    }
    const verdict = classifySessionHeader(log.header)
    if (verdict.state !== 'known') {
      softSkipped.push({ sessionId: found.dirSessionId, state: verdict.state })
      result.skipped += 1
      continue
    }
    const headerId = log.header?.['id']
    const sessionId = typeof headerId === 'string' && headerId.trim() !== '' ? headerId.trim() : found.dirSessionId
    if (isLiveOwned(store, sessionId)) { result.skipped += 1; continue }
    const { rows, maxSeq } = extractBackfillClaims(log.events)
    // 水位跳过（与后端 A 同形）：本轮覆盖已到 maxSeq 的 backfill 会话不再重复
    // 入账/计数——decode 不可省（maxSeq 在事件里），账面工作全跳。
    const existingRecord = store.getSessionRecord(sessionId)
    if (existingRecord !== undefined && existingRecord.source === 'backfill' && existingRecord.version >= maxSeq) {
      result.skipped += 1
      continue
    }
    try {
      result.claimsAdded += store.recordClaims(sessionId, rows)
      const headerCwd = log.header?.['cwd']
      store.setSessionWatermark(sessionId, maxSeq, {
        project: typeof headerCwd === 'string' ? headerCwd : '',
        source: 'backfill',
      })
      result.sessions += 1
    } catch (error) {
      result.failures.push({ sessionId, error: String((error as Error)?.message ?? error) })
    }
  }
  emitFailSoftWarnOnce(sink, softSkipped)
  return result
}

// ─────────────────────────── 回填调度器（spec T21）───────────────────────────

/**
 * 回填调度器：把双后端包成分块、可暂停、有触发源的进程级单例。
 *
 * 触发源（spec T21）：
 *  - `/savings|/monitor` 路由首次命中（`kickStatsBackfillOnRouteHit`，一次性
 *    闸——面板轮询每 2-5s 打一次路由，闸保证只播一轮）；
 *  - dispose 后低频（`kickStatsBackfillOnDispose`，10 分钟节流——老代际不发
 *    session/disposed 时该源静默闲置，与 T9 同一宽容语义）。
 *
 * 分块：后端 A 本就是逐会话 await（服务面 IO 天然让出）；后端 B 的 decode 是
 * 同步 CPU（实测 ~84ms/会话），按 chunk 切片、chunk 间 setImmediate 让出事件
 * 循环，一轮 pass 至多完整扫一遍发现列表（游标跨 pass 记忆，wrap 后归零——
 * 水位让重扫幂等零新增）。
 *
 * 暂停面（/ccip T31 的预留挂点）：`pauseStatsBackfill` 后所有 kick 与直接
 * `runStatsBackfillPass` 都空转；status 面板/命令读 `getStatsBackfillStatus`。
 * 调度器绝不抛错到触发源——所有失败进 pass.failures / lastSummary。
 */

const DISPOSE_KICK_MIN_INTERVAL_MS = 10 * 60_000
/** 每 chunk 处理的会话数（10-50 区间中点；25×84ms ≈ 2.1s CPU/chunk，间隙让出）。 */
const FILES_CHUNK_SIZE = 25
/** 后端 A 单轮服务的会话上限（listSessions 全量但 readSession 逐个 await；防御性封顶）。 */
const SESSION_QUERY_PASS_CAP = 500

export interface StatsBackfillSchedulerStatus {
  running: boolean
  paused: boolean
  runs: number
  lastRunAt: number
  lastSummary?: {
    backend: 'sessionQuery' | 'files'
    sessions: number
    skipped: number
    claimsAdded: number
    failures: number
  }
}

interface BackfillSchedulerState {
  sessionQuery: (() => BackfillSessionQueryFace | undefined) | undefined
  routeKickArmed: boolean
  lastDisposeKickAt: number
  running: boolean
  paused: boolean
  filesCursor: number
  runs: number
  lastRunAt: number
  lastSummary: StatsBackfillSchedulerStatus['lastSummary']
}

const schedulerState: BackfillSchedulerState = {
  sessionQuery: undefined,
  routeKickArmed: false,
  lastDisposeKickAt: 0,
  running: false,
  paused: false,
  filesCursor: 0,
  runs: 0,
  lastRunAt: 0,
  lastSummary: undefined,
}

/** 注入触发源依赖（index.ts apply 时调用一次）：sessionQuery 服务的惰性解析器。 */
export function configureStatsBackfillTrigger(input: { sessionQuery?: () => BackfillSessionQueryFace | undefined } = {}): void {
  schedulerState.sessionQuery = input.sessionQuery
}

/** 路由首次命中触发（一次性闸；面板轮询重复命中零开销）。 */
export function kickStatsBackfillOnRouteHit(): void {
  if (schedulerState.routeKickArmed) return
  schedulerState.routeKickArmed = true
  void runStatsBackfillPass().catch(() => undefined)
}

/** dispose 后低频触发（10 分钟节流）；paused/running 时不消耗节流窗口。 */
export function kickStatsBackfillOnDispose(): void {
  if (schedulerState.paused || schedulerState.running) return
  const now = Date.now()
  if (now - schedulerState.lastDisposeKickAt < DISPOSE_KICK_MIN_INTERVAL_MS) return
  schedulerState.lastDisposeKickAt = now
  void runStatsBackfillPass().catch(() => undefined)
}

/** /ccip T31 预留：暂停后所有 kick 与直接 pass 空转（在途 chunk 完成本轮即止）。 */
export function pauseStatsBackfill(): void {
  schedulerState.paused = true
}

export function resumeStatsBackfill(): void {
  schedulerState.paused = false
}

export function getStatsBackfillStatus(): StatsBackfillSchedulerStatus {
  return {
    running: schedulerState.running,
    paused: schedulerState.paused,
    runs: schedulerState.runs,
    lastRunAt: schedulerState.lastRunAt,
    ...(schedulerState.lastSummary === undefined ? {} : { lastSummary: schedulerState.lastSummary }),
  }
}

/** chunk 间让出事件循环（setImmediate 不吊进程退出）。 */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => {
    const handle = setImmediate(() => resolve())
    handle.unref?.()
  })
}

function mergeFileChunk(merged: StatsBackfillPassResult, chunk: StatsBackfillPassResult): void {
  merged.sessions += chunk.sessions
  merged.skipped += chunk.skipped
  merged.claimsAdded += chunk.claimsAdded
  for (const failure of chunk.failures) {
    if (merged.failures.length >= 50) break
    merged.failures.push(failure)
  }
}

/** 前台活跃压缩期间回填让路(轮询 busy 旗标);上限防旗标异常悬挂饿死回填。 */
const LIVE_PATH_POLL_MS = 800
const LIVE_PATH_MAX_WAIT_MS = 120_000
async function yieldToLivePath(): Promise<void> {
  const start = Date.now()
  while (isStatsLivePathBusy() && Date.now() - start < LIVE_PATH_MAX_WAIT_MS) {
    await new Promise(resolve => setTimeout(resolve, LIVE_PATH_POLL_MS))
  }
}

/**
 * 跑一轮回填（后端 A 优先，缺席降级后端 B 分块全扫）。running/paused/无 store
 * 时返回 undefined（触发源丢弃即可）；异常一律吞进返回值语义,绝不上抛到触发源。
 * 前台优先纪律:pass 开始与后端 B 每个 chunk 前都先让路活跃压缩窗口。
 */
export async function runStatsBackfillPass(
  options: {
    store?: StatsStore
    sessionQuery?: BackfillSessionQueryFace | undefined
    maxSessionsPerBackend?: number
    dshHome?: string
    warn?: (message: string) => void
  } = {},
): Promise<StatsBackfillPassResult | undefined> {
  const store = options.store ?? getStatsStore()
  if (store === null || schedulerState.running || schedulerState.paused) return undefined
  schedulerState.running = true
  try {
    await yieldToLivePath()
    const sessionQuery = options.sessionQuery ?? schedulerState.sessionQuery?.()
    const passA = await backfillViaSessionQuery(store, sessionQuery, {
      maxSessions: Math.min(options.maxSessionsPerBackend ?? SESSION_QUERY_PASS_CAP, SESSION_QUERY_PASS_CAP),
    })
    if (passA.available) {
      schedulerState.runs += 1
      schedulerState.lastRunAt = Date.now()
      schedulerState.lastSummary = {
        backend: passA.backend,
        sessions: passA.sessions,
        skipped: passA.skipped,
        claimsAdded: passA.claimsAdded,
        failures: passA.failures.length,
      }
      return passA
    }
    const merged = newPassResult('files', true)
    const chunkLimit = Math.max(1, options.maxSessionsPerBackend ?? FILES_CHUNK_SIZE)
    let sweepOffset = schedulerState.filesCursor
    for (;;) {
      await yieldToLivePath()
      const chunk = await backfillViaSessionFiles(store, {
        ...(options.dshHome === undefined ? {} : { dshHome: options.dshHome }),
        ...(options.warn === undefined ? {} : { warn: options.warn }),
        slice: { offset: sweepOffset, limit: chunkLimit },
      })
      const total = chunk.totalDiscovered ?? 0
      mergeFileChunk(merged, chunk)
      if (total === 0) { sweepOffset = 0; break }
      sweepOffset += chunkLimit
      if (sweepOffset >= total) { sweepOffset = 0; break }
      await yieldToEventLoop()
    }
    schedulerState.filesCursor = sweepOffset
    schedulerState.runs += 1
    schedulerState.lastRunAt = Date.now()
    schedulerState.lastSummary = {
      backend: merged.backend,
      sessions: merged.sessions,
      skipped: merged.skipped,
      claimsAdded: merged.claimsAdded,
      failures: merged.failures.length,
    }
    return merged
  } finally {
    schedulerState.running = false
  }
}
