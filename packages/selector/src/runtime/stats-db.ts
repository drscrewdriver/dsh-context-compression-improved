/**
 * CCI per-session 统计持久层的 SQLite 句柄与读写缝(spec 持久层主干 T1/T3/T5)。
 *
 * 双驱动缝:better-sqlite3(optional 优先,同步语句分派更快)→ `node:sqlite`
 * DatabaseSync 兜底(engines 钉 ^22.19 || >=24,native 内置恒可用)→ null
 * (两代驱动都拿不到 = 可见降级:warn 恰一次 + persisted:false,禁静默吞,
 * BC dsh-compaction-guard / digest-drift 教训)。
 *
 * open 纪律(照 SI schema.ts + BC driver.ts):
 *  - `journal_mode=wal, synchronous=NORMAL, busy_timeout=5000, temp_store=MEMORY`;
 *  - `PRAGMA application_id/user_version` 校验:他人库拒开(官方派生库
 *    0x44534851、switch-search 库 0x53574954 一律拒绝),自家库版本不符
 *    drop 重建;
 *  - 写事务一律 `BEGIN IMMEDIATE`(多实例共享库文件时防 SQLITE_BUSY_SNAPSHOT),
 *    claims 行 INSERT OR IGNORE 幂等,嵌套调用并入外层事务。
 *
 * "recover" 语义:WAL 半事务/残留 -wal 由 SQLite 在 open 时自动恢复,
 * 本插件无影子文件重建流,故 open 即 recover。
 *
 * @module dsh-context-compression-improved/runtime/stats-db
 */
import type { DatabaseSync } from 'node:sqlite'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  CCI_STATS_APPLICATION_ID,
  OFFICIAL_SESSION_QUERY_APPLICATION_ID,
  STATS_CLAIM_KINDS,
  STATS_SCHEMA_VERSION,
  SWITCH_SEARCH_APPLICATION_ID,
  ensureStatsSchema,
  resetStatsSchema,
  resolveStatsDbPath,
  type StatsClaimKind,
} from './stats-schema.ts'

/** 服务当前句柄的 SQLite 驱动;null = 无可用驱动(降级态)。 */
export type StatsSqliteDriver = 'better-sqlite3' | 'node:sqlite'

/** open 成功后的句柄包。 */
export interface StatsOpenResult {
  db: DatabaseSync
  driver: StatsSqliteDriver
}

/**
 * 驱动探测顺序打开裸句柄。非字面量 specifier 让 optional 原生依赖缺席时
 * typecheck/build 全绿(tsdown neverBundle 也不会把它打进产物);
 * `node:sqlite` 带前缀,verify-release 依赖闸对其零成本跳过。
 */
async function openRawHandle(actual: string): Promise<StatsOpenResult | null> {
  try {
    const spec = 'better-sqlite3'
    const mod = (await import(spec)) as unknown as { default?: new (p: string) => DatabaseSync }
    const Ctor = mod.default ?? (mod as unknown as new (p: string) => DatabaseSync)
    return { db: new Ctor(actual), driver: 'better-sqlite3' }
  } catch {
    try {
      const { DatabaseSync: NodeDatabaseSync } = await import('node:sqlite')
      return { db: new NodeDatabaseSync(actual), driver: 'node:sqlite' }
    } catch {
      // 双驱动皆不可用:可见降级由调用方落 state + warn,绝不静默。
      return null
    }
  }
}

/**
 * 打开(必要时创建并初始化)统计库文件。缺目录建目录;他人库抛错拒开;
 * 自家库版本不符先 drop 重建。返回 null 表示无可用驱动(降级,非错误)。
 */
