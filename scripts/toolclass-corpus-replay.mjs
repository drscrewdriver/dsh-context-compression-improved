#!/usr/bin/env node
/**
 * toolclass-corpus-replay.mjs — 真实日志离线复算(task_5 / G3)。
 *
 * 对 `~/.dsh/sessions/**\/session*.jsonl.zstd` 多帧 zstd 会话日志:
 *   扫魔数 28 B5 2F FD 逐帧解压(帧去重:并发写入会落重复帧)
 *   → 配对 tool/call ↔ tool/result(callId)
 *   → 直调 reduceFreshToolResult(内部无门槛,门槛在 planFresh;本脚本自带
 *     budgetChars 模拟,不测端到端 —— 必读①:验收必须在 reducer 层)
 *   → 输出 ToolClass 分发矩阵 / reducer 命中率 / 压缩率 / 误路由对照 /
 *     freshTriggerTokens 敏感性表。
 *
 * 用法:
 *   node scripts/toolclass-corpus-replay.mjs [--dir <sessionsDir>] [--limit <N>]
 *        [--session <substring>] [--min-chars <N>] [--budget-ratio <f>] [--out <report.md>]
 *
 * 依赖:先 `pnpm build` 生成 packages/selector/lib/pruner.js。
 * 样本偏差声明(必读⑨/RK-5):--limit 取的是体积最大的会话(偏长会话),
 * 结论不得外推到全体会话;报告须标注会话数/样本数/时间范围。
 * ⚠️ 口径标注:自 7a1972a(字符基准闸门)起,运行时决策按字符(characters)执行,
 * 本脚本输出的压缩率/预算均为 reducer 层字符口径;tokens 字段仅为遥测派生(chars/4.0),
 * 不得当作运行时决策依据。
 * ⚠️ --min-chars 默认 14000 只是**本脚本的样本过滤下限**,与运行时
 * `READ_TOC_MIN_CHARS`(reducers.ts)数值撞值但**毫无派生关系**:运行时的
 * fresh 门槛是 freshTriggerTokens(8192 tok ≈ 29.5k 字符),恒高于 14k 字符,
 * 本脚本过滤值从不参与运行时行为(findings §16)。
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const REPO_ROOT = join(import.meta.dirname, '..')
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function parseArgs(argv) {
  const args = {
    dir: join(homedir(), '.dsh', 'sessions'),
    limit: 20,
    session: '',
    minChars: 14_000,
    budgetRatio: 0.75,
    out: '',
  }
  for (let index = 2; index < argv.length; index++) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--dir') { args.dir = value; index++ }
    else if (key === '--limit') { args.limit = Number(value); index++ }
    else if (key === '--session') { args.session = value; index++ }
    else if (key === '--min-chars') { args.minChars = Number(value); index++ }
    else if (key === '--budget-ratio') { args.budgetRatio = Number(value); index++ }
    else if (key === '--out') { args.out = value; index++ }
    else { console.error(`unknown arg ${key}`); process.exit(2) }
  }
  return args
}

/** 多帧 zstd:扫魔数逐帧解压;对解出的 JSONL 行全局去重(等价于帧去重,
 *  且对"重复帧但行交错"的场景更稳)。 */
function decodeMultiFrameZstd(buffer) {
  const offsets = []
  let position = 0
  for (;;) {
    const index = buffer.indexOf(ZSTD_MAGIC, position)
    if (index < 0) break
    offsets.push(index)
    position = index + 1
  }
  const chunks = []
  let failedFrames = 0
  for (let index = 0; index < offsets.length; index++) {
    const chunk = buffer.subarray(offsets[index], index + 1 < offsets.length ? offsets[index + 1] : buffer.length)
    try {
      chunks.push(zstdDecompressSync(chunk))
    } catch {
      failedFrames += 1
    }
  }
  const seen = new Set()
  const lines = []
  for (const chunk of chunks) {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim() === '' || seen.has(line)) continue
      seen.add(line)
      lines.push(line)
    }
  }
  return { lines, frames: offsets.length, failedFrames }
}

