/**
 * T23：回填主体（T18/T20）的集成规格。
 *
 * 断言面：双后端同 feed 结果一致 / 二次回填零增量 / live+backfill 不双计 /
 * 会话源文件 mtime+size 不变（只读红线）/ 服务缺席标记 / 单会话失败隔离 /
 * fail-soft 代次跳过 + 跨轮恰一条 warn（T19 留给本接线位的裁决）/
 * 明文(compression=none)产物分支。
 *
 * 全部落在临时 dshHome；绝不触碰真实 `~/.dsh`。D7 纪律：会话文件名一律
 * 由 generationLogFilename 拼接构造，测试文本不留被禁字面量。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import zlib from 'node:zlib'
import { StatsStore, openStatsDatabase } from '../../src/runtime/stats-db.ts'
import {
  backfillViaSessionFiles,
  backfillViaSessionQuery,
  extractBackfillClaims,
  replaySurfaceNodes,
  type BackfillEventRecord,
  type BackfillSessionQueryFace,
} from '../../src/runtime/stats-backfill.ts'
import { generationLogFilename } from '../../src/runtime/session-file-decode.ts'

const dirs: string[] = []

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cci-bf-${tag}-`))
  dirs.push(dir)
  return dir
}

async function freshStore(tag: string): Promise<{ store: StatsStore; path: string }> {
  const dir = tempDir(tag)
  const path = join(dir, 'stats.sqlite')
  const opened = await openStatsDatabase(path)
  if (opened === null) throw new Error('no sqlite driver in this environment')
  return { store: new StatsStore(opened.db, opened.driver), path }
}

/** claims 表全量导出（对账用；主键序稳定）。 */
function dumpClaims(path: string): Record<string, unknown>[] {
  const db = new DatabaseSync(path)
  try {
    return db.prepare(
      `SELECT session_id AS sessionId, seq, kind, component, basis, tokens, at FROM claims ORDER BY session_id, seq, kind, component, basis`,
    ).all() as Record<string, unknown>[]
  } finally {
    db.close()
  }
}

const ORIGINAL = 'Q'.repeat(400)
const SKELETON = 'Q'.repeat(100)

/** 共用事件 feed：压缩替换(seq2) + 全文重读(seq3) + 官方 usage(seq4/5)。 */
function buildFeed(): BackfillEventRecord[] {
  return [
    { seq: 0, type: 'user/message', time: 1000, data: { message: { content: [{ type: 'text', text: 'go' }] } } },
    { seq: 1, type: 'tool/result', time: 1001, data: { message: { content: [{ type: 'text', text: ORIGINAL }] } } },
    { seq: 2, type: 'tool/result', time: 1002, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 }, data: { message: { content: [{ type: 'text', text: SKELETON }] } } },
    { seq: 3, type: 'tool/result', time: 1003, data: { message: { content: [{ type: 'text', text: ORIGINAL }] } } },
    { seq: 4, type: 'assistant/message', time: 1004, data: { message: { content: [] }, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900 } } },
    // 非正数与白名单外科目（reasoning/total）不落行
    { seq: 5, type: 'assistant/message', time: 1005, data: { message: { content: [] }, usage: { inputTokens: 0, reasoningTokens: 50, totalTokens: 9999 } } },
  ]
}

function fakeSessionQuery(sessions: Map<string, { version: number; events: readonly BackfillEventRecord[]; cwd?: string }>): BackfillSessionQueryFace {
  return {
    async listSessions() {
      return [...sessions.entries()].map(([id, s]) => ({ header: { id, version: s.version, ...(s.cwd === undefined ? {} : { cwd: s.cwd }) } }))
    },
    async readSession(sessionId: string) {
      const s = sessions.get(sessionId)
      if (s === undefined) throw new Error(`no such session: ${sessionId}`)
      if (sessionId.startsWith('boom-')) throw new Error(`readSession failed for ${sessionId}`)
      return { session: { version: s.version, cwd: s.cwd ?? '' }, events: s.events }
    },
  }
}

