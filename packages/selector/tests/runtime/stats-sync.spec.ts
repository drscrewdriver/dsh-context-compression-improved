/**
 * live 写路径(T6–T9)单测:land/offset/usage 随写随刷对账、水位节流、
 * dispose 残量出口与写失败可见性。
 *
 * 全部落临时目录库,绝不触碰真实 `~/.dsh`;对账口径 = 内存账本 snapshot()
 * 与持久 claims 聚合逐列相等(spec T10 验收)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SavingsLedger } from '../../src/runtime/savings.ts'
import { sessionEvents } from '../../src/runtime/session-events.ts'
import { closeStatsStore, ensureStatsStore, getStatsStore } from '../../src/runtime/stats-db.ts'
import {
  cancelPendingUsageFlushes,
  claimFromLand,
  claimOffset,
  flushUsage,
  flushUsageOnDispose,
  reclaimFromTailTrim,
  scheduleUsageFlush,
} from '../../src/runtime/stats-sync.ts'

const dirs: string[] = []

function tempDbPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cci-sync-${name}-`))
  dirs.push(dir)
  return join(dir, 'stats.sqlite')
}

interface ClaimRow {
  session_id: string
  seq: number
  kind: string
  component: string
  basis: string
  tokens: number
}

function readClaims(path: string): ClaimRow[] {
  const db = new DatabaseSync(path)
  try {
    return db.prepare(
      `SELECT session_id, seq, kind, component, basis, tokens FROM claims ORDER BY session_id, seq, kind, component`,
    ).all() as unknown as ClaimRow[]
  } finally {
    db.close()
  }
}

function readSessionRow(path: string, sessionId: string): { version: number; source: string } | undefined {
  const db = new DatabaseSync(path)
  try {
    return db.prepare(`SELECT version, source FROM sessions WHERE session_id = ?`).get(sessionId) as unknown as { version: number; source: string } | undefined
  } finally {
    db.close()
  }
}

/** 最小会话构造:每条 assistant/message 带一份官方 usage。 */
function buildUsageSession(id: string, usages: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }[]): Session {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  usages.forEach((usage, index) => {
    session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: `answer ${String(index)}` }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4-flash' },
      }),
      usage,
    }, { surfaceOp: 'append' })
  })
  session.append('step/end', { turn: 1, step: 1 })
  return session
}

async function openStore(path: string): Promise<void> {
  const store = await ensureStatsStore(path)
  if (store === null) throw new Error('no sqlite driver in this environment')
}

/** 会话末尾事件的绝对 seq(水位断言用)。 */
function lastEventSeq(session: Session): number {
  const events = sessionEvents(session)
  return Number(events[events.length - 1]?.seq ?? 0)
}

afterEach(() => {
  cancelPendingUsageFlushes()
  closeStatsStore()
  vi.restoreAllMocks()
  vi.useRealTimers()
  while (dirs.length > 0) {
    const dir = dirs.pop()!
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows 句柄释放滞后时尽力而为 */ }
  }
})

describe('land/offset 随写随刷(T6:落库与内存账本对账)', () => {
  it('land→落库→snapshot 对账一致;重放幂等零新增', async () => {
    const path = tempDbPath('land')
    await openStore(path)
    const ledger = new SavingsLedger()
    ledger.recordSaving({
      sessionId: 's1',
      component: 'fresh',
      tokensBefore: 5_000,
      tokensAfter: 800,
      basis: 'exact-tokenizer',
      sourceSeq: 7,
      replacementSeq: 100,
    })
    claimFromLand({
      sessionId: 's1',
      component: 'fresh',
      tokensBefore: 5_000,
      tokensAfter: 800,
      basis: 'exact-tokenizer',
      replacementSeq: 100,
    })
    // 同点重放(如热重载后的重复 land 回执):PK 幂等,零新增
    claimFromLand({
      sessionId: 's1',
      component: 'fresh',
      tokensBefore: 5_000,
      tokensAfter: 800,
      basis: 'exact-tokenizer',
      replacementSeq: 100,
    })
    const rows = readClaims(path)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ session_id: 's1', seq: 100, kind: 'saving', component: 'fresh', basis: 'exact-tokenizer', tokens: 4_200 })
    // 持久聚合与内存 snapshot 逐列相等
    const store = getStatsStore()!
    const agg = store.perSessionAggregates().find(r => r.sessionId === 's1')
    expect(agg?.gross.exact).toBe(ledger.snapshot('s1').gross.exact)
    expect(agg?.net.exact).toBe(ledger.snapshot('s1').net.exact)
  })

  it('tokensRemoved ≤ 0 不入库(与内存账本同判据)', async () => {
    const path = tempDbPath('land-zero')
    await openStore(path)
    claimFromLand({ sessionId: 's1', component: 'fresh', tokensBefore: 100, tokensAfter: 100, basis: 'characters', replacementSeq: 3 })
    reclaimFromTailTrim({ sessionId: 's1', tokensBefore: 50, tokensAfter: 60, basis: 'characters', replacementSeq: 4 })
    expect(readClaims(path)).toHaveLength(0)
  })

  it('tail-trim 组回收落 saving claim,component 固定枚举值', async () => {
    const path = tempDbPath('tailtrim')
    await openStore(path)
    reclaimFromTailTrim({ sessionId: 's1', tokensBefore: 1_200, tokensAfter: 300, basis: 'characters', replacementSeq: 77 })
    const rows = readClaims(path)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ seq: 77, kind: 'saving', component: 'tail-trim', tokens: 900 })
  })

  it('retrieve 抵消落 offset claim;同源事件反复召回首记幂等去重(定键口径)', async () => {
    const path = tempDbPath('offset')
    await openStore(path)
    claimOffset({ sessionId: 's1', component: 'retrieve', tokens: 250, basis: 'characters', sourceSeq: 12 })
    claimOffset({ sessionId: 's1', component: 'retrieve', tokens: 180, basis: 'characters', sourceSeq: 12 })
    claimOffset({ sessionId: 's1', component: 'tailtrim-retrieve', tokens: 90, basis: 'characters', sourceSeq: 40 })
    const rows = readClaims(path)
    // (session_id, 源 seq, kind, component, basis) 主键:同源同组件重放去重;
    // 不同 component(不同恢复面)分列。
    expect(rows).toHaveLength(2)
    expect(rows.map(r => [r.kind, r.component, r.seq, r.tokens])).toEqual([
      ['offset', 'retrieve', 12, 250],
      ['offset', 'tailtrim-retrieve', 40, 90],
    ])
  })

  it('store 未开(无驱动/降级)= 空转不抛,warn 由 stats-db 的降级门闩负责', () => {
    expect(getStatsStore()).toBeNull()
    expect(() => claimFromLand({ sessionId: 's1', component: 'fresh', tokensBefore: 10, tokensAfter: 1, basis: 'characters', replacementSeq: 1 })).not.toThrow()
    expect(() => flushUsage(buildUsageSession('noop-open', [{ inputTokens: 1, outputTokens: 1 }]))).not.toThrow()
  })
})

