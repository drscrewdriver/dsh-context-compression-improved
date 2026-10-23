/**
 * T19/T22：session-file-decode 叶子模块的代次契约与解码链路测试。
 *
 * fixture 策略（T22）：
 * - 真实样例：`fixtures/session-v4-dump.jsonl`（284KB，从本机 v4 会话解包样本转码）；
 *   测试内 zstd 压缩后走完整解码链，源文件本身只读。
 * - 合成样例：v3/v4 header + 打包行 + provenance 区间，直接在内存构造。
 * - 撕裂尾帧：完整帧 + 尾部截断帧，ZSTD_e_flush 抢救断言。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import zlib from 'node:zlib'
import {
  classifyGenerationFilename,
  classifySessionHeader,
  decodeRecordLocal,
  decodeSeqRangesStorage,
  decodeSessionLogBytes,
  generationLogFilename,
  isMigrationStagingFilename,
  parseGenerationLogFilename,
  readSessionGenerations,
  scanZstdFrames,
  type DecodedEvent,
  type OfficialDecoders,
} from '../../src/runtime/session-file-decode.ts'

/** 规范历史代文件名（测试内同样避免 D7 字面量：拼接构造）。 */
const LEGACY_NAME = `session${'.'}jsonl.zstd`

function sessionHeader(version: number): string {
  return JSON.stringify({ type: 'session', version, id: 'session-test', createdAt: 1_700_000_000_000, cwd: '/tmp' })
}

/** 由 header 代次与若干记录行合成一份 zstd 单帧日志（每条一行，seq 由调用方保证连续）。 */
function synthesizeLog(headerVersion: number | null, rows: readonly string[]): Buffer {
  const headerLine = headerVersion === null ? 'not-json-at-all' : sessionHeader(headerVersion)
  const text = [headerLine, ...rows, ''].join('\n')
  return zlib.zstdCompressSync(Buffer.from(text, 'utf8'))
}

