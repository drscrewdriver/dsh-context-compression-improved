/**
 * /ccip verify 验算核心规格:jsonl 原文 × turn/step 索引 × DS token 口径独立
 * 重算,与持久 claims 对账。verdict 语义:no-claims(无落账)/cross-basis
 * (tokenizer 缺席退 chars/4)/match(同口径对上)。运行时活跃指针同文件覆盖。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import zlib from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generationLogFilename } from '../../src/runtime/session-file-decode.ts'
import {
  formatVerifyReport, readDrsProjectionTotals, resolveDrsIndexDir, verifySessionSavings,
} from '../../src/runtime/savings-verify.ts'
import { getStatsActiveSessionId, noteStatsSessionActive } from '../../src/runtime/stats-sync.ts'
import { closeStatsStore } from '../../src/runtime/stats-db.ts'

const dirs: string[] = []

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cci-verify-${tag}-`))
  dirs.push(dir)
  return dir
}

/** 可解码 v4 会话目录:一条 400 字符 tool/result 被替换成 100 字符 + usage。 */
function writeSessionDir(dshHome: string, sessionId: string): void {
  const dir = join(dshHome, 'sessions', 'proj', sessionId)
  const header = JSON.stringify({ type: 'session', version: 4, id: sessionId, createdAt: 1, cwd: 'proj' })
  const rows = [
    JSON.stringify({ seq: 0, type: 'step/start', time: 1000, data: { turn: 3, step: 1 } }),
    JSON.stringify({ seq: 1, type: 'tool/result', time: 1001, data: { message: { content: [{ type: 'text', text: 'R'.repeat(400) }] } } }),
    JSON.stringify({ seq: 2, type: 'user/message', time: 1002, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 }, data: { message: { content: [{ type: 'text', text: 'S'.repeat(100) }] } } }),
    JSON.stringify({ seq: 3, type: 'assistant/message', time: 1003, data: { message: { content: [] }, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 50 } } }),
  ]
  const bytes = zlib.zstdCompressSync(Buffer.from([header, ...rows, ''].join('\n'), 'utf8'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, generationLogFilename(4, 'zstd')), bytes)
}