/** 写一个会话目录（header 行 + 事件行；zstd 或明文）。 */
function writeSessionDir(dshHome: string, project: string, sessionId: string, headerVersion: number, rows: readonly string[], compression: 'zstd' | 'none' = 'zstd'): string {
  const dir = join(dshHome, 'sessions', project, sessionId)
  const header = JSON.stringify({ type: 'session', version: headerVersion, id: sessionId, createdAt: 1, cwd: project })
  const text = [header, ...rows, ''].join('\n')
  const bytes = compression === 'zstd' ? zlib.zstdCompressSync(Buffer.from(text, 'utf8')) : Buffer.from(text, 'utf8')
  const file = join(dir, generationLogFilename(headerVersion, compression))
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, bytes)
  return file
}

afterEach(() => {
  vi.restoreAllMocks()
  while (dirs.length > 0) {
    const dir = dirs.pop()!
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows 句柄滞后尽力而为 */ }
  }
})

describe('stats-backfill 双后端一致性与幂等(T23)', () => {
  it('后端 A 与后端 B 对同一事件流产出逐行一致的 claims 与相同聚合', async () => {
    const feed = buildFeed()
    const a = await freshStore('ab-a')
    const resultA = await backfillViaSessionQuery(a.store, fakeSessionQuery(new Map([['s1', { version: 6, events: feed }]])))
    expect(resultA.available).toBe(true)
    expect(resultA.sessions).toBe(1)
    expect(resultA.failures).toHaveLength(0)

    const homeB = tempDir('ab-b')
    writeSessionDir(homeB, 'proj-x', 's1', 4, feed.map(event => JSON.stringify(event)))
    const b = await freshStore('ab-b-store')
    const resultB = await backfillViaSessionFiles(b.store, { dshHome: homeB })
    expect(resultB.sessions).toBe(1)

    // 逐行对账：两后端的 claims 完全一致（5 行：1 saving + 1 offset + 3 usage）
    expect(dumpClaims(a.path)).toEqual(dumpClaims(b.path))
    const rows = dumpClaims(a.path)
    expect(rows).toHaveLength(5)
    expect(rows.filter(row => row.kind === 'usage')).toEqual([
      { sessionId: 's1', seq: 4, kind: 'usage', component: 'cacheRead', basis: '', tokens: 900, at: 1004 },
      { sessionId: 's1', seq: 4, kind: 'usage', component: 'input', basis: '', tokens: 100, at: 1004 },
      { sessionId: 's1', seq: 4, kind: 'usage', component: 'output', basis: '', tokens: 20, at: 1004 },
    ])
    const saving = rows.find(row => row.kind === 'saving')
    expect(saving).toMatchObject({ seq: 2, component: 'projection', basis: 'characters' })
    expect(Number(saving?.tokens)).toBeGreaterThan(0)
    expect(rows.find(row => row.kind === 'offset')).toMatchObject({ seq: 3, component: 'full-read', basis: 'characters' })
    // 聚合层同样一致
    expect(a.store.perSessionAggregates()).toEqual(b.store.perSessionAggregates())
    a.store.close()
    b.store.close()
  })

  it('二次回填零增量：A 版本未变整段跳过、版本推进重放零新增；B 重放零新增', async () => {
    const feed = buildFeed()
    const sessions = new Map<string, { version: number; events: readonly BackfillEventRecord[] }>([['s1', { version: 6, events: feed }]])
    const bag = await freshStore('replay-a')
    expect((await backfillViaSessionQuery(bag.store, fakeSessionQuery(sessions))).claimsAdded).toBe(5)
    // 版本未变 → skipped，不重读
    const pass2 = await backfillViaSessionQuery(bag.store, fakeSessionQuery(sessions))
    expect(pass2.sessions).toBe(0)
    expect(pass2.skipped).toBe(1)
    expect(pass2.claimsAdded).toBe(0)
    // 版本推进但事件相同 → 重读 + OR IGNORE 零新增
    sessions.set('s1', { version: 7, events: feed })
    const pass3 = await backfillViaSessionQuery(bag.store, fakeSessionQuery(sessions))
    expect(pass3.sessions).toBe(1)
    expect(pass3.claimsAdded).toBe(0)
    expect(dumpClaims(bag.path)).toHaveLength(5)

    const home = tempDir('replay-b')
    writeSessionDir(home, 'proj', 's1', 4, feed.map(event => JSON.stringify(event)))
    const bagB = await freshStore('replay-b-store')
    expect((await backfillViaSessionFiles(bagB.store, { dshHome: home })).claimsAdded).toBe(5)
    expect((await backfillViaSessionFiles(bagB.store, { dshHome: home })).claimsAdded).toBe(0)
    expect(dumpClaims(bagB.path)).toHaveLength(5)
    bag.store.close()
    bagB.store.close()
  })

  it('live+backfill 同会话不双计：source=live 护栏整段跳过', async () => {
    const feed = buildFeed()
    const bag = await freshStore('live-guard')
    bag.store.setSessionWatermark('s1', 2, { source: 'live' })
    const resA = await backfillViaSessionQuery(bag.store, fakeSessionQuery(new Map([['s1', { version: 6, events: feed }]])))
    expect(resA.skipped).toBe(1)
    expect(resA.claimsAdded).toBe(0)

    const home = tempDir('live-guard-b')
    writeSessionDir(home, 'proj', 's1', 4, feed.map(event => JSON.stringify(event)))
    const resB = await backfillViaSessionFiles(bag.store, { dshHome: home })
    expect(resB.skipped).toBe(1)
    expect(resB.claimsAdded).toBe(0)
    expect(dumpClaims(bag.path)).toHaveLength(0)
    // 会话行仍 live、水位未被回填降级（live 写 2，feed maxSeq 5）
    const record = bag.store.getSessionRecord('s1')
    expect(record?.source).toBe('live')
    expect(record?.version).toBeGreaterThanOrEqual(2)
    bag.store.close()
  })

  it('回填只读：会话源文件 mtime/size 与目录内容不因回填变化', async () => {
    const feed = buildFeed()
    const home = tempDir('readonly')
    const file = writeSessionDir(home, 'proj', 's1', 4, feed.map(event => JSON.stringify(event)))
    const before = statSync(file)
    const dirListingBefore = readFileSync(file).length
    const bag = await freshStore('readonly-store')
    await backfillViaSessionFiles(bag.store, { dshHome: home })
    const after = statSync(file)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.size).toBe(before.size)
    expect(readFileSync(file).length).toBe(dirListingBefore)
    // 目录里仍然只有那一个会话文件（无副作用产物）
    expect(existsSync(join(home, 'sessions', 'proj', 's1', 'stats.sqlite'))).toBe(false)
    bag.store.close()
  })

  it('服务缺席 → available:false 标记不抛（T18）', async () => {
    const bag = await freshStore('no-service')
    const res = await backfillViaSessionQuery(bag.store, undefined)
    expect(res.available).toBe(false)
    expect(res.sessions).toBe(0)
    expect(res.claimsAdded).toBe(0)
    bag.store.close()
  })

  it('单会话失败隔离（SI 纪律）：坏会话进 failures，好会话照常落库', async () => {
    const feed = buildFeed()
    const sessions = new Map<string, { version: number; events: readonly BackfillEventRecord[] }>([
      ['boom-1', { version: 3, events: feed }],
      ['good-2', { version: 3, events: feed }],
    ])
    const bag = await freshStore('isolate')
    const res = await backfillViaSessionQuery(bag.store, fakeSessionQuery(sessions))
    expect(res.failures).toHaveLength(1)
    expect(res.failures[0]?.sessionId).toBe('boom-1')
    expect(res.sessions).toBe(1)
    expect(res.claimsAdded).toBe(5)
    expect(dumpClaims(bag.path).every(row => row.sessionId === 'good-2')).toBe(true)
    bag.store.close()
  })

  it('明文(compression=none)产物走 T19 明文分支照常落库', async () => {
    const feed = buildFeed()
    const home = tempDir('plain')
    writeSessionDir(home, 'proj', 's1', 4, feed.map(event => JSON.stringify(event)), 'none')
    const bag = await freshStore('plain-store')
    const res = await backfillViaSessionFiles(bag.store, { dshHome: home })
    expect(res.sessions).toBe(1)
    expect(res.claimsAdded).toBe(5)
    bag.store.close()
  })

  it('仅迁移暂存的目录不构成可解码产物（跳过且不抛）', async () => {
    const home = tempDir('staging-only')
    const dir = join(home, 'sessions', 'proj', 's9')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.migration.ab12cd.jsonl.zstd.tmp'), 'x')
    const bag = await freshStore('staging-store')
    const res = await backfillViaSessionFiles(bag.store, { dshHome: home })
    expect(res.sessions).toBe(0)
    expect(res.claimsAdded).toBe(0)
    expect(res.failures).toHaveLength(0)
    bag.store.close()
  })
})