describe('usage claims(T8:按事件求和 + 秒级 debounce + 水位节流)', () => {
  it('逐事件逐科目入账;二次 flush 零新增(水位节流);新事件只覆盖增量', async () => {
    const path = tempDbPath('usage')
    await openStore(path)
    const session = buildUsageSession('u1', [
      { inputTokens: 100, outputTokens: 40, cacheReadTokens: 900 },
      { inputTokens: 200, outputTokens: 60 },
    ])
    flushUsage(session)
    const first = readClaims(path)
    // 事件1:input/output/cacheRead 三科目;事件2:input/output 两科目
    expect(first).toHaveLength(5)
    expect(first.every(r => r.kind === 'usage' && r.basis === '')).toBe(true)
    const sum = (component: string): number => first.filter(r => r.component === component).reduce((a, r) => a + r.tokens, 0)
    expect(sum('input')).toBe(300)
    expect(sum('output')).toBe(100)
    expect(sum('cacheRead')).toBe(900)
    // 水位已前推到最新事件 seq:重放零新增
    const watermarkBefore = getStatsStore()!.getSessionWatermark('u1')
    expect(watermarkBefore).toBe(lastEventSeq(session))
    flushUsage(session)
    expect(readClaims(path)).toHaveLength(5)
    // 追加一条 usage 事件 → 下一次 flush 只补增量行
    session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'answer 3' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4-flash' },
      }),
      usage: { inputTokens: 7, outputTokens: 9 },
    }, { surfaceOp: 'append' })
    flushUsage(session)
    const after = readClaims(path)
    expect(after).toHaveLength(7)
    expect(getStatsStore()!.getSessionWatermark('u1')).toBe(lastEventSeq(session))
  })

  it('scheduleUsageFlush 一秒窗口内合并为一次扫描(debounce)', async () => {
    const path = tempDbPath('usage-debounce')
    await openStore(path)
    const session = buildUsageSession('u2', [{ inputTokens: 10, outputTokens: 2 }])
    vi.useFakeTimers()
    scheduleUsageFlush(session)
    scheduleUsageFlush(session)
    expect(readClaims(path)).toHaveLength(0) // 窗口内未刷
    await vi.advanceTimersByTimeAsync(1_000)
    expect(readClaims(path).length).toBeGreaterThan(0) // 到期一次 flush
  })

  it('dispose 取消在途 debounce 立即 flush 残量,并标记 source=live(T9)', async () => {
    const path = tempDbPath('dispose')
    await openStore(path)
    const session = buildUsageSession('u3', [{ inputTokens: 50, outputTokens: 10 }])
    scheduleUsageFlush(session)
    flushUsageOnDispose(session)
    expect(readClaims(path).some(r => r.kind === 'usage')).toBe(true)
    expect(readSessionRow(path, 'u3')?.source).toBe('live')
    // 零 usage 会话 dispose 也落会话行(面板 live/backfill 归属)
    const silent = Session.create(SessionId('u4'))
    flushUsageOnDispose(silent)
    expect(readSessionRow(path, 'u4')?.source).toBe('live')
  })
})

describe('写失败可见性(T10:门闩 warn 恰一次且不阻断主路径)', () => {
  it('recordClaims 注入抛错 → 多次调用只 warn 一次,调用方零异常', async () => {
    const path = tempDbPath('fail')
    await openStore(path)
    const store = getStatsStore()!
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(store, 'recordClaims').mockImplementation(() => {
      throw new Error('injected: disk full')
    })
    const input = { sessionId: 's1', component: 'fresh', tokensBefore: 900, tokensAfter: 100, basis: 'characters' as const, replacementSeq: 9 }
    expect(() => claimFromLand(input)).not.toThrow()
    expect(() => claimFromLand(input)).not.toThrow()
    expect(() => claimOffset({ sessionId: 's1', component: 'retrieve', tokens: 10, basis: 'characters', sourceSeq: 3 })).not.toThrow()
    expect(() => flushUsage(buildUsageSession('s9', [{ inputTokens: 1, outputTokens: 1 }]))).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[1])).toContain('disk full')
    // 压缩主路径(内存账本)完全不受影响:recordSaving 照常入账
    const ledger = new SavingsLedger()
    ledger.recordSaving({ sessionId: 's1', component: 'fresh', tokensBefore: 900, tokensAfter: 100, basis: 'characters', sourceSeq: 1 })
    expect(ledger.snapshot('s1').gross.estimated).toBe(800)
  })
})