function listSessionFiles(dir, sessionFilter) {
  const files = []
  const walk = current => {
    let entries
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.startsWith('session') && entry.name.endsWith('.jsonl.zstd')) files.push(path)
    }
  }
  walk(dir)
  return files.filter(path => sessionFilter === '' || path.includes(sessionFilter))
}

/** tool/call ↔ tool/result 配对;返回 {toolName, arguments, text, isError, seq, time}。 */
function extractToolResults(lines) {
  const calls = new Map()
  const results = []
  for (const line of lines) {
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event?.type === 'tool/call') {
      const callId = event.data?.callId
      if (typeof callId === 'string') {
        calls.set(callId, { name: event.data?.name ?? '', arguments: event.data?.arguments ?? '{}' })
      }
    } else if (event?.type === 'tool/result') {
      const message = event.data?.message
      const callId = message?.source?.callId
      const block = message?.content?.[0]
      const text = block?.content?.find(part => part?.type === 'text')?.text
      if (typeof callId !== 'string' || typeof text !== 'string') continue
      results.push({
        callId,
        toolName: calls.get(callId)?.name ?? '(unknown)',
        argumentsText: calls.get(callId)?.arguments ?? '{}',
        text,
        isError: block?.isError === true,
        seq: event.seq,
        time: event.time,
      })
    }
  }
  return results
}

/** v1 时代的旧分类(子串正则),仅用于误路由对照,不参与现行为。 */
function legacyIsSearchTool(name, command) {
  return /(?:grep|search|glob|find|ripgrep|rg)/.test(name)
    || /(?:^|\s)(?:rg|grep|find|fd)\s/.test(command)
}
function legacyCommandKeys(argumentsText) {
  try {
    const parsed = JSON.parse(argumentsText)
    if (typeof parsed !== 'object' || parsed === null) return ''
    for (const key of ['command', 'cmd', 'script', 'input']) {
      if (typeof parsed[key] === 'string') return parsed[key]
    }
  } catch { /* ignore */ }
  return ''
}