export async function openStatsDatabase(path: string): Promise<StatsOpenResult | null> {
  const actual = resolve(path)
  await mkdir(dirname(actual), { recursive: true })
  const opened = await openRawHandle(actual)
  if (opened === null) return null
  const { db } = opened
  try {
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (applicationId === OFFICIAL_SESSION_QUERY_APPLICATION_ID) {
      throw new Error(`stats-db: "${actual}" is the official session-query index, refusing to open it`)
    }
    if (applicationId === SWITCH_SEARCH_APPLICATION_ID) {
      throw new Error(`stats-db: "${actual}" belongs to switch-search, refusing to open it`)
    }
    if (applicationId !== 0 && applicationId !== CCI_STATS_APPLICATION_ID) {
      throw new Error(`stats-db: database at "${actual}" belongs to another application (id 0x${applicationId.toString(16)})`)
    }
    if (applicationId === CCI_STATS_APPLICATION_ID && version !== STATS_SCHEMA_VERSION) {
      resetStatsSchema(db)
    }
    db.exec(`PRAGMA journal_mode = wal`)
    ensureStatsSchema(db)
    // NORMAL 在 WAL 下崩溃安全(fsync 移到 checkpoint);busy_timeout 供多连接/多实例
    // 写竞争时让 SQLite 内部退避重试,而不是立刻 SQLITE_BUSY。
    db.exec(`PRAGMA synchronous = NORMAL`)
    db.exec(`PRAGMA busy_timeout = 5000`)
    db.exec(`PRAGMA temp_store = MEMORY`)
    return opened
  } catch (error) {
    db.close()
    throw error
  }
}

/** 一条待落库的 claim 流水行(seq 必须是宿主日志绝对 seq)。 */
export interface StatsClaimRow {
  seq: number
  kind: StatsClaimKind
  /** 保存组件/抵消原因/usage 科目/sample 组件名;进主键,必须是封闭枚举值。 */
  component: string
  /** 'exact-tokenizer' | 'characters';无 basis 语义的行(usage/sample)用 ''。 */
  basis: string
  tokens: number
  at: number
}

/** 双 basis 分列合计(与 SavingsLedger.snapshot 的口径对齐,永不合并)。 */
export interface StatsBasisTotals {
  exact: number
  estimated: number
}

/** 单会话聚合行(存量 claims 口径;积分 sample 走 sumSamples)。 */
export interface StatsSessionAggregate {
  sessionId: string
  gross: StatsBasisTotals
  offsets: StatsBasisTotals
  net: StatsBasisTotals
}

/** 按 call 积分的累计视图:N = 已采样边界数(calls)。 */
export interface StatsSampleTotals {
  netExact: number
  netEstimated: number
  cachedInput: number
  uncachedInput: number
  calls: number
}

/**
 * 一个打开的统计库句柄的读写面。写路径同步小事务(随写随刷,BEGIN
 * IMMEDIATE),读路径无锁(WAL 允许读并发)。句柄关闭后调用即抛——生命周期
 * 由 ensureStatsStore/closeStatsStore 统一管,调用方不持有裸 db。
 */
export class StatsStore {
  private db: DatabaseSync | undefined
  private inWriteTx = false

  constructor(
    db: DatabaseSync,
    readonly driver: StatsSqliteDriver,
  ) {
    this.db = db
  }

  get isOpen(): boolean {
    return this.db !== undefined
  }

  close(): void {
    this.db?.close()
    this.db = undefined
  }

  private requireDb(): DatabaseSync {
    if (this.db === undefined) throw new Error('stats-db: handle closed')
    return this.db
  }