describe('stats-backfill fail-soft 代次裁决与 warn 接线(T19 裁决位)', () => {
  /** resetModules 拿全新模块实例，进程级 warn 门闩互不串扰。 */
  async function freshBackfillModule() {
    vi.resetModules()
    return await import('../../src/runtime/stats-backfill.ts')
  }

  it('未知代次会话被跳过；跨两轮回填 warn 恰一条；好会话不受影响', async () => {
    const mod = await freshBackfillModule()
    const feed = buildFeed()
    const home = tempDir('warn-once')
    writeSessionDir(home, 'proj', 'good', 4, feed.map(event => JSON.stringify(event)))
    writeSessionDir(home, 'proj', 'weird', 9, feed.map(event => JSON.stringify(event))) // 代次 9 未知
    const bag = await freshStore('warn-store')
    const warn = vi.fn()
    const first = await mod.backfillViaSessionFiles(bag.store, { dshHome: home, warn })
    expect(first.sessions).toBe(1)
    expect(first.skipped).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/weird/)
    // 坏会话零行，好会话五行
    const rows = dumpClaims(bag.path)
    expect(rows).toHaveLength(5)
    expect(rows.every(row => row.sessionId === 'good')).toBe(true)
    // 第二轮：门闩已落，不再 warn；好会话已被 T21 水位跳过（version ≥ maxSeq），
    // skipped = 1 未知代次 + 1 水位跳过
    const second = await mod.backfillViaSessionFiles(bag.store, { dshHome: home, warn })
    expect(second.skipped).toBe(2)
    expect(second.sessions).toBe(0)
    expect(second.claimsAdded).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
    bag.store.close()
  })

  it('缺失 header/非会话头同样归入跳过（不整体失败）', async () => {
    const mod = await freshBackfillModule()
    const home = tempDir('bad-header')
    const dirA = join(home, 'sessions', 'p', 'no-header')
    mkdirSync(dirA, { recursive: true })
    writeFileSync(join(dirA, generationLogFilename(4, 'zstd')), zlib.zstdCompressSync(Buffer.from('not-json\n', 'utf8')))
    const bag = await freshStore('bad-header-store')
    const warn = vi.fn()
    const res = await mod.backfillViaSessionFiles(bag.store, { dshHome: home, warn })
    expect(res.sessions).toBe(0)
    expect(res.skipped).toBe(1)
    expect(res.failures).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    bag.store.close()
  })
})