async function main() {
  const args = parseArgs(process.argv)
  const lib = await import(new URL(`file://${join(REPO_ROOT, 'packages/selector/lib/pruner.js').replace(/\\/g, '/')}`).href)
  const { reduceFreshToolResult, resolvePolicy, COMPRESSION_PROFILES } = lib
  if (typeof reduceFreshToolResult !== 'function') throw new Error('built lib missing reduceFreshToolResult — run `pnpm build` first')

  const policy = resolvePolicy({}, 'balanced')
  console.log(`[policy] balanced: freshTriggerTokens = ${policy.freshTriggerTokens} | freshTargetTokens = ${policy.freshTargetTokens} | freshEnabled = ${policy.freshEnabled}`)

  const files = listSessionFiles(args.dir, args.session)
    .map(path => ({ path, size: statSync(path).size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, args.limit)
  console.log(`[corpus] ${files.length} session file(s) (limit=${args.limit}, min-chars=${args.minChars}, dir=${args.dir})`)
  console.log(`[note] --min-chars is a sample filter for this script only; it is NOT the runtime READ_TOC_MIN_CHARS and does not gate runtime behavior`)

  const dispatch = new Map() // toolName → toolClass → { reducer → count }
  const reducerHits = new Map()
  const classTotals = new Map()
  const misroutes = []
  let totalIn = 0
  let totalOut = 0
  let reduced = 0
  let failOpen = 0
  let sessions = 0
  let minTime = Number.POSITIVE_INFINITY
  let maxTime = Number.NEGATIVE_INFINITY
  const readSizes = []

  for (const file of files) {
    sessions += 1
    const raw = readFileSync(file.path)
    const { lines, frames, failedFrames } = decodeMultiFrameZstd(raw)
    if (failedFrames > 0) console.warn(`  [warn] ${relative(args.dir, file.path)}: ${failedFrames}/${frames} frame(s) failed to decode`)
    for (const result of extractToolResults(lines)) {
      if (result.text.length < args.minChars) continue
      minTime = Math.min(minTime, result.time)
      maxTime = Math.max(maxTime, result.time)
      const budgetChars = Math.floor(result.text.length * args.budgetRatio)
      const output = reduceFreshToolResult({
        toolName: result.toolName,
        argumentsText: result.argumentsText,
        text: result.text,
        budgetChars,
        sourceRef: `session://replay/${String(result.seq)}`,
        isError: result.isError,
        codeSkeleton: true,
      })
      const command = legacyCommandKeys(result.argumentsText)
      const lowered = result.toolName.toLowerCase()
      const legacySearch = legacyIsSearchTool(lowered, command)
      const nowSearchRoute = output?.reducer === 'search-by-file' || output?.reducer === 'search-salience'
      if (legacySearch && !nowSearchRoute && misroutes.length < 20) {
        misroutes.push({
          tool: result.toolName,
          chars: result.text.length,
          head: Array.from(result.text.slice(0, 80).replace(/\n/g, '\\n')),
          now: output?.reducer ?? 'fail-open',
        })
      }
      void legacySearch
      // 分发矩阵:工具名 → 现派发 reducer → 计数
      const byTool = dispatch.get(result.toolName) ?? {}
      const key = output === null ? 'fail-open' : output.reducer
      byTool[key] = (byTool[key] ?? 0) + 1
      dispatch.set(result.toolName, byTool)
      reducerHits.set(key, (reducerHits.get(key) ?? 0) + 1)
      classTotals.set(result.toolName, (classTotals.get(result.toolName) ?? 0) + 1)
      totalIn += result.text.length
      if (output !== null) {
        reduced += 1
        totalOut += output.text.length
      } else {
        failOpen += 1
      }
      if (result.toolName.toLowerCase().match(/read|cat|view/)) readSizes.push(result.text.length)
    }
  }

  const lines = []
  lines.push(`# toolclass corpus replay — ${new Date().toISOString()}`)
  lines.push(`- sessions: ${sessions} (top by size; BIAS: favors long sessions — do not extrapolate)`)
  lines.push(`- sample window (event time): ${Number.isFinite(minTime) ? new Date(minTime).toISOString() : 'n/a'} … ${Number.isFinite(maxTime) ? new Date(maxTime).toISOString() : 'n/a'}`)
  lines.push(`- samples ≥ ${args.minChars} chars: ${reduced + failOpen} (reduced ${reduced}, fail-open ${failOpen})`)
  lines.push(`- verify pass rate (non-null): ${reduced + failOpen === 0 ? 'n/a' : `${(reduced / (reduced + failOpen) * 100).toFixed(1)}%`}`)
  lines.push(`- compression: ${totalIn} → ${totalOut} chars (${totalIn === 0 ? 'n/a' : `${(totalOut / totalIn * 100).toFixed(1)}%`})`)
  lines.push('')
  lines.push('## reducer hit rate')
  for (const [key, count] of [...reducerHits.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${key}: ${count}`)
  }
  lines.push('')
  lines.push('## dispatch matrix (toolName → reducer → count)')
  for (const [toolName, byReducer] of [...dispatch.entries()]
    .sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0))) {
    lines.push(`- ${toolName}: ${JSON.stringify(byReducer)}`)
  }
  lines.push('')
  lines.push('## fixed misroutes (legacy substring → search, now dispatched elsewhere)')
  for (const sample of misroutes) {
    lines.push(`- ${sample.tool} (${sample.chars} chars) → ${sample.now} | head: ${sample.head.join('')}`)
  }
  if (misroutes.length === 0) lines.push('- (none in this sample)')
  lines.push('')
  lines.push('## freshTriggerTokens sensitivity (read-class results, chars thresholds)')
  for (const trigger of [8_192, 6_144, 4_096, 2_048]) {
    const t36 = trigger * 3.6
    const t40 = trigger * 4.0
    const above36 = readSizes.filter(size => size > t36).length
    const above40 = readSizes.filter(size => size > t40).length
    lines.push(`- trigger ${trigger}: read samples > ${t40.toFixed(0)} chars (4.0 c/t): ${above40}/${readSizes.length}; > ${t36.toFixed(0)} (3.6 c/t): ${above36}/${readSizes.length}`)
  }
  lines.push('')
  lines.push(`> profiles available: ${COMPRESSION_PROFILES.join(', ')}`)
  const report = lines.join('\n')
  console.log('\n' + report)
  if (args.out !== '') {
    writeFileSync(args.out, report, 'utf8')
    console.log(`[written] ${args.out}`)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