  /**
   * 外层已开写事务时直接并入(嵌套 join),否则自开一个 BEGIN IMMEDIATE
   * 小事务并提交;异常一律 ROLLBACK 后原样上抛。
   */
  withWriteTx<T>(fn: () => T): T {
    const db = this.requireDb()
    if (this.inWriteTx) return fn()
    db.exec('BEGIN IMMEDIATE')
    this.inWriteTx = true
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* 坏事务的回滚尽力而为 */ }
      throw error
    } finally {
      this.inWriteTx = false
    }
  }

  /**
   * claims 批量幂等落库:BEGIN IMMEDIATE + INSERT OR IGNORE,返回**实际新增**
   * 行数(重放 = 0)。非有限数/未知 kind 的行拒收(抛错=编程错误,静默跳行
   * =对账黑洞,取前者)。
   */
  recordClaims(sessionId: string, rows: readonly StatsClaimRow[]): number {
    if (rows.length === 0) return 0
    const db = this.requireDb()
    const sid = String(sessionId)
    for (const row of rows) {
      if (!STATS_CLAIM_KINDS.includes(row.kind)) {
        throw new Error(`stats-db: unsupported claim kind "${String(row.kind)}"`)
      }
      if (!Number.isFinite(row.seq) || !Number.isFinite(row.tokens) || !Number.isFinite(row.at)) {
        throw new Error(`stats-db: claim row for session "${sid}" carries non-finite seq/tokens/at`)
      }
    }
    const insert = db.prepare(
      `INSERT OR IGNORE INTO claims (session_id, seq, kind, component, basis, tokens, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    return this.withWriteTx(() => {
      let added = 0
      for (const row of rows) {
        const result = insert.run(sid, Math.trunc(row.seq), row.kind, row.component, row.basis, Math.trunc(row.tokens), Math.trunc(row.at))
        added += Number(result.changes)
      }
      return added
    })
  }

  /**
   * 按会话聚合 saving/offset 双 basis 合计,净额精确口径降序(内存账本
   * snapshot.perSession 的持久层对应物;分页在 T24 路由层做)。
   */
  perSessionAggregates(): StatsSessionAggregate[] {
    const db = this.requireDb()
    const rows = db.prepare(`
      SELECT session_id AS sessionId, kind, basis, SUM(tokens) AS tokens
      FROM claims WHERE kind IN ('saving', 'offset')
      GROUP BY session_id, kind, basis
    `).all() as { sessionId: string; kind: string; basis: string; tokens: number | bigint }[]
    const bySession = new Map<string, StatsSessionAggregate>()
    for (const row of rows) {
      let agg = bySession.get(row.sessionId)
      if (agg === undefined) {
        agg = {
          sessionId: row.sessionId,
          gross: { exact: 0, estimated: 0 },
          offsets: { exact: 0, estimated: 0 },
          net: { exact: 0, estimated: 0 },
        }
        bySession.set(row.sessionId, agg)
      }
      const column = row.basis === 'exact-tokenizer' ? 'exact' : 'estimated'
      const bucket = row.kind === 'saving' ? agg.gross : agg.offsets
      bucket[column] += Number(row.tokens)
    }
    const list = [...bySession.values()]
    for (const agg of list) {
      agg.net.exact = agg.gross.exact - agg.offsets.exact
      agg.net.estimated = agg.gross.estimated - agg.offsets.estimated
    }
    return list.sort((a, b) => (b.net.exact - a.net.exact) || (b.net.estimated - a.net.estimated))
  }

  /** 全会话聚合(不带 perSession 列表的 total)。 */
  total(): { gross: StatsBasisTotals; offsets: StatsBasisTotals; net: StatsBasisTotals } {
    const db = this.requireDb()
    const rows = db.prepare(`
      SELECT kind, basis, SUM(tokens) AS tokens
      FROM claims WHERE kind IN ('saving', 'offset')
      GROUP BY kind, basis
    `).all() as { kind: string; basis: string; tokens: number | bigint }[]
    const gross: StatsBasisTotals = { exact: 0, estimated: 0 }
    const offsets: StatsBasisTotals = { exact: 0, estimated: 0 }
    for (const row of rows) {
      const column = row.basis === 'exact-tokenizer' ? 'exact' : 'estimated'
      const bucket = row.kind === 'saving' ? gross : offsets
      bucket[column] += Number(row.tokens)
    }
    return {
      gross,
      offsets,
      net: { exact: gross.exact - offsets.exact, estimated: gross.estimated - offsets.estimated },
    }
  }

  /**
   * 累计积分查询:Σ samples(按 call 边界采样的存量净快照)。calls = 已覆盖的
   *  distinct 边界 seq 数——面板"累计(按 N 次 call)"的 N。
   */
  sumSamples(sessionId: string): StatsSampleTotals {
    const db = this.requireDb()
    const sid = String(sessionId)
    const sums = db.prepare(
      `SELECT component, SUM(tokens) AS tokens FROM claims WHERE session_id = ? AND kind = 'sample' GROUP BY component`,
    ).all(sid) as { component: string; tokens: number | bigint }[]
    const { calls } = db.prepare(
      `SELECT COUNT(DISTINCT seq) AS calls FROM claims WHERE session_id = ? AND kind = 'sample'`,
    ).get(sid) as { calls: number | bigint }
    const totals: StatsSampleTotals = { netExact: 0, netEstimated: 0, cachedInput: 0, uncachedInput: 0, calls: Number(calls) }
    for (const row of sums) {
      if (row.component === 'netExact') totals.netExact += Number(row.tokens)
      else if (row.component === 'netEstimated') totals.netEstimated += Number(row.tokens)
      else if (row.component === 'cachedInput') totals.cachedInput += Number(row.tokens)
      else if (row.component === 'uncachedInput') totals.uncachedInput += Number(row.tokens)
    }
    return totals
  }

  /** 全会话积分累计（面板"累计"总行的数据源）；calls = distinct (session, seq)。 */
  sumSamplesAll(): StatsSampleTotals {
    const db = this.requireDb()
    const sums = db.prepare(
      `SELECT component, SUM(tokens) AS tokens FROM claims WHERE kind = 'sample' GROUP BY component`,
    ).all() as { component: string; tokens: number | bigint }[]
    const { calls } = db.prepare(
      `SELECT COUNT(DISTINCT session_id || ':' || seq) AS calls FROM claims WHERE kind = 'sample'`,
    ).get() as { calls: number | bigint }
    const totals: StatsSampleTotals = { netExact: 0, netEstimated: 0, cachedInput: 0, uncachedInput: 0, calls: Number(calls) }
    for (const row of sums) {
      if (row.component === 'netExact') totals.netExact += Number(row.tokens)
      else if (row.component === 'netEstimated') totals.netEstimated += Number(row.tokens)
      else if (row.component === 'cachedInput') totals.cachedInput += Number(row.tokens)
      else if (row.component === 'uncachedInput') totals.uncachedInput += Number(row.tokens)
    }
    return totals
  }

  /** 「怎么省的」组成:saving claims 按压缩路径×口径聚合(可聚焦单会话);浮窗组成块数据源。 */
  /**
   * 最近有压缩活动的会话(claims.at 最大者,回填保留原始事件时间)——浮窗
   * 「怎么省的」的"当前会话"解析基准。sessions.updated_at 会被回填统一盖章,
   * 不能作活跃判据。
   */
  latestActiveSessionId(): string | undefined {
    const db = this.requireDb()
    const row = db.prepare(
      'SELECT session_id FROM claims GROUP BY session_id ORDER BY MAX(at) DESC LIMIT 1',
    ).get() as { session_id: string } | undefined
    return row?.session_id
  }

  sessionComponents(sessionId?: string): Array<{ component: string; basis: string; tokens: number; events: number }> {
    const db = this.requireDb()
    const rows = (sessionId === undefined
      ? db.prepare(
        `SELECT component, basis, SUM(tokens) AS tokens, COUNT(*) AS events
         FROM claims WHERE kind = 'saving' GROUP BY component, basis ORDER BY tokens DESC LIMIT 8`,
      ).all()
      : db.prepare(
        `SELECT component, basis, SUM(tokens) AS tokens, COUNT(*) AS events
         FROM claims WHERE kind = 'saving' AND session_id = ? GROUP BY component, basis ORDER BY tokens DESC LIMIT 8`,
      ).all(sessionId)
    ) as { component: string; basis: string; tokens: number | bigint; events: number | bigint }[]
    return rows.map(row => ({ component: row.component, basis: row.basis, tokens: Number(row.tokens), events: Number(row.events) }))
  }

  /** 会话已覆盖水位(绝对 seq);未知会话 = 0。 */
  getSessionWatermark(sessionId: string): number {
    const db = this.requireDb()
    const row = db.prepare(`SELECT version FROM sessions WHERE session_id = ?`).get(String(sessionId)) as { version: number | bigint } | undefined
    return row === undefined ? 0 : Number(row.version)
  }

  /**
   * 会话行全容（回填器用来判 source=live 护栏与水位 diff）；未知会话 = undefined。
   */
  getSessionRecord(sessionId: string): { version: number; project: string; source: string; updatedAt: number } | undefined {
    const db = this.requireDb()
    const row = db.prepare(`SELECT version, project, source, updated_at AS updatedAt FROM sessions WHERE session_id = ?`).get(String(sessionId)) as
      | { version: number | bigint; project: string; source: string; updatedAt: number | bigint }
      | undefined
    if (row === undefined) return undefined
    return { version: Number(row.version), project: row.project, source: row.source, updatedAt: Number(row.updatedAt) }
  }

  /**
   * 最近活跃会话（updated_at 降序；/ccip `session latest` 与面板聚焦的解析源
   * ——usage 水位每秒 upsert 刷 updated_at，活跃会话自然浮到最前）。
   */
  recentSessionIds(limit: number): { sessionId: string; updatedAt: number; source: string }[] {
    const db = this.requireDb()
    const capped = Math.max(1, Math.min(100, Math.trunc(limit)))
    const rows = db.prepare(
      `SELECT session_id AS sessionId, updated_at AS updatedAt, source FROM sessions ORDER BY updated_at DESC, session_id ASC LIMIT ?`,
    ).all(capped) as { sessionId: string; updatedAt: number | bigint; source: string }[]
    return rows.map(row => ({ sessionId: row.sessionId, updatedAt: Number(row.updatedAt), source: row.source }))
  }

  /** meta 键值读（displayPrefs 等）；缺键 = undefined。 */
  getMeta(key: string): string | undefined {
    const db = this.requireDb()
    const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(String(key)) as { value: string } | undefined
    return row === undefined ? undefined : row.value
  }

  /** meta 键值写（upsert；值必须是调用方已序列化的字符串）。 */
  setMeta(key: string, value: string): void {
    const db = this.requireDb()
    this.withWriteTx(() => {
      db.prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      ).run(String(key), String(value))
    })
  }

  /**
   * upsert 会话水位:单调不减(重放/回填旧值不倒退现有水位);
   * source 一旦为 live 不被 backfill 降级。
   */
  setSessionWatermark(
    sessionId: string,
    version: number,
    options: { project?: string; source?: 'live' | 'backfill' } = {},
  ): void {
    if (!Number.isFinite(version) || version < 0) {
      throw new Error(`stats-db: watermark for session "${String(sessionId)}" must be a non-negative finite number`)
    }
    const db = this.requireDb()
    this.withWriteTx(() => {
      db.prepare(`
        INSERT INTO sessions (session_id, project, version, updated_at, source)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (session_id) DO UPDATE SET
          version = MAX(sessions.version, excluded.version),
          updated_at = MAX(sessions.updated_at, excluded.updated_at),
          project = CASE WHEN excluded.project <> '' THEN excluded.project ELSE sessions.project END,
          source = CASE WHEN sessions.source = 'live' THEN 'live' ELSE excluded.source END
      `).run(
        String(sessionId),
        options.project ?? '',
        Math.trunc(version),
        Date.now(),
        options.source ?? 'live',
      )
    })
  }
}

/** 持久化状态(面板/persisted 徽标与降级标注的数据源,T24 路由消费)。 */
export type StatsPersistenceState =
  | { persisted: true; driver: StatsSqliteDriver; error?: undefined }
  | { persisted: false; reason: 'not-opened' | 'no-driver' | 'open-failed'; driver: null; error?: string }

let activeStore: StatsStore | null = null
let lastState: StatsPersistenceState = { persisted: false, reason: 'not-opened', driver: null }
// 降级 warn 恰一次的进程级门闩——BC compaction-guard 教训:失败必须可见,
// 但每次 open 重试都 warn 会刷屏。成功开成后不重置(再失败属新的异常路径,罕见)。
let degradedWarned = false

function warnStatsDegradedOnce(message: string): void {
  if (degradedWarned) return
  degradedWarned = true
  console.warn('context-compression stats persistence degraded: %s', message)
}

/** 当前持久化状态(同步读,不触发打开)。 */
export function statsPersistenceState(): StatsPersistenceState {
  return lastState
}

/** 活动句柄;未开/已关 = null。 */
export function getStatsStore(): StatsStore | null {
  return activeStore
}

/**
 * 幂等打开生命周期句柄(apply 后台 arm 与测试用):已开直接复用;无驱动 →
 * state no-driver + warn 恰一次;拒开/损坏 → state open-failed + warn 恰一次,
 * **不抛**——统计持久化故障绝不阻塞压缩主路径(dsh-compaction-guard 教训)。
 */
export async function ensureStatsStore(dbPath?: string): Promise<StatsStore | null> {
  if (activeStore !== null) return activeStore
  const path = resolveStatsDbPath(dbPath === undefined ? {} : { dbPath })
  try {
    const opened = await openStatsDatabase(path)
    if (opened === null) {
      lastState = { persisted: false, reason: 'no-driver', driver: null }
      warnStatsDegradedOnce('no SQLite driver available (better-sqlite3 absent and node:sqlite unsupported)')
      return null
    }
    activeStore = new StatsStore(opened.db, opened.driver)
    lastState = { persisted: true, driver: opened.driver }
    return activeStore
  } catch (error) {
    const message = String((error as Error)?.message ?? error)
    lastState = { persisted: false, reason: 'open-failed', driver: null, error: message }
    warnStatsDegradedOnce(`open failed: ${message}`)
    return null
  }
}

/** 幂等关闭(ctx.effect 卸载缝调用,防热重载泄 fd)。状态回落 not-opened。 */
export function closeStatsStore(): void {
  if (activeStore === null) return
  activeStore.close()
  activeStore = null
  lastState = { persisted: false, reason: 'not-opened', driver: null }
}
