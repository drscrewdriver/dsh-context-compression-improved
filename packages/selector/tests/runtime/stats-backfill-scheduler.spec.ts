/**
 * T21：回填调度器规格——路由首命中一次性闸、dispose 低频节流、pause/resume、
 * 分块扫盘（游标跨 chunk 推进 + wrap 归零）、无 store 空转、重放幂等。
 *
 * 调度器是模块级单例：每个用例 vi.resetModules + 动态 import 取全新状态，
 * 同一动态链里的 stats-db 单例也随注册表一起刷新。DSH_HOME 指向临时目录，
 * 绝不触碰真实 `~/.dsh`。
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generationLogFilename } from '../../src/runtime/session-file-decode.ts'

const dirs: string[] = []
const envBackup: Record<string, string | undefined> = {}
// 最近一次动态注册表的 stats-db：afterEach 关句柄后再删目录（Windows EBUSY）。
let lastStatsDb: typeof import('../../src/runtime/stats-db.ts') | undefined

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cci-sched-${tag}-`))
  dirs.push(dir)
  return dir
}

/** 写一个可解码的 v4 会话目录（header + 一条带压缩替换与 usage 的事件流）。 */
function writeSessionDir(dshHome: string, sessionId: string): void {
  const dir = join(dshHome, 'sessions', 'proj', sessionId)
  const header = JSON.stringify({ type: 'session', version: 4, id: sessionId, createdAt: 1, cwd: 'proj' })
  const rows = [
    JSON.stringify({ seq: 0, type: 'user/message', time: 1000, data: { message: { content: [{ type: 'text', text: 'go' }] } } }),
    JSON.stringify({ seq: 1, type: 'tool/result', time: 1001, data: { message: { content: [{ type: 'text', text: 'R'.repeat(400) }] } } }),
    JSON.stringify({ seq: 2, type: 'tool/result', time: 1002, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 }, data: { message: { content: [{ type: 'text', text: 'S'.repeat(100) }] } } }),
    JSON.stringify({ seq: 3, type: 'assistant/message', time: 1003, data: { message: { content: [] }, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 50 } } }),
  ]
  const bytes = zlib.zstdCompressSync(Buffer.from([header, ...rows, ''].join('\n'), 'utf8'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, generationLogFilename(4, 'zstd')), bytes)
}

/** 全新模块注册表：scheduler 与 stats-db 单例一起重置。 */
async function freshModules() {
  vi.resetModules()
  const backfill = await import('../../src/runtime/stats-backfill.ts')
  const statsDb = await import('../../src/runtime/stats-db.ts')
  lastStatsDb = statsDb
  return { backfill, statsDb }
}

async function settle(backfill: typeof import('../../src/runtime/stats-backfill.ts')): Promise<void> {
  await vi.waitFor(() => {
    expect(backfill.getStatsBackfillStatus().running).toBe(false)
  })
}

beforeEach(() => {
  envBackup['DSH_HOME'] = process.env['DSH_HOME']
})

