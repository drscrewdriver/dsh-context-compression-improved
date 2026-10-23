/**
 * T17：按 call 积分器规格——存量采样的单调性、召回回落、重启恢复、幂等重放，
 * 外加 usage 拆分与 T16 省钱加权（官方定价目录，定点无浮点）。
 *
 * 全部落临时目录库，绝不触碰真实 `~/.dsh`。采样输入的 net 由测试直接给定
 * （与 foldRecall 产出的负值形态同形；账本侧口径归 savings-accounting.spec）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { resolveOfficialDeepSeekPrice } from '../../src/runtime/deepseek-official-pricing.ts'
import {
  estimateIntegralMoney,
  latestEventSeq,
  sampleIntegralBoundary,
  splitCachedUncached,
} from '../../src/runtime/savings-integral.ts'
import { closeStatsStore, ensureStatsStore, getStatsStore } from '../../src/runtime/stats-db.ts'

const dirs: string[] = []

function tempDbPath(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cci-integral-${tag}-`))
  dirs.push(dir)
  return join(dir, 'stats.sqlite')
}

afterEach(() => {
  closeStatsStore()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function openStore(tag: string): Promise<string> {
  const path = tempDbPath(tag)
  const store = await ensureStatsStore(path)
  if (store === null || getStatsStore() === null) throw new Error('no sqlite driver in this environment')
  return path
}

function buildSession(id: string, eventCount: number): Session {
  const session = Session.create(SessionId(id))
  for (let index = 0; index < eventCount; index += 1) {
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `m${String(index)}` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  }
  return session
}

describe('savings-integral 采样核心（T15）', () => {
  it('无召回时累计单调不减：两次正存量采样 → Σ 递增', async () => {
    await openStore('mono')
    const session = buildSession('sess-mono', 2)
    sampleIntegralBoundary({ sessionId: 'sess-mono', session, net: { exact: 100, estimated: 400 } })
    const first = getStatsStore()?.sumSamples('sess-mono')
    expect(first?.calls).toBe(1)
    expect(first?.netExact).toBe(100)

    // 第二个边界（新事件 seq）存量上涨 → 累计 = 100+250
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'm2' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    sampleIntegralBoundary({ sessionId: 'sess-mono', session, net: { exact: 250, estimated: 1000 } })
    const second = getStatsStore()?.sumSamples('sess-mono')
    expect(second?.calls).toBe(2)
    expect(second?.netExact).toBe(350)
    expect(second!.netExact).toBeGreaterThanOrEqual(first!.netExact)
  })

  it('召回后存量转负 → 积分回落（前向口径，历史样本不改写）', async () => {
    await openStore('recall')
    const session = buildSession('sess-recall', 3)
    sampleIntegralBoundary({ sessionId: 'sess-recall', session, net: { exact: 500, estimated: 2000 } })
    // 召回翻负后的存量形态（foldRecall 下限 −b 的产物）
    sampleIntegralBoundary({ sessionId: 'sess-recall', session: appendOne(session), net: { exact: -80, estimated: -320 } })
    const totals = getStatsStore()?.sumSamples('sess-recall')
    expect(totals?.calls).toBe(2)
    expect(totals?.netExact).toBe(420)
    expect(totals!.netExact).toBeLessThan(500)
  })

  it('重启后从 store 恢复累计，同边界重放不重复计数', async () => {
    const path = await openStore('restart')
    const session = buildSession('sess-restart', 1)
    sampleIntegralBoundary({ sessionId: 'sess-restart', session, net: { exact: 120, estimated: 480 }, usage: { inputTokens: 1000, cacheReadTokens: 700 } })
    closeStatsStore()

    const reopened = await ensureStatsStore(path)
    expect(reopened).not.toBeNull()
    const restored = reopened?.sumSamples('sess-restart')
    expect(restored?.calls).toBe(1)
    expect(restored?.netExact).toBe(120)
    expect(restored?.cachedInput).toBe(700)
    expect(restored?.uncachedInput).toBe(300)

    // 同一边界重放：幂等键吸收，calls 不涨、Σ 不变
    sampleIntegralBoundary({ sessionId: 'sess-restart', session, net: { exact: 120, estimated: 480 }, usage: { inputTokens: 1000, cacheReadTokens: 700 } })
    const replayed = reopened?.sumSamples('sess-restart')
    expect(replayed?.calls).toBe(1)
    expect(replayed?.netExact).toBe(120)
  })

  it('空日志会话无从定键 → 静默跳过', async () => {
    await openStore('empty')
    const empty = Session.create(SessionId('sess-empty'))
    sampleIntegralBoundary({ sessionId: 'sess-empty', session: empty, net: { exact: 10, estimated: 40 } })
    expect(getStatsStore()?.sumSamples('sess-empty').calls).toBe(0)
  })

  it('latestEventSeq 取最大绝对 seq', () => {
    const session = buildSession('sess-seq', 3)
    expect(latestEventSeq(session)).toBe(2)
  })

  it('splitCachedUncached：命中拆分、负截零、非法记零', () => {
    expect(splitCachedUncached({ inputTokens: 1000, cacheReadTokens: 700 })).toEqual({ cachedInput: 700, uncachedInput: 300 })
    expect(splitCachedUncached({ inputTokens: 500, cacheReadTokens: 900 })).toEqual({ cachedInput: 900, uncachedInput: 0 })
    expect(splitCachedUncached({ inputTokens: -5, cacheReadTokens: Number.NaN })).toEqual({ cachedInput: 0, uncachedInput: 0 })
    expect(splitCachedUncached(undefined)).toEqual({ cachedInput: 0, uncachedInput: 0 })
  })
})

function appendOne(session: Session): Session {
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'next' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  return session
}

describe('省钱加权（T16）', () => {
  // 2026-08-29 是周六 → off-peak；flash USD off-peak = hit 0.007 / miss 0.22 /1M
  const offPeakRecord = resolveOfficialDeepSeekPrice({
    provider: 'deepseek-official',
    baseUrlClass: 'official-public',
    apiRoute: 'chat-completions',
    modelId: 'deepseek-v4-flash',
    currency: 'USD',
    at: new Date('2026-08-29T12:00:00Z'),
  })

  it('cached/uncached 分权计价：1M 命中 + 2M 未命中 = 0.007 + 0.44 USD', () => {
    expect(offPeakRecord.kind).toBe('priced')
    if (offPeakRecord.kind !== 'priced') return
    const money = estimateIntegralMoney({ cachedInput: 1_000_000, uncachedInput: 2_000_000, record: offPeakRecord.record })
    expect(money).not.toBeNull()
    expect(money?.currency).toBe('USD')
    expect(money?.band).toBe('off-peak')
    expect(money?.decimal).toBe('0.447')
  })

  it('零输入 token → null（无信息量行不渲染钱）', () => {
    if (offPeakRecord.kind !== 'priced') throw new Error('catalog unexpectedly unpriced')
    expect(estimateIntegralMoney({ cachedInput: 0, uncachedInput: 0, record: offPeakRecord.record })).toBeNull()
  })

  it('抽样行落库后经 sumSamples 聚合可供定价（端到端口径）', async () => {
    await openStore('money')
    const session = buildSession('sess-money', 2)
    sampleIntegralBoundary({ sessionId: 'sess-money', session, net: { exact: 50, estimated: 200 }, usage: { inputTokens: 3000, cacheReadTokens: 1000 } })
    const totals = getStatsStore()?.sumSamples('sess-money')
    expect(totals?.cachedInput).toBe(1000)
    expect(totals?.uncachedInput).toBe(2000)
    if (offPeakRecord.kind !== 'priced') throw new Error('catalog unexpectedly unpriced')
    // 1000×0.007/1M + 2000×0.22/1M = 0.000447 USD（小额输入,定点无浮点误差）
    const money = estimateIntegralMoney({
      cachedInput: totals?.cachedInput ?? 0,
      uncachedInput: totals?.uncachedInput ?? 0,
      record: offPeakRecord.record,
    })
    expect(money?.decimal).toBe('0.000447')
  })
})