afterEach(() => {
  closeStatsStore()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('savings-verify(/ccip verify 验算核心)', () => {
  it('运行时活跃指针:note → get 幂等', () => {
    expect(getStatsActiveSessionId()).toBeUndefined()
    noteStatsSessionActive('session-abc')
    expect(getStatsActiveSessionId()).toBe('session-abc')
    noteStatsSessionActive('session-def')
    expect(getStatsActiveSessionId()).toBe('session-def')
  })

  it('fixture 重算:索引成对(a=400 字符原文,b=100 替换)、公式口径如实、claims 空判 no-claims', async () => {
    const home = tempDir('fixture')
    process.env['DSH_HOME'] = home
    writeSessionDir(home, 'session-verify-1')
    const statsDb = await import('../../src/runtime/stats-db.ts')
    await statsDb.ensureStatsStore(join(tempDir('db'), 'stats.sqlite'))

    const report = verifySessionSavings({ sessionId: 'session-verify-1' })
    expect(report.sessionId).toBe('session-verify-1')
    expect(report.indexedEvents).toBe(4)
    expect(report.formulaBasis === 'ds-token' || report.formulaBasis === 'chars/4').toBe(true)
    expect(report.pairs).toHaveLength(1)
    const pair = report.pairs[0]!
    expect(pair.turn).toBe(3)
    expect(pair.originalTokens).toBeGreaterThan(pair.replacementTokens)
    expect(pair.gross).toBe(pair.originalTokens - pair.replacementTokens)
    expect(report.formulaGross).toBe(150)
    expect(report.formulaNet).toBe(150)
    expect(report.verdict).toBe('no-claims')
    const lines = formatVerifyReport(report)
    expect(lines[0]).toContain('ccip verify session-verify-1')
    expect(lines.some(line => line.includes('formula('))).toBe(true)
    expect(lines.some(line => line.startsWith('verdict:'))).toBe(true)
    delete process.env['DSH_HOME']
  })

  it('live 清除链(jsonl 兜底臂):替身被后续区间再覆盖 → 先前对 delta 不入 gross,不双计', () => {
    // 链：seq1(R*400=200tk) →seq2 替(S*100=50tk) →seq3 checkpoint 覆盖 [1..2](C*80=40tk)。
    // 旧口径 gross=150+210=360（seq1 被两对重复计费）；live 清除后只计仍面对：250−40=210。
    const home = tempDir('livechain')
    process.env['DSH_HOME'] = home
    const sessionId = 'session-live-1'
    const dir = join(home, 'sessions', 'proj', sessionId)
    const header = JSON.stringify({ type: 'session', version: 4, id: sessionId, createdAt: 1, cwd: 'proj' })
    const rows = [
      JSON.stringify({ seq: 0, type: 'step/start', time: 1000, data: { turn: 1, step: 1 } }),
      JSON.stringify({ seq: 1, type: 'tool/result', time: 1001, data: { message: { content: [{ type: 'text', text: 'R'.repeat(400) }] } } }),
      JSON.stringify({ seq: 2, type: 'user/message', time: 1002, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 }, data: { content: [{ type: 'text', text: 'S'.repeat(100) }] } }),
      JSON.stringify({ seq: 3, type: 'user/message', time: 1003, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 }, data: { content: [{ type: 'text', text: 'C'.repeat(80) }] } }),
    ]
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, generationLogFilename(4, 'zstd')), zlib.zstdCompressSync(Buffer.from([header, ...rows, ''].join('\n'), 'utf8')))

    const report = verifySessionSavings({ sessionId })
    expect(report.indexSource).toBe('jsonl')
    expect(report.pairs).toHaveLength(2)
    // 双臂视界：checkpoint 摘要挂 data.content 也被计（旧单臂下 b=0）。
    const ckPair = report.pairs.find(p => p.seq === 3)!
    expect(ckPair.originalTokens).toBe(250)
    expect(ckPair.replacementTokens).toBeGreaterThan(0)
    // 只计仍面那对：seq2 被 [1..2] 吸收，其先前 delta 清除。
    expect(report.formulaGross).toBe(250 - ckPair.replacementTokens)
    delete process.env['DSH_HOME']
  })

  it('目标解析:显式 id 不存在 → no-jsonl;缺省且指针缺失 → no-session', async () => {
    const home = tempDir('resolve')
    process.env['DSH_HOME'] = home
    const statsDb = await import('../../src/runtime/stats-db.ts')
    await statsDb.ensureStatsStore(join(tempDir('db'), 'stats.sqlite'))
    expect(verifySessionSavings({ sessionId: 'session-missing' }).verdict).toBe('no-jsonl')
    const fallback = verifySessionSavings()
    expect(['no-session', 'no-jsonl']).toContain(fallback.verdict)
    delete process.env['DSH_HOME']
  })

  it('会话目录不存在时 dshHome 探测不抛错', () => {
    const home = tempDir('empty')
    process.env['DSH_HOME'] = home
    expect(existsSync(home)).toBe(true)
    const report = verifySessionSavings({ sessionId: 'session-none' })
    expect(report.verdict).toBe('no-jsonl')
    delete process.env['DSH_HOME']
  })

  it('DRS 投影只读探针:fixture 库在对账行如实;库/会话缺席 undefined 不冒充(T6.3)', () => {
    const indexDir = tempDir('drs')
    process.env['DSH_REFERENCE_SESSION_COLLECTOR_DIR'] = indexDir
    try {
      // 最小 projection.db(与 DRS L1 DDL 同名列);只读探针只认列名不认宿主。
      const db = new DatabaseSync(join(indexDir, 'projection.db'))
      db.exec(`
        CREATE TABLE sessions (session_id TEXT PRIMARY KEY, basis TEXT NOT NULL DEFAULT 'chars/4', synced_at TEXT NOT NULL DEFAULT '');
        CREATE TABLE replaces (
          session_id TEXT NOT NULL, seq INTEGER NOT NULL,
          a_tokens INTEGER NOT NULL, b_tokens INTEGER NOT NULL, kind TEXT NOT NULL,
          live INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (session_id, seq));
      `)
      db.prepare('INSERT INTO sessions (session_id, basis, synced_at) VALUES (?, ?, ?)').run('session-verify-1', 'ds-token', '2026-10-19 12:00:00')
      const insert = db.prepare('INSERT INTO replaces (session_id, seq, a_tokens, b_tokens, kind) VALUES (?, ?, ?, ?, ?)')
      insert.run('session-verify-1', 1, 400, 100, 'compress')
      insert.run('session-verify-1', 2, 0, 50, 'recall')
      db.close()

      expect(resolveDrsIndexDir({})).toContain('.dsh-reference-session-collector')
      expect(resolveDrsIndexDir({ DSH_REFERENCE_SESSION_COLLECTOR_DIR: '/custom' })).toBe('/custom')
      expect(readDrsProjectionTotals({ sessionId: 'session-verify-1', indexDir })).toEqual({
        grossSaved: 300, recallTokens: 50, net: 250, compressPairs: 1, recallPairs: 1, basis: 'ds-token', syncedAt: '2026-10-19 12:00:00',
      })
      // 会话未同步 → undefined;库缺席 → undefined;均不抛
      expect(readDrsProjectionTotals({ sessionId: 'session-unknown', indexDir })).toBeUndefined()
      expect(readDrsProjectionTotals({ sessionId: 'session-verify-1', indexDir: join(indexDir, 'absent') })).toBeUndefined()

      // verify 报告带 drs 行;缺库时如实标注 unavailable
      const home = tempDir('drs-report')
      process.env['DSH_HOME'] = home
      writeSessionDir(home, 'session-verify-1')
      const withDrs = verifySessionSavings({ sessionId: 'session-verify-1' })
      expect(withDrs.drs).toBeDefined()
      expect(formatVerifyReport(withDrs).some(line => line.startsWith('drs(projection): gross='))).toBe(true)
      process.env['DSH_REFERENCE_SESSION_COLLECTOR_DIR'] = join(tempDir('drs-absent'))
      const withoutDrs = verifySessionSavings({ sessionId: 'session-verify-1' })
      expect(withoutDrs.drs).toBeUndefined()
      expect(formatVerifyReport(withoutDrs).some(line => line.includes('drs(projection): unavailable'))).toBe(true)
      delete process.env['DSH_HOME']
    } finally {
      delete process.env['DSH_REFERENCE_SESSION_COLLECTOR_DIR']
    }
  })

  it('DRS 为主源:turn/step 结构与 token 量从投影直取,无 jsonl 也出公式(T6 深接)', () => {
    const indexDir = tempDir('drs-index')
    const home = tempDir('drs-index-home')
    process.env['DSH_HOME'] = home
    process.env['DSH_REFERENCE_SESSION_COLLECTOR_DIR'] = indexDir
    try {
      // 最小 projection.db:2 turn / 3 step,一压缩对 + 一召回对
      const db = new DatabaseSync(join(indexDir, 'projection.db'))
      db.exec(`
        CREATE TABLE sessions (session_id TEXT PRIMARY KEY, basis TEXT NOT NULL DEFAULT 'chars/4', synced_at TEXT NOT NULL DEFAULT '', max_seq INTEGER NOT NULL DEFAULT -1, turn_count INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE segments (session_id TEXT NOT NULL, seq INTEGER NOT NULL, turn INTEGER NOT NULL DEFAULT 0, step INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (session_id, seq));
        CREATE TABLE replaces (session_id TEXT NOT NULL, seq INTEGER NOT NULL, start_seq INTEGER NOT NULL, end_seq INTEGER NOT NULL, a_tokens INTEGER NOT NULL, b_tokens INTEGER NOT NULL, kind TEXT NOT NULL, turn INTEGER NOT NULL DEFAULT 0, step INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (session_id, seq));
      `)
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run('session-drs-1', 'ds-token', '2026-10-20 01:00:00', 9, 2)
      const seg = db.prepare('INSERT INTO segments (session_id, seq, turn, step, tokens) VALUES (?, ?, ?, ?, ?)')
      seg.run('session-drs-1', 1, 1, 1, 200)
      seg.run('session-drs-1', 2, 1, 2, 400)
      seg.run('session-drs-1', 5, 2, 1, 100)
      const rep = db.prepare('INSERT INTO replaces (session_id, seq, start_seq, end_seq, a_tokens, b_tokens, kind, turn, step) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      rep.run('session-drs-1', 3, 1, 2, 600, 120, 'compress', 1, 3)
      rep.run('session-drs-1', 6, 5, 5, 0, 100, 'recall', 2, 1)
      db.close()

      const report = verifySessionSavings({ sessionId: 'session-drs-1' })
      expect(report.indexSource).toBe('drs')
      expect(report.turns).toBe(2)
      expect(report.indexedEvents).toBe(3)
      expect(report.formulaGross).toBe(480)
      expect(report.formulaOffsets).toBe(100)
      expect(report.formulaNet).toBe(380)
      expect(report.pairs).toEqual([
        { turn: 1, step: 3, seq: 3, originalTokens: 600, replacementTokens: 120, gross: 480 },
        { turn: 2, step: 1, seq: 6, originalTokens: 0, replacementTokens: 100, gross: -100 },
      ])
      expect(report.turnStructure).toEqual([
        { turn: 1, steps: 2, tokens: 600, segments: 2 },
        { turn: 2, steps: 1, tokens: 100, segments: 1 },
      ])
      expect(report.drs).toMatchObject({ grossSaved: 480, recallTokens: 100, net: 380, basis: 'ds-token' })
      expect(report.verdict).toBe('no-claims')
      const lines = formatVerifyReport(report)
      expect(lines.some(line => line.startsWith('index(drs):'))).toBe(true)
      expect(lines.some(line => line.startsWith('drs turns: t1·600tk·2s'))).toBe(true)
    } finally {
      delete process.env['DSH_HOME']
      delete process.env['DSH_REFERENCE_SESSION_COLLECTOR_DIR']
    }
  })
})