afterEach(() => {
  process.env['DSH_HOME'] = envBackup['DSH_HOME']
  lastStatsDb?.closeStatsStore()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('回填调度器（T21）', () => {
  it('路由首命中触发一轮；重复命中被一次性闸吸收', async () => {
    const home = tempDir('route')
    process.env['DSH_HOME'] = home
    writeSessionDir(home, 'sess-route-1')
    writeSessionDir(home, 'sess-route-2')
    const { backfill, statsDb } = await freshModules()
    const store = await statsDb.ensureStatsStore(join(tempDir('route-db'), 'stats.sqlite'))
    expect(store).not.toBeNull()

    backfill.kickStatsBackfillOnRouteHit()
    await settle(backfill)
    expect(backfill.getStatsBackfillStatus().runs).toBe(1)
    expect(backfill.getStatsBackfillStatus().lastSummary?.sessions).toBe(2)

    backfill.kickStatsBackfillOnRouteHit()
    await settle(backfill)
    expect(backfill.getStatsBackfillStatus().runs).toBe(1)
  })

  it('前台活跃压缩 → 回填让路（busy 期间零推进），旗标释放后完成', async () => {
    const home = tempDir('livebusy')
    process.env['DSH_HOME'] = home
    writeSessionDir(home, 'sess-livebusy')
    const { backfill, statsDb } = await freshModules()
    const statsSync = await import('../../src/runtime/stats-sync.ts')
    const store = await statsDb.ensureStatsStore(join(tempDir('livebusy-db'), 'stats.sqlite'))
    expect(store).not.toBeNull()

    statsSync.setStatsLivePathBusy(true)
    const passPromise = backfill.runStatsBackfillPass({ dshHome: home })
    // busy 窗口内 pass 已启动(running)但让路零推进
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(backfill.getStatsBackfillStatus().running).toBe(true)
    expect(backfill.getStatsBackfillStatus().runs).toBe(0)
    statsSync.setStatsLivePathBusy(false)
    await vi.waitFor(() => {
      expect(backfill.getStatsBackfillStatus().running).toBe(false)
    }, { timeout: 5000 })
    expect(backfill.getStatsBackfillStatus().runs).toBe(1)
    expect(backfill.getStatsBackfillStatus().lastSummary?.sessions).toBe(1)
    await expect(passPromise).resolves.toMatchObject({ sessions: 1 })
  })

  it('分块扫盘：chunk 游标跨 chunk 推进、wrap 归零后重放零新增', async () => {
    const home = tempDir('chunk')
    process.env['DSH_HOME'] = home
    for (const id of ['sess-c-1', 'sess-c-2', 'sess-c-3']) writeSessionDir(home, id)
    const { backfill, statsDb } = await freshModules()
    const store = await statsDb.ensureStatsStore(join(tempDir('chunk-db'), 'stats.sqlite'))
    expect(store).not.toBeNull()

    // chunkSize=2 → 3 会话分两 chunk；claims 全部落库
    const first = await backfill.runStatsBackfillPass({ maxSessionsPerBackend: 2 })
    expect(first?.backend).toBe('files')
    expect(first?.sessions).toBe(3)
    expect(first!.claimsAdded).toBeGreaterThan(0)

    // 第二轮：全水位命中 → 零新增零处理（幂等重放锚点）
    const second = await backfill.runStatsBackfillPass({ maxSessionsPerBackend: 2 })
    expect(second?.sessions).toBe(0)
    expect(second?.claimsAdded).toBe(0)
  })

  it('pause 空转、resume 恢复；dispose kick 10 分钟节流', async () => {
    const home = tempDir('pause')
    process.env['DSH_HOME'] = home
    writeSessionDir(home, 'sess-pause-1')
    const { backfill, statsDb } = await freshModules()
    await statsDb.ensureStatsStore(join(tempDir('pause-db'), 'stats.sqlite'))

    backfill.pauseStatsBackfill()
    expect(await backfill.runStatsBackfillPass()).toBeUndefined()
    backfill.kickStatsBackfillOnDispose()
    await settle(backfill)
    expect(backfill.getStatsBackfillStatus().runs).toBe(0)

    backfill.resumeStatsBackfill()
    backfill.kickStatsBackfillOnDispose()
    await settle(backfill)
    expect(backfill.getStatsBackfillStatus().runs).toBe(1)

    // 节流窗口内第二次 dispose kick 不再跑
    backfill.kickStatsBackfillOnDispose()
    await settle(backfill)
    expect(backfill.getStatsBackfillStatus().runs).toBe(1)
  })

  it('无 store（未开/无驱动）时 kick 与直接 pass 全部空转', async () => {
    const home = tempDir('nostore')
    process.env['DSH_HOME'] = home
    writeSessionDir(home, 'sess-nostore-1')
    const { backfill } = await freshModules()

    expect(await backfill.runStatsBackfillPass()).toBeUndefined()
    backfill.kickStatsBackfillOnRouteHit()
    await settle(backfill)
    expect(backfill.getStatsBackfillStatus().runs).toBe(0)
    expect(backfill.getStatsBackfillStatus().lastSummary).toBeUndefined()
  })
})
