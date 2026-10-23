/**
 * T29：/ccip 面板控制命令规格——子命令解析纯函数钉死 + execute 的偏好切换
 * （meta 持久）、session latest、flush 与 backfill 开关接线。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeStatsStore, ensureStatsStore, getStatsStore } from '../../src/runtime/stats-db.ts'
import { getDisplayPrefs, resetDisplayPrefsCache } from '../../src/runtime/display-prefs.ts'
import {
  executePanelCommand,
  parsePanelCommandArgs,
} from '../../src/runtime/panel-command.ts'

const dirs: string[] = []

afterEach(() => {
  closeStatsStore()
  resetDisplayPrefsCache()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('/ccip 参数解析（纯函数）', () => {
  it('合法子命令全表', () => {
    expect(parsePanelCommandArgs('status')).toEqual({ op: 'status' })
    expect(parsePanelCommandArgs('rows stock off')).toEqual({ op: 'rows', row: 'stock', on: false })
    expect(parsePanelCommandArgs('ROWS  MONEY  ON')).toEqual({ op: 'rows', row: 'money', on: true })
    expect(parsePanelCommandArgs('mode compact')).toEqual({ op: 'mode', mode: 'compact' })
    expect(parsePanelCommandArgs('session off')).toEqual({ op: 'session', target: { kind: 'off' } })
    expect(parsePanelCommandArgs('session latest')).toEqual({ op: 'session', target: { kind: 'latest' } })
    expect(parsePanelCommandArgs('session abc-123')).toEqual({ op: 'session', target: { kind: 'id', id: 'abc-123' } })
    expect(parsePanelCommandArgs('flush')).toEqual({ op: 'flush' })
    expect(parsePanelCommandArgs('backfill pause')).toEqual({ op: 'backfill', action: 'pause' })
    expect(parsePanelCommandArgs('  ')).toBeUndefined()
    expect(parsePanelCommandArgs('rows bogus on')).toBeUndefined()
    expect(parsePanelCommandArgs('mode sideways')).toBeUndefined()
    expect(parsePanelCommandArgs('session')).toBeUndefined()
    expect(parsePanelCommandArgs('backfill purge')).toBeUndefined()
    expect(parsePanelCommandArgs('nonsense')).toBeUndefined()
  })
})

describe('/ccip execute（偏好落 meta、开关接线）', () => {
  it('rows 切换写 displayPrefs 并持久到 meta（新句柄读回同值）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cci-ccip-'))
    dirs.push(dir)
    const path = join(dir, 'stats.sqlite')
    await ensureStatsStore(path)
    const result = executePanelCommand({ op: 'rows', row: 'stock', on: false })
    expect(result.kind).toBe('success')
    expect(getStatsStore()?.getMeta('displayPrefs')).toContain('"stock":false')

    // 跨"重启"（关开句柄）后偏好仍在
    closeStatsStore()
    resetDisplayPrefsCache()
    await ensureStatsStore(path)
    expect(getDisplayPrefsForTest().rows.stock).toBe(false)
  })

  it('session latest：空 store 报错,有会话时聚焦最近活跃', async () => {
    await ensureStatsStore(join(mkdtempSyncForTest(), 'stats.sqlite'))
    const empty = executePanelCommand({ op: 'session', target: { kind: 'latest' } })
    expect(empty.kind).toBe('error')

    const store = getStatsStore()
    store?.setSessionWatermark('sess-latest-1', 10, { source: 'live' })
    const ok = executePanelCommand({ op: 'session', target: { kind: 'latest' } })
    expect(ok.kind).toBe('success')
    expect(ok.text).toContain('sess-latest-1')
    expect(getDisplayPrefsForTest().focusSessionId).toBe('sess-latest-1')

    const off = executePanelCommand({ op: 'session', target: { kind: 'off' } })
    expect(off.kind).toBe('success')
    expect(getDisplayPrefsForTest().focusSessionId).toBeNull()
  })

  it('backfill pause/resume/status 与 flush 不抛错', async () => {
    await ensureStatsStore(join(mkdtempSyncForTest(), 'stats.sqlite'))
    expect(executePanelCommand({ op: 'backfill', action: 'pause' }).text).toContain('paused')
    expect(executePanelCommand({ op: 'backfill', action: 'status' }).text).toContain('backfill:')
    expect(executePanelCommand({ op: 'backfill', action: 'resume' }).text).toContain('resumed')
    expect(executePanelCommand({ op: 'flush' }).kind).toBe('success')
    expect(executePanelCommand({ op: 'status' }).text).toContain('ccip status:')
  })
  it('verify 子命令:无参/latest → 活跃指针目标;显式 id 透传;超参拒绝', () => {
    expect(parsePanelCommandArgs('verify')).toEqual({ op: 'verify' })
    expect(parsePanelCommandArgs('verify latest')).toEqual({ op: 'verify' })
    expect(parsePanelCommandArgs('verify session-abc')).toEqual({ op: 'verify', sessionId: 'session-abc' })
    expect(parsePanelCommandArgs('verify a b')).toBeUndefined()
  })
})
function getDisplayPrefsForTest(): { rows: { stock: boolean; total: boolean; money: boolean }; mode: 'full' | 'compact'; focusSessionId: string | null } {
  return getDisplayPrefs()
}

function mkdtempSyncForTest(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cci-ccip-'))
  dirs.push(dir)
  return dir
}