describe('stats-backfill 提取核心原语', () => {
  it('replaySurfaceNodes：replace 把被替换区间移出 surface，替换节点自身留在面上', () => {
    const surface = replaySurfaceNodes(buildFeed())
    expect(surface).toEqual([0, 2, 3, 4, 5]) // seq1 被 seq2 的 replace [1,1] 挤出
  })

  it('extractBackfillClaims 纯函数：空 feed 返回空；usage 只收白名单正科目', () => {
    expect(extractBackfillClaims([])).toEqual({ rows: [], maxSeq: 0 })
    const { rows, maxSeq } = extractBackfillClaims(buildFeed())
    expect(maxSeq).toBe(5)
    const usage = rows.filter(row => row.kind === 'usage')
    expect(usage).toHaveLength(3)
    expect(usage.every(row => row.tokens > 0)).toBe(true)
  })

  it('D7 字面量守卫：stats-backfill 源文本不含被禁的裸文件名/版本常量', () => {
    const source = readFileSync(join(process.cwd(), 'packages/selector/src/runtime/stats-backfill.ts'), 'utf8')
    const banned: readonly RegExp[] = [/session\.jsonl/iu, /SESSION_FORMAT_VERSION/u, /sessionFormatVersion/u]
    for (const pattern of banned) expect(pattern.test(source)).toBe(false)
  })
})