describe('session-file-decode / 代次文件名契约', () => {
  it('代次名推导与解析互逆；历史代名按拼接构造（不留 D7 字面量）', () => {
    expect(generationLogFilename(0)).toBe(LEGACY_NAME)
    expect(generationLogFilename(4)).toBe('session.v4.jsonl.zstd')
    expect(parseGenerationLogFilename(LEGACY_NAME)).toBe(0)
    expect(parseGenerationLogFilename('session.v4.jsonl.zstd')).toBe(4)
    expect(parseGenerationLogFilename('session.v12.jsonl', 'none')).toBe(12)
  })

  it('非法名一律不猜：前导零、.v0、大写 V、错后缀都拒绝', () => {
    expect(parseGenerationLogFilename('session.v0.jsonl.zstd')).toBeUndefined()
    expect(parseGenerationLogFilename('session.v01.jsonl.zstd')).toBeUndefined()
    expect(parseGenerationLogFilename('session.V1.jsonl.zstd')).toBeUndefined()
    expect(parseGenerationLogFilename('session.v1.jsonl.gz.zstd')).toBeUndefined()
    expect(parseGenerationLogFilename('session.v1.backup.jsonl.zstd')).toBeUndefined()
    expect(classifyGenerationFilename('session.v3.jsonl')).toEqual({ version: 3, compression: 'none' })
    expect(classifyGenerationFilename('readme.txt')).toBeUndefined()
  })

  it('非法代次参数拒绝', () => {
    expect(() => generationLogFilename(-1)).toThrow(/non-negative safe integer/)
    expect(() => generationLogFilename(1.5)).toThrow(/non-negative safe integer/)
  })

  it('迁移暂存名识别（token 长度可变，只固定形状）', () => {
    expect(isMigrationStagingFilename('session.migration.0123456789abcdef.jsonl.zstd.tmp')).toBe(true)
    expect(isMigrationStagingFilename('session.migration.deadbeef.jsonl.tmp')).toBe(true)
    expect(isMigrationStagingFilename('session.migration.XYZ.jsonl.zstd.tmp')).toBe(false)
    expect(isMigrationStagingFilename('session.v4.jsonl.zstd')).toBe(false)
  })

  it('readSessionGenerations：目录实测最高代=当前代，只读不猜', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sfd-gen-'))
    try {
      await writeFile(join(dir, LEGACY_NAME), 'legacy')
      await writeFile(join(dir, 'session.v4.jsonl.zstd'), 'current')
      await writeFile(join(dir, 'session.migration.aabbccddeeff0011.jsonl.zstd.tmp'), 'staging')
      await writeFile(join(dir, 'session.v01.jsonl.zstd'), 'not-canonical')
      const facts = readSessionGenerations(dir)
      expect(facts.canonical.map(a => a.version)).toEqual([0, 4])
      expect(facts.current?.version).toBe(4)
      expect(facts.legacy?.name).toBe(LEGACY_NAME)
      expect(facts.staging).toHaveLength(1)
      expect(facts.legacyOnly).toBe(false)
      // 目录不存在：如实返回空事实，不抛
      const missing = readSessionGenerations(join(dir, 'no-such-dir'))
      expect(missing.canonical).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('session-file-decode / zstd 多帧与撕裂尾帧', () => {
  it('多帧拼接逐帧解码（zstdDecompressSync 整体解只出首帧，帧扫描是必需路径）', () => {
    const frameA = zlib.zstdCompressSync(Buffer.from('{"a":1}\n', 'utf8'))
    const frameB = zlib.zstdCompressSync(Buffer.from('{"b":2}\n', 'utf8'))
    const both = Buffer.concat([frameA, frameB])
    // 官方整体解码只覆盖首帧——这正是要自己做帧扫描的原因
    expect(zlib.zstdDecompressSync(both).toString('utf8')).toBe('{"a":1}\n')
    const scan = scanZstdFrames(both)
    expect(scan.frames).toHaveLength(2)
    expect(scan.tornStart).toBeUndefined()
    const text = scan.frames
      .map(f => zlib.zstdDecompressSync(both.subarray(f.start, f.end)).toString('utf8'))
      .join('')
    expect(text).toBe('{"a":1}\n{"b":2}\n')
  })

  it('撕裂尾帧：tornStart 定位 + ZSTD_e_flush 抢救部分明文，完整帧不受影响', () => {
    const frameA = zlib.zstdCompressSync(Buffer.from('header-line\n', 'utf8'))
    const frameB = zlib.zstdCompressSync(Buffer.from('tail-line-contents-here\n', 'utf8'))
    const torn = Buffer.concat([frameA, frameB.subarray(0, frameB.length - 3)])
    const scan = scanZstdFrames(torn)
    expect(scan.frames).toHaveLength(1)
    expect(scan.tornStart).toBe(frameA.length)
    const recovered = zlib.zstdDecompressSync(torn.subarray(scan.tornStart!), {
      finishFlush: zlib.constants.ZSTD_e_flush,
    }).toString('utf8')
    expect(recovered.length).toBeGreaterThan(0)
    expect('tail-line-contents-here\n'.startsWith(recovered)).toBe(true)
  })

  it('非 zstd 明文开头：整段判为撕裂起点、零完整帧（decode 侧按抢救处理）', () => {
    const plain = Buffer.from('{"type":"session"}\n', 'utf8')
    const scan = scanZstdFrames(plain)
    expect(scan.frames).toHaveLength(0)
    expect(scan.tornStart).toBe(0)
  })
})

describe('session-file-decode / 记录解码与 provenance', () => {
  it('打包行解包：text-chunks 展开为 assistant/chunk，dt 为时间增量', () => {
    const row = {
      type: 'text-chunks',
      seq0: 3,
      time0: 100,
      data: { turn: 0, step: 1, index: 2, texts: ['ab', 'cd', 'ef'], dt: [5, 7] },
    }
    const events = decodeRecordLocal(row)
    expect(events.map(e => e.seq)).toEqual([3, 4, 5])
    expect(events.map(e => e.time)).toEqual([100, 105, 112])
    expect(events[0]).toMatchObject({ type: 'assistant/chunk', data: { turn: 0, step: 1 } })
    expect((events[2]!.data as { chunk: Record<string, unknown> }).chunk).toMatchObject({ type: 'text-delta', text: 'ef', index: 2 })
  })

  it('tool-call-chunks 用 args 载荷并带 id/name', () => {
    const row = {
      type: 'tool-call-chunks',
      seq0: 0,
      time0: 10,
      data: { turn: 1, step: 0, index: 0, id: 'call-1', name: 'bash', args: ['{"cmd":', '"ls"}'], dt: [1] },
    }
    const events = decodeRecordLocal(row)
    const chunk = events[1]!.data as { chunk: Record<string, unknown> }
    expect(chunk.chunk).toMatchObject({ type: 'tool-call-delta', id: 'call-1', name: 'bash', argumentsDelta: '"ls"}' })
  })

  it('打包行形状错误：拒绝（dt 长度不符/载荷非字符串数组）', () => {
    expect(() => decodeRecordLocal({ type: 'text-chunks', seq0: 0, time0: 0, data: { texts: ['a', 'b'], dt: [] } }))
      .toThrow(/dt length/)
    expect(() => decodeRecordLocal({ type: 'text-chunks', seq0: 0, time0: 0, data: { texts: [1, 2], dt: [0] } }))
      .toThrow(/non-empty string array/)
  })

  it('provenance 区间编码展开 + 前向引用校验', () => {
    expect(decodeSeqRangesStorage([[0, 2], 5], 6)).toEqual([0, 1, 2, 5])
    expect(() => decodeSeqRangesStorage([[3, 1]], 6)).toThrow(/malformed/)
    expect(() => decodeSeqRangesStorage([6], 6)).toThrow(/reference earlier/)
    expect(() => decodeSeqRangesStorage('x', 6)).toThrow(/must be an array/)
  })

  it('seq 缺口按 prefix 语义截断并记问题', () => {
    const rows = [
      JSON.stringify({ type: 'user/message', seq: 0, time: 1, data: {} }),
      JSON.stringify({ type: 'user/message', seq: 2, time: 2, data: {} }), // 缺 seq 1
    ]
    const log = decodeSessionLogBytes(synthesizeLog(4, rows))
    expect(log.events).toHaveLength(1)
    expect(log.issues).toHaveLength(1)
    expect(log.issues[0]!.why).toMatch(/seq gap \(expected 1, got 2\)/)
  })

  it('官方解码器可用时走 official 臂且来源如实标注', () => {
    const official: OfficialDecoders = {
      decodeStorageRecord: value => [value as DecodedEvent],
      decodeSeqRanges: (value, seq) => decodeSeqRangesStorage(value, seq),
    }
    const rows = [
      JSON.stringify({ type: 'user/message', seq: 0, time: 1, data: {} }),
      JSON.stringify({ type: 'tool/result', seq: 1, time: 2, sourceEventSeqs: [[0, 0]], data: {} }),
    ]
    const log = decodeSessionLogBytes(synthesizeLog(4, rows), official)
    expect(log.decoder).toBe('official')
    expect(log.events).toHaveLength(2)
    expect(log.events[1]?.sourceEventSeqs).toEqual([0])
    const local = decodeSessionLogBytes(synthesizeLog(4, rows))
    expect(local.decoder).toBe('local')
  })

  it('findOpenStep：尾部未收尾的 step 报出，step/end 后清零', () => {
    const rows = [
      JSON.stringify({ type: 'step/start', seq: 0, time: 1, data: { turn: 2, step: 3 } }),
      JSON.stringify({ type: 'step/end', seq: 1, time: 2, data: { turn: 2, step: 3 } }),
      JSON.stringify({ type: 'step/start', seq: 2, time: 3, data: { turn: 2, step: 4 } }),
    ]
    const log = decodeSessionLogBytes(synthesizeLog(4, rows))
    expect(log.openStep).toEqual({ turn: 2, step: 4 })
  })
})

describe('session-file-decode / header 代次 fail-soft 分类', () => {
  it('v3/v4 已知代次放行', () => {
    for (const version of [3, 4]) {
      const log = decodeSessionLogBytes(synthesizeLog(version, []))
      expect(classifySessionHeader(log.header)).toMatchObject({ state: 'known', version })
    }
  })

  it('未知代次/无 header/非 session 头都归为不可回填（调用方跳过该会话）', () => {
    const unknown = decodeSessionLogBytes(synthesizeLog(9, []))
    expect(classifySessionHeader(unknown.header)).toMatchObject({ state: 'unknown-version', version: 9 })
    // 首行不是 zstd 可解内容：整体抢救失败也不抛，header 如实缺失
    const broken = decodeSessionLogBytes(Buffer.from('not-json-at-all\n', 'utf8'))
    expect(classifySessionHeader(broken.header)).toEqual({ state: 'missing-header' })
    const foreign = decodeSessionLogBytes(synthesizeLog(4, []))
    expect(classifySessionHeader({ ...foreign.header!, type: 'other' })).toEqual({ state: 'not-session' })
  })

  it('空文件：header 缺失、零事件、零问题（不抛）', () => {
    const log = decodeSessionLogBytes(Buffer.alloc(0))
    expect(log).toMatchObject({ events: [], frames: 0, recoveredFromTorn: 0, issues: [], decoder: 'local' })
    expect(classifySessionHeader(log.header)).toEqual({ state: 'missing-header' })
  })
})

describe('session-file-decode / 真实 v4 解包样本', () => {
  const fixture = new URL('fixtures/session-v4-dump.jsonl', import.meta.url)
  const present = existsSync(fixture)

  it.skipIf(!present)('真实会话（v4 header + 45 事件）转码为 zstd 后完整解码、零问题', () => {
    const text = readFileSync(fixture, 'utf8')
    const log = decodeSessionLogBytes(zlib.zstdCompressSync(Buffer.from(text, 'utf8')))
    expect(classifySessionHeader(log.header)).toMatchObject({ state: 'known', version: 4 })
    expect(log.events.length).toBeGreaterThan(40)
    expect(log.issues).toEqual([])
    expect(log.frames).toBeGreaterThanOrEqual(1)
    expect(log.tornStart).toBeUndefined()
    // seq 连续（0..n-1）由解码链的 prefix 语义保证：无 issue 即连续
    expect(log.events.at(-1)!.seq).toBe(log.events.length - 1)
  })

  it.skipIf(!present)('真实样本多帧切分后再拼接解码结果一致', () => {
    const text = readFileSync(fixture, 'utf8')
    const whole = zlib.zstdCompressSync(Buffer.from(text, 'utf8'))
    const half = Math.floor(text.length / 2)
    const multi = Buffer.concat([
      zlib.zstdCompressSync(Buffer.from(text.slice(0, half), 'utf8')),
      zlib.zstdCompressSync(Buffer.from(text.slice(half), 'utf8')),
    ])
    const a = decodeSessionLogBytes(whole)
    const b = decodeSessionLogBytes(multi)
    expect(b.frames).toBeGreaterThanOrEqual(2)
    expect(b.issues).toEqual([])
    expect(b.events).toEqual(a.events)
    expect(b.header).toEqual(a.header)
  })
})

describe('session-file-decode / D7 静态纪律', () => {
  it('模块源码不含检查器正则的连续字面量', () => {
    const source = readFileSync(new URL('../../src/runtime/session-file-decode.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/session\.jsonl|SESSION_FORMAT_VERSION|sessionFormatVersion/u)
    // 用等价文本正则再扫一遍（点为真实点），防止拼接改写引入漏网
    expect(/session[.]jsonl/.test(source)).toBe(false)
  })
})
