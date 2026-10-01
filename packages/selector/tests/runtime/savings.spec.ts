import { beforeEach, describe, expect, it } from 'vitest'
import { SavingsLedger, savingsHash } from '../../src/runtime/savings.ts'

/** 模拟 pruner land 的真实调用序列:先压缩,后全文重读。 */
describe('savings ledger(诚实口径)', () => {
  let ledger: SavingsLedger
  beforeEach(() => {
    ledger = new SavingsLedger()
  })

  it('compression saving lands: gross = tokensBefore − tokensAfter, zero-negative ignored', () => {
    ledger.recordSaving({
      sessionId: 's1',
      component: 'fresh',
      tokensBefore: 10_000,
      tokensAfter: 2_000,
      basis: 'exact-tokenizer',
      sourceSeq: 12,
      originalText: 'const a = 1\n'.repeat(500),
    })
    const snap = ledger.snapshot('s1')
    expect(snap.gross.exact).toBe(8_000)
    expect(snap.net.exact).toBe(8_000)
    // 无节省(没压掉任何东西)不入账
    ledger.recordSaving({ sessionId: 's1', component: 'fresh', tokensBefore: 100, tokensAfter: 100, basis: 'exact-tokenizer', sourceSeq: 13 })
    expect(ledger.snapshot('s1').gross.exact).toBe(8_000)
  })

  it('**先骨架后全文 = 负节省**:全文重读抵消原声称,净额可为负', () => {
    const original = 'export function readFile() {\n  // ...long body...\n}\n'.repeat(200)
    ledger.recordSaving({
      sessionId: 's1',
      component: 'fresh',
      tokensBefore: 5_000,
      tokensAfter: 800,
      basis: 'exact-tokenizer',
      sourceSeq: 7,
      originalText: original,
    })
    // 全文重读(同一原文 → 哈希配对):按全文计量记抵消
    ledger.noteFullText({
      sessionId: 's1',
      seq: 40,
      text: original,
      measure: () => ({ tokens: 5_000, basis: 'exact-tokenizer' }),
    })
    const snap = ledger.snapshot('s1')
    expect(snap.gross.exact).toBe(4_200)
    expect(snap.offsets.exact).toBe(5_000)
    expect(snap.net.exact).toBe(-800) // **负节省**
    expect(snap.recentOffsets).toHaveLength(1)
    expect(snap.recentOffsets[0]?.note).toContain('#7')
  })

  it('同一 (session, seq) 的全文只探测一次;抵消每个哈希只消费一次', () => {
    const text = 'payload-body\n'.repeat(100)
    ledger.recordSaving({ sessionId: 's1', component: 'history', tokensBefore: 900, tokensAfter: 100, basis: 'characters', sourceSeq: 3, originalText: text })
    const measure = () => ({ tokens: 900, basis: 'characters' as const })
    ledger.noteFullText({ sessionId: 's1', seq: 30, text, measure })
    ledger.noteFullText({ sessionId: 's1', seq: 30, text, measure }) // 同 seq 重放:忽略
    expect(ledger.snapshot('s1').offsets.estimated).toBe(900)
    ledger.noteFullText({ sessionId: 's1', seq: 31, text: text + '\n', measure }) // 新 seq、同哈希:已消费,不再抵消
    expect(ledger.snapshot('s1').offsets.estimated).toBe(900)
  })

  it('跨会话不串账;retrieve 抵消走估算口径分列', () => {
    const text = 'data\n'.repeat(50)
    ledger.recordSaving({ sessionId: 's1', component: 'fresh', tokensBefore: 1_000, tokensAfter: 100, basis: 'exact-tokenizer', sourceSeq: 1, originalText: text })
    ledger.noteFullText({ sessionId: 's2', seq: 1, text, measure: () => ({ tokens: 1_000, basis: 'exact-tokenizer' }) })
    expect(ledger.snapshot('s1').offsets.exact).toBe(0)
    ledger.recordOffset({ sessionId: 's1', component: 'retrieve', tokens: 300, basis: 'characters' })
    const snap = ledger.snapshot()
    expect(snap.net.exact).toBe(900)
    expect(snap.net.estimated).toBe(-300) // 口径分列:估算抵消不污染精确净额
    expect(snap.sessions).toBe(1)
  })

  it('savingsHash 规整行尾与首尾空白:同文件两次读取的 innocuous 差异仍配对', () => {
    expect(savingsHash('a\nb\r\nc')).toBe(savingsHash('a\nb\nc'))
    expect(savingsHash('  a\nb  ')).toBe(savingsHash('a\nb'))
    expect(savingsHash('a')).not.toBe(savingsHash('b'))
  })
})

describe('savings ledger(usage 聚合与分桶,monitor 口径)', () => {
  let ledger: SavingsLedger
  beforeEach(() => {
    ledger = new SavingsLedger()
  })

  it('aggregates official usage per session and computes cache hit rate', () => {
    ledger.recordUsage('s1', { inputTokens: 100, outputTokens: 500, cacheReadTokens: 9_000, cacheWriteTokens: 400 })
    ledger.recordUsage('s1', { inputTokens: 200, outputTokens: 300, cacheReadTokens: 8_000, cacheWriteTokens: 500 })
    const snap = ledger.snapshot('s1')
    expect(snap.usage.requests).toBe(2)
    expect(snap.usage.inputTokens).toBe(300)
    expect(snap.usage.cacheReadTokens).toBe(17_000)
    expect(snap.usage.cacheHitRate).toBeCloseTo(17_000 / 18_200, 3)
  })

  it('buckets sessions by net savings; per-session list only in global snapshot', () => {
    ledger.recordUsage('s1', { inputTokens: 10, outputTokens: 1, cacheReadTokens: 90, cacheWriteTokens: 0 })
    ledger.recordUsage('s2', { inputTokens: 10, outputTokens: 1, cacheReadTokens: 10, cacheWriteTokens: 0 })
    ledger.recordSaving({ sessionId: 's2', component: 'fresh', tokensBefore: 500, tokensAfter: 100, basis: 'exact-tokenizer', sourceSeq: 1 })
    const global = ledger.snapshot()
    expect(global.perSession).toHaveLength(2)
    expect(global.perSession[0]!.sessionId).toBe('s2')
    expect(global.perSession[0]!.cacheHitRate).toBe(0.5)
    const single = ledger.snapshot('s1')
    expect(single.perSession).toHaveLength(0)
  })

  it('sessionSummaryLine renders one-line account for dispose log', () => {
    ledger.recordUsage('s1', { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 0 })
    ledger.recordSaving({ sessionId: 's1', component: 'fresh', tokensBefore: 400, tokensAfter: 100, basis: 'exact-tokenizer', sourceSeq: 2 })
    const line = ledger.sessionSummaryLine('s1')
    expect(line).toContain('net=300(exact)/0(est)')
    expect(line).toContain('cacheHit=90%')
  })
})
