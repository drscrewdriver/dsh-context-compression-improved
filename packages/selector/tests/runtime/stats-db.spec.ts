/**
 * 持久层主干(T1–T5)单测:开关纪律 / schema 幂等 / claims 落库与聚合 /
 * BC #2671 两断言 / 双连接写 / 生命周期与可见降级。
 *
 * 全部用临时目录注入路径,绝不触碰真实 `~/.dsh`。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  StatsStore,
  closeStatsStore,
  getStatsStore,
  openStatsDatabase,
  statsPersistenceState,
} from '../../src/runtime/stats-db.ts'
import {
  CCI_STATS_APPLICATION_ID,
  OFFICIAL_SESSION_QUERY_APPLICATION_ID,
  STATS_SCHEMA_VERSION,
  resolveStatsDbPath,
} from '../../src/runtime/stats-schema.ts'

const dirs: string[] = []

/** 每个用例一个独立临时目录,收尾删干净。 */
function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cci-stats-${name}-`))
  dirs.push(dir)
  return dir
}

const tempDbPath = (name: string): string => join(tempDir(name), 'stats.sqlite')

async function openStore(path: string): Promise<StatsStore> {
  const opened = await openStatsDatabase(path)
  if (opened === null) throw new Error('no sqlite driver in this environment')
  return new StatsStore(opened.db, opened.driver)
}

function pragma(db: DatabaseSync, sql: string): Record<string, unknown> {
  return db.prepare(sql).get() as Record<string, unknown>
}

function countRows(path: string, table: string): number {
  const db = new DatabaseSync(path)
  try {
    return Number((db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number | bigint }).c)
  } finally {
    db.close()
  }
}

afterEach(() => {
  closeStatsStore()
  vi.restoreAllMocks()
  while (dirs.length > 0) {
    const dir = dirs.pop()!
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows 句柄释放滞后时尽力而为 */ }
  }
})

describe('stats-db 开关纪律(T1:打开/拒他人库/版本不符重建)', () => {
  it('空库打开:建表齐三张 + pragma 到位 + application_id/user_version 盖章', async () => {
    const opened = await openStatsDatabase(tempDbPath('open'))
    expect(opened).not.toBeNull()
    const { db, driver } = opened!
    expect(['better-sqlite3', 'node:sqlite']).toContain(driver)
    try {
      expect(Number(pragma(db, 'PRAGMA application_id').application_id)).toBe(CCI_STATS_APPLICATION_ID)
      expect(Number(pragma(db, 'PRAGMA user_version').user_version)).toBe(STATS_SCHEMA_VERSION)
      expect(Number(pragma(db, 'PRAGMA busy_timeout').timeout)).toBe(5000)
      expect(String(pragma(db, 'PRAGMA journal_mode').journal_mode).toLowerCase()).toBe('wal')
      const tables = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      ).all() as { name: string }[]
      expect(tables.map(row => row.name)).toEqual(['claims', 'meta', 'sessions'])
    } finally {
      db.close()
    }
  })

  it('拒开他人库:官方派生库与任意第三方 application_id 都抛错', async () => {
    // 官方 session-query 派生库(0x44534851)
    const officialPath = tempDbPath('foreign-official')
    const rawOfficial = new DatabaseSync(officialPath)
    rawOfficial.exec(`CREATE TABLE IF NOT EXISTS sentinel (x INTEGER)`)
    rawOfficial.exec(`PRAGMA application_id = ${OFFICIAL_SESSION_QUERY_APPLICATION_ID}`)
    rawOfficial.close()
    await expect(openStatsDatabase(officialPath)).rejects.toThrow(/refusing to open/)

    // 不认识的第三方库
    const otherPath = tempDbPath('foreign-other')
    const rawOther = new DatabaseSync(otherPath)
    rawOther.exec(`CREATE TABLE IF NOT EXISTS sentinel (x INTEGER)`)
    rawOther.exec(`PRAGMA application_id = ${0x0DEADBEE}`)
    rawOther.close()
    await expect(openStatsDatabase(otherPath)).rejects.toThrow(/another application/)
  })

  it('版本不符 drop 重建:user_version 被篡成高值后重开 = 空表 + 版本复位', async () => {
    const path = tempDbPath('rebuild')
    const first = await openStore(path)
    first.recordClaims('s1', [{ seq: 3, kind: 'saving', component: 'fresh', basis: 'exact-tokenizer', tokens: 42, at: 1 }])
    first.close()

    // 外部篡改 user_version(模拟不兼容代际)
    const raw = new DatabaseSync(path)
    raw.exec(`PRAGMA user_version = ${STATS_SCHEMA_VERSION + 99}`)
    raw.close()

    const reopened = await openStatsDatabase(path)
    expect(reopened).not.toBeNull()
    const { db } = reopened!
    try {
      expect(Number(pragma(db, 'PRAGMA user_version').user_version)).toBe(STATS_SCHEMA_VERSION)
      expect(Number(pragma(db, 'PRAGMA application_id').application_id)).toBe(CCI_STATS_APPLICATION_ID)
      expect(countRows(path, 'claims')).toBe(0)
    } finally {
      db.close()
    }
  })

  it('二次打开幂等:数据原样保留,建表语句空转不报错', async () => {
    const path = tempDbPath('idempotent-open')
    const first = await openStore(path)
    expect(first.recordClaims('s1', [{ seq: 1, kind: 'usage', component: 'input', basis: '', tokens: 10, at: 1 }])).toBe(1)
    first.close()
    const second = await openStore(path) // ensureSchema 空转不抛
    expect(countRows(path, 'claims')).toBe(1)
    second.close()
  })
})

describe('resolveStatsDbPath(T2 路径解析优先级)', () => {
  const expected = (home: string) => join(home, 'storages', 'dsh-context-compression', 'stats.sqlite')

  it('dbPath 显式覆盖最高优先;空白串按未设置', () => {
    expect(resolveStatsDbPath({ dbPath: 'X:/custom/stats.sqlite', dshHome: 'X:/home' })).toBe('X:/custom/stats.sqlite')
    expect(resolveStatsDbPath({ dbPath: '   ', dshHome: 'X:/home' })).toBe(expected('X:/home'))
  })

  it('dshHome > $DSH_HOME > homedir/.dsh;空 env 按未设置(镜像宿主 resolveDshHome 语义)', () => {
    expect(resolveStatsDbPath({ dshHome: 'X:/explicit', env: { DSH_HOME: 'X:/env' } })).toBe(expected('X:/explicit'))
    expect(resolveStatsDbPath({ env: { DSH_HOME: 'X:/env' } })).toBe(expected('X:/env'))
    // 空白 env 按未设置 → 兜底 homedir/.dsh(宿主 resolveDshHome 同语义)
    expect(resolveStatsDbPath({ env: { DSH_HOME: '   ' } })).toBe(join(homedir(), '.dsh', 'storages', 'dsh-context-compression', 'stats.sqlite'))
    expect(resolveStatsDbPath({ env: {} })).toBe(join(homedir(), '.dsh', 'storages', 'dsh-context-compression', 'stats.sqlite'))
  })
})

describe('recordClaims 与聚合(T3 + BC #2671 两断言 + 写后读回对账)', () => {
  it('幂等重放零新增:同一批行二次落库 added=0 且总行数不变', async () => {
    const path = tempDbPath('replay')
    const store = await openStore(path)
    const rows = [
      { seq: 5, kind: 'saving' as const, component: 'fresh', basis: 'exact-tokenizer', tokens: 900, at: 10 },
      { seq: 5, kind: 'offset' as const, component: 'retrieve', basis: 'characters', tokens: 200, at: 11 },
      { seq: 6, kind: 'usage' as const, component: 'input', basis: '', tokens: 1234, at: 12 },
    ]
    expect(store.recordClaims('s1', rows)).toBe(3)
    expect(store.recordClaims('s1', rows)).toBe(0)
    expect(countRows(path, 'claims')).toBe(3)
    store.close()
  })

  it('跨会话不覆盖(BC #2671-2):同 (seq,kind,component,basis) 两会话各自完整', async () => {
    const store = await openStore(tempDbPath('cross-session'))
    store.recordClaims('s1', [{ seq: 7, kind: 'saving', component: 'fresh', basis: 'exact-tokenizer', tokens: 100, at: 1 }])
    store.recordClaims('s2', [{ seq: 7, kind: 'saving', component: 'fresh', basis: 'exact-tokenizer', tokens: 250, at: 2 }])
    const per = store.perSessionAggregates()
    expect(per).toHaveLength(2)
    expect(per.find(row => row.sessionId === 's1')?.gross.exact).toBe(100)
    expect(per.find(row => row.sessionId === 's2')?.gross.exact).toBe(250)
    // 净额精确降序
    expect(per[0]?.sessionId).toBe('s2')
    store.close()
  })

  it('latestActiveSessionId:claims.at 最大者为最近压缩会话(空库 undefined)', async () => {
    const store = await openStore(tempDbPath('latest-active'))
    expect(store.latestActiveSessionId()).toBeUndefined()
    store.recordClaims('s-old', [{ seq: 1, kind: 'saving', component: 'fresh', basis: 'characters', tokens: 10, at: 100 }])
    store.recordClaims('s-new', [{ seq: 1, kind: 'usage', component: 'input', basis: '', tokens: 20, at: 200 }])
    expect(store.latestActiveSessionId()).toBe('s-new')
    store.close()
  })
  it('sessionComponents:按路径×口径聚合 saving,可聚焦单会话,不含 usage/offset', async () => {
    const store = await openStore(tempDbPath('components'))
    store.recordClaims('s1', [
      { seq: 1, kind: 'saving', component: 'fresh', basis: 'exact-tokenizer', tokens: 900, at: 1 },
      { seq: 2, kind: 'saving', component: 'fresh', basis: 'exact-tokenizer', tokens: 100, at: 2 },
      { seq: 3, kind: 'saving', component: 'history', basis: 'characters', tokens: 400, at: 3 },
      { seq: 4, kind: 'offset', component: 'retrieve', basis: 'characters', tokens: 150, at: 4 },
      { seq: 5, kind: 'usage', component: 'input', basis: '', tokens: 5000, at: 5 },
    ])
    store.recordClaims('s2', [{ seq: 1, kind: 'saving', component: 'tail-trim', basis: 'characters', tokens: 77, at: 6 }])
    expect(store.sessionComponents('s1')).toEqual([
      { component: 'fresh', basis: 'exact-tokenizer', tokens: 1000, events: 2 },
      { component: 'history', basis: 'characters', tokens: 400, events: 1 },
    ])
    // 无 sessionId = 全库组成,按 tokens 降序
    const all = store.sessionComponents()
    expect(all[0]).toEqual({ component: 'fresh', basis: 'exact-tokenizer', tokens: 1000, events: 2 })
    expect(all).toHaveLength(3)
    store.close()
  })

  it('绝对 seq 写后读回对账(BC #2671-1):perSession/total 与逐条目手算一致', async () => {
    const store = await openStore(tempDbPath('reconcile'))
    store.recordClaims('s1', [
      { seq: 3, kind: 'saving', component: 'fresh', basis: 'exact-tokenizer', tokens: 1000, at: 1 },
      { seq: 9, kind: 'saving', component: 'history', basis: 'characters', tokens: 400, at: 2 },
      { seq: 12, kind: 'offset', component: 'retrieve', basis: 'characters', tokens: 150, at: 3 },
    ])
    store.recordClaims('s2', [
      { seq: 4, kind: 'saving', component: 'tail-trim', basis: 'exact-tokenizer', tokens: 700, at: 4 },
      { seq: 8, kind: 'offset', component: 'full-read', basis: 'exact-tokenizer', tokens: 300, at: 5 },
    ])
    const per = store.perSessionAggregates()
    const s1 = per.find(row => row.sessionId === 's1')!
    const s2 = per.find(row => row.sessionId === 's2')!
    expect(s1.gross).toEqual({ exact: 1000, estimated: 400 })
    expect(s1.offsets).toEqual({ exact: 0, estimated: 150 })
    expect(s1.net).toEqual({ exact: 1000, estimated: 250 })
    expect(s2.net).toEqual({ exact: 400, estimated: 0 })
    expect(store.total()).toEqual({
      gross: { exact: 1700, estimated: 400 },
      offsets: { exact: 300, estimated: 150 },
      net: { exact: 1400, estimated: 250 },
    })
    store.close()
  })

  it('sumSamples:边界采样按组件累计、calls=distinct 边界数;重放零增量', async () => {
    const store = await openStore(tempDbPath('samples'))
    const sampleRows = (seq: number, netExact: number, netEstimated: number, cached: number, uncached: number) => ([
      { seq, kind: 'sample' as const, component: 'netExact', basis: '', tokens: netExact, at: seq * 10 },
      { seq, kind: 'sample' as const, component: 'netEstimated', basis: '', tokens: netEstimated, at: seq * 10 },
      { seq, kind: 'sample' as const, component: 'cachedInput', basis: '', tokens: cached, at: seq * 10 },
      { seq, kind: 'sample' as const, component: 'uncachedInput', basis: '', tokens: uncached, at: seq * 10 },
    ])
    const batch = [...sampleRows(10, 100, 50, 900, 100), ...sampleRows(11, 80, 40, 950, 50)]
    expect(store.recordClaims('s1', batch)).toBe(8)
    expect(store.recordClaims('s1', batch)).toBe(0)
    expect(store.sumSamples('s1')).toEqual({ netExact: 180, netEstimated: 90, cachedInput: 1850, uncachedInput: 150, calls: 2 })
    // 别的会话没有采样
    expect(store.sumSamples('s2').calls).toBe(0)
    store.close()
  })

  it('水位单调不减 + source 一旦 live 不被 backfill 降级', async () => {
    const path = tempDbPath('watermark')
    const store = await openStore(path)
    expect(store.getSessionWatermark('unknown')).toBe(0)
    store.setSessionWatermark('s1', 7, { project: 'p', source: 'live' })
    expect(store.getSessionWatermark('s1')).toBe(7)
    store.setSessionWatermark('s1', 3, { source: 'backfill' })
    expect(store.getSessionWatermark('s1')).toBe(7)
    store.setSessionWatermark('s1', 9, { source: 'backfill' })
    expect(store.getSessionWatermark('s1')).toBe(9)
    const db = new DatabaseSync(path)
    try {
      const row = db.prepare(`SELECT project, source FROM sessions WHERE session_id = 's1'`).get() as { project: string; source: string }
      expect(row).toEqual({ project: 'p', source: 'live' })
    } finally {
      db.close()
    }
    store.close()
  })

  it('拒收坏行:未知 kind / 非有限数抛错;关闭后调用即抛', async () => {
    const store = await openStore(tempDbPath('bad-rows'))
    expect(() => store.recordClaims('s1', [{ seq: 1, kind: 'wat' as never, component: 'x', basis: '', tokens: 1, at: 1 }])).toThrow(/unsupported claim kind/)
    expect(() => store.recordClaims('s1', [{ seq: Number.NaN, kind: 'usage', component: 'x', basis: '', tokens: 1, at: 1 }])).toThrow(/non-finite/)
    expect(() => store.setSessionWatermark('s1', -2)).toThrow(/non-negative/)
    store.close()
    expect(store.isOpen).toBe(false)
    expect(() => store.recordClaims('s1', [{ seq: 1, kind: 'usage', component: 'x', basis: '', tokens: 1, at: 1 }])).toThrow(/closed/)
  })
})

describe('双连接并发写(busy_timeout/多实例拓扑)', () => {
  it('同一文件两个句柄交替写小事务互不失败,合并对账一致', async () => {
    const path = tempDbPath('two-conns')
    const a = await openStore(path)
    const b = await openStore(path)
    try {
      a.recordClaims('s1', [{ seq: 1, kind: 'saving', component: 'fresh', basis: 'exact-tokenizer', tokens: 10, at: 1 }])
      b.recordClaims('s2', [{ seq: 1, kind: 'saving', component: 'fresh', basis: 'exact-tokenizer', tokens: 20, at: 2 }])
      a.recordClaims('s1', [{ seq: 2, kind: 'offset', component: 'retrieve', basis: 'characters', tokens: 4, at: 3 }])
      b.recordClaims('s2', [{ seq: 2, kind: 'offset', component: 'retrieve', basis: 'characters', tokens: 8, at: 4 }])
      expect(b.total().net).toEqual({ exact: 30, estimated: -12 })
      expect(a.perSessionAggregates()).toHaveLength(2)
      // 另一连接写过的行重放:幂等零新增(跨连接的主键去重)
      expect(b.recordClaims('s1', [{ seq: 1, kind: 'saving', component: 'fresh', basis: 'exact-tokenizer', tokens: 10, at: 1 }])).toBe(0)
      expect(countRows(path, 'claims')).toBe(4)
    } finally {
      a.close()
      b.close()
    }
  })
})

describe('生命周期与可见降级(T5:warn 恰一次 + persisted 状态导出)', () => {
  /** resetModules 拿全新模块实例,单例与 warn 门闩互不串扰。 */
  async function freshStatsDbModule() {
    vi.resetModules()
    return await import('../../src/runtime/stats-db.ts')
  }

  it('ensureStatsStore 幂等打开;closeStatsStore 后状态回落 not-opened', async () => {
    const mod = await freshStatsDbModule()
    const path = tempDbPath('lifecycle')
    const store = await mod.ensureStatsStore(path)
    expect(store).not.toBeNull()
    expect(mod.getStatsStore()).toBe(store)
    expect(mod.statsPersistenceState()).toMatchObject({ persisted: true })
    const again = await mod.ensureStatsStore(path)
    expect(again).toBe(store)
    mod.closeStatsStore()
    expect(mod.getStatsStore()).toBeNull()
    expect(mod.statsPersistenceState()).toMatchObject({ persisted: false, reason: 'not-opened', driver: null })
    expect(store?.isOpen).toBe(false)
  })

  it('open 失败(他人库)→ 不抛、persisted:false reason=open-failed、warn 恰一次', async () => {
    const mod = await freshStatsDbModule()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const path = join(tempDir('foreign-lc'), 'stats.sqlite')
    const raw = new DatabaseSync(path)
    raw.exec(`CREATE TABLE IF NOT EXISTS sentinel (x INTEGER)`)
    raw.exec(`PRAGMA application_id = ${OFFICIAL_SESSION_QUERY_APPLICATION_ID}`)
    raw.close()

    const first = await mod.ensureStatsStore(path)
    const second = await mod.ensureStatsStore(path)
    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(mod.statsPersistenceState()).toMatchObject({ persisted: false, reason: 'open-failed', driver: null })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('ctx.effect 卸载缝:close 后句柄不泄漏(isOpen=false + 目录可整体删除)', async () => {
    const mod = await freshStatsDbModule()
    const dir = tempDir('effect-close')
    const path = join(dir, 'stats.sqlite')
    const store = await mod.ensureStatsStore(path)
    expect(store?.isOpen).toBe(true)
    // 模拟 ctx.effect 清理器:再次卸载幂等,不抛
    mod.closeStatsStore()
    mod.closeStatsStore()
    expect(store?.isOpen).toBe(false)
    // 句柄已释放:WAL 残留文件不阻碍整目录删除
    rmSync(dir, { recursive: true, force: true })
    expect(getStatsStore()).toBeNull()
    expect(statsPersistenceState()).toMatchObject({ persisted: false, reason: 'not-opened' })
  })
})
