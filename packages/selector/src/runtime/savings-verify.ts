/**
 * /ccip verify 验算核心:按会话 jsonl 原文独立重算节省六值,与持久 claims 对账。
 *
 * 口径纪律(用户定标):长度 = DeepSeek V4 词表 token,不是字符;tokenizer 资产
 * 不可用时报 unavailable 退化 chars/4 并在 basis 如实标注,绝不冒充精确值。
 * 索引:session uuid × turn/step × token 长度(原始事件与替换事件成对)。
 * 公式:毛 = a−b(原文−替换);全文读回时净 = −b(foldRecall a−(b+R) 下限);
 * 没有小裁剪 = 0。投影核心与 live 路径同一引擎(projectSavingsCore)。
 * 只读纪律:与回填同款,绝不写会话文件。
 *
 * @module dsh-context-compression-improved/runtime/savings-verify
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { deepSeekV4TokenizerForModel } from '../deepseek-v4-tokenizer.ts'
import { decodeSessionLogBytes } from './session-file-decode.ts'
import { discoverBackfillSessionLogs, type BackfillEventRecord } from './stats-backfill.ts'
import { unavailableTokenCount, type TokenCount } from './token-count.ts'
import { resolveStatsDshHome, type StatsDbPathOptions } from './stats-schema.ts'
import { getStatsActiveSessionId } from './stats-sync.ts'
import { getStatsStore, type StatsStore } from './stats-db.ts'

/** 单对替换的索引行:uuid 内按 turn/step 寻址,a=原文 b=替换(DS token)。 */
export interface VerifyIndexRow {
  turn: number
  step: number
  seq: number
  originalTokens: number
  replacementTokens: number
  gross: number
}

export interface SavingsVerifyReport {
  sessionId: string | undefined
  source: 'runtime-active' | 'explicit' | 'unresolved'
  turns: number
  indexedEvents: number
  pairs: VerifyIndexRow[]
  /** 结构/token 量取数来源:drs=投影直读(免解码);jsonl=解码重算兜底。 */
  indexSource: 'drs' | 'jsonl'
  formulaGross: number
  formulaOffsets: number
  formulaNet: number
  formulaBasis: string
  claimsGross: number
  claimsOffsets: number
  claimsNet: number
  claimsBasis: string
  /** DRS 投影只读对账面(投影库缺席/会话未同步时缺省)。 */
  drs?: DrsProjectionTotals | undefined
  /** DRS 投影的 turn/step 结构(仅 drs 主源模式;每 turn 聚合 token 量)。 */
  turnStructure?: DrsTurnRow[] | undefined
  verdict: 'match' | 'cross-basis' | 'no-claims' | 'no-jsonl' | 'no-session'
}

const CHARS_PER_TOKEN = 4

// ─────────────────────────── DRS 投影只读对账面(T6.3) ───────────────────────────

/** DRS(dsh-reference-session-collector)投影的对账汇总(公式口径:毛=Σ(a−b)、回吐=Σb)。 */
export interface DrsProjectionTotals {
  grossSaved: number
  recallTokens: number
  net: number
  compressPairs: number
  recallPairs: number
  /** 'ds-token' | 'chars/4'(DRS 落库时如实标注)。 */
  basis: string
  syncedAt: string
}

/** 投影库目录:与 DRS 插件同约定(env DSH_REFERENCE_SESSION_COLLECTOR_DIR > ~/.dsh-reference-session-collector)。 */
export function resolveDrsIndexDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env['DSH_REFERENCE_SESSION_COLLECTOR_DIR']
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh-reference-session-collector')
}

/**
 * 只读探一个会话的 DRS 投影对账值。纪律:DatabaseSync 只读打开,绝不写;
 * 库缺席/表不在/该会话未同步(无 sessions 行)一律 undefined,绝不抛——
 * DRS 未装/未同步时 verify 如实降级为无此行,不冒充数据。
 */
export function readDrsProjectionTotals(input: { sessionId: string; indexDir?: string }): DrsProjectionTotals | undefined {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(join(input.indexDir ?? resolveDrsIndexDir(), 'projection.db'), { readOnly: true })
  } catch {
    return undefined
  }
  try {
    const session = db.prepare('SELECT basis, synced_at FROM sessions WHERE session_id = ?')
      .get(input.sessionId) as { basis?: unknown; synced_at?: unknown } | undefined
    if (session === undefined) return undefined
    const agg = db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN kind <> 'recall' AND live = 1 THEN a_tokens - b_tokens END), 0) AS gross_saved,
         COALESCE(SUM(CASE WHEN kind = 'recall' THEN b_tokens END), 0) AS recall_tokens,
         COALESCE(SUM(CASE WHEN kind <> 'recall' THEN 1 ELSE 0 END), 0) AS compress_pairs,
         COALESCE(SUM(CASE WHEN kind = 'recall' THEN 1 ELSE 0 END), 0) AS recall_pairs
       FROM replaces WHERE session_id = ?`,
    ).get(input.sessionId) as {
      gross_saved?: unknown
      recall_tokens?: unknown
      compress_pairs?: unknown
      recall_pairs?: unknown
    }
    const grossSaved = typeof agg.gross_saved === 'number' ? agg.gross_saved : Number(agg.gross_saved ?? 0)
    const recallTokens = typeof agg.recall_tokens === 'number' ? agg.recall_tokens : Number(agg.recall_tokens ?? 0)
    return {
      grossSaved,
      recallTokens,
      net: grossSaved - recallTokens,
      compressPairs: Number(agg.compress_pairs ?? 0),
      recallPairs: Number(agg.recall_pairs ?? 0),
      basis: typeof session.basis === 'string' && session.basis !== '' ? session.basis : 'chars/4',
      syncedAt: typeof session.synced_at === 'string' ? session.synced_at : '?',
    }
  } catch {
    return undefined
  } finally {
    db.close()
  }
}

/** chars/4 兜底计数器(tokenizer 资产缺席时的如实降级)。 */
function charsCounter(): (text: string) => TokenCount {
  return () => unavailableTokenCount('chars/4 fallback (tokenizer asset unavailable)')
}

/** 解析 DS V4 tokenizer:flash → pro 逐个试,全缺席返回 undefined。 */
function resolveDsTokenizer(): ((text: string) => TokenCount) | undefined {
  for (const modelId of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
    const tokenizer = deepSeekV4TokenizerForModel(modelId)
    if (tokenizer !== undefined) return (text: string) => tokenizer.countText(text)
  }
  return undefined
}

/**
 * 单条事件的模型可见文本长度（DS token；富块按 0 计，与投影同款视界）。
 * 双臂视界（horizon v4，与 DRS modelTextBlocks 同形）：data.message.content[]
 * 缺席时退 data.content[]（user/message 与宿主 compact-checkpoint 替身形状；
 * 旧单臂把 checkpoint 摘要全计 0，b 侧漏记）。
 */
function eventTextTokens(event: BackfillEventRecord, counter: (text: string) => TokenCount): number {
  const data = event.data as { content?: unknown; message?: { content?: unknown } } | undefined
  const messageContent = data?.message?.content
  const content = Array.isArray(messageContent) ? messageContent : (Array.isArray(data?.content) ? data.content : undefined)
  if (!Array.isArray(content)) return 0
  let total = 0
  for (const block of content) {
    const text = (block as { text?: unknown })?.text
    if (typeof text === 'string' && text !== '') {
      const count = counter(text)
      if (count.kind === 'exact-tokenizer') total += count.tokens
      else total += Math.ceil(text.length / CHARS_PER_TOKEN)
    }
  }
  return total
}

/** 从目录发现里找目标会话的当前代产物并解码(只读)。 */
function readTargetSessionEvents(dshHome: string, sessionId: string): BackfillEventRecord[] | undefined {
  const discovered = discoverBackfillSessionLogs(dshHome)
  const found = discovered.find(entry => entry.dirSessionId === sessionId)
  if (found === undefined) return undefined
  try {
    // decoders 缺省 = 本地等价实现(fail-soft 同款);同步路径不加载官方解码器
    const log = decodeSessionLogBytes(readFileSync(found.artifact.path))
    return log.events as BackfillEventRecord[]
  } catch {
    return undefined
  }
}

/** DRS 投影的 turn/step 结构聚合行(每 turn:步数/token 量/段数)。 */
export interface DrsTurnRow {
  turn: number
  steps: number
  tokens: number
  segments: number
}

/** DRS 投影的替换对行(公式重算的直接来源,免再解码 jsonl)。 */
export interface DrsPairRow {
  seq: number
  startSeq: number
  endSeq: number
  aTokens: number
  bTokens: number
  kind: 'compress' | 'recall'
  turn: number
  step: number
  /** 1=替身仍在面（delta 生效）；0=已被后续 checkpoint 吸收，不入 gross。 */
  live: 0 | 1
}

/** DRS 投影的会话结构索引:turn/step 结构 × 段级 token 量 × 替换对(只读)。 */
export interface DrsSessionIndex {
  sessionId: string
  basis: string
  syncedAt: string
  maxSeq: number
  turnCount: number
  segments: number
  turns: DrsTurnRow[]
  pairs: DrsPairRow[]
}

/**
 * 直读一个会话的 DRS 结构索引(T6 深接:CCI 取 turn/step 结构与 token 量的
 * 主源)。纪律同 {@link readDrsProjectionTotals}:只读、库/会话缺席一律
 * undefined 绝不抛,调用方落 jsonl 兜底。
 */
export function readDrsSessionIndex(input: { sessionId: string; indexDir?: string }): DrsSessionIndex | undefined {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(join(input.indexDir ?? resolveDrsIndexDir(), 'projection.db'), { readOnly: true })
  } catch {
    return undefined
  }
  try {
    const session = db.prepare('SELECT basis, synced_at, max_seq, turn_count FROM sessions WHERE session_id = ?')
      .get(input.sessionId) as { basis?: unknown; synced_at?: unknown; max_seq?: unknown; turn_count?: unknown } | undefined
    if (session === undefined) return undefined
    const turnRows = db.prepare(
      `SELECT turn, COUNT(DISTINCT step) AS steps, SUM(tokens) AS tokens, COUNT(*) AS segments
       FROM segments WHERE session_id = ? GROUP BY turn ORDER BY turn`,
    ).all(input.sessionId) as { turn: number | bigint; steps: number | bigint; tokens: number | bigint; segments: number | bigint }[]
    const pairRows = db.prepare(
      'SELECT seq, start_seq, end_seq, a_tokens, b_tokens, kind, turn, step, live FROM replaces WHERE session_id = ? ORDER BY seq',
    ).all(input.sessionId) as {
      seq: number | bigint
      start_seq: number | bigint
      end_seq: number | bigint
      a_tokens: number | bigint
      b_tokens: number | bigint
      kind: unknown
      turn: number | bigint
      step: number | bigint
      live: number | bigint
    }[]
    const num = (value: unknown): number => (typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : 0)
    return {
      sessionId: input.sessionId,
      basis: typeof session.basis === 'string' && session.basis !== '' ? session.basis : 'chars/4',
      syncedAt: typeof session.synced_at === 'string' ? session.synced_at : '?',
      maxSeq: num(session.max_seq),
      turnCount: num(session.turn_count),
      segments: turnRows.reduce((sum, row) => sum + num(row.segments), 0),
      turns: turnRows.map(row => ({ turn: num(row.turn), steps: num(row.steps), tokens: num(row.tokens), segments: num(row.segments) })),
      pairs: pairRows.map(row => ({
        seq: num(row.seq),
        startSeq: num(row.start_seq),
        endSeq: num(row.end_seq),
        aTokens: num(row.a_tokens),
        bTokens: num(row.b_tokens),
        kind: row.kind === 'recall' ? 'recall' as const : 'compress' as const,
        turn: num(row.turn),
        step: num(row.step),
        live: num(row.live) === 1 ? 1 as const : 0 as const,
      })),
    }
  } catch {
    return undefined
  } finally {
    db.close()
  }
}

/**
 * 验算一个会话:jsonl 原文 × DS token 口径独立重算,与 claims 对账。
 * @param input.sessionId - 显式指定;缺省 = 运行时活跃指针,再退 store 最近压缩。
 */
export function verifySessionSavings(input: {
  sessionId?: string
  dshHome?: string
} & StatsDbPathOptions = {}): SavingsVerifyReport {
  const store: StatsStore | null = getStatsStore()
  const source: SavingsVerifyReport['source'] = input.sessionId !== undefined
    ? 'explicit'
    : getStatsActiveSessionId() !== undefined ? 'runtime-active' : 'unresolved'
  const sessionId = input.sessionId ?? getStatsActiveSessionId() ?? store?.latestActiveSessionId()
  const empty: SavingsVerifyReport = {
    sessionId, source, turns: 0, indexedEvents: 0, pairs: [],
    indexSource: 'jsonl',
    formulaGross: 0, formulaOffsets: 0, formulaNet: 0, formulaBasis: 'n/a',
    claimsGross: 0, claimsOffsets: 0, claimsNet: 0, claimsBasis: 'n/a',
    verdict: sessionId === undefined ? 'no-session' : 'no-jsonl',
  }
  if (sessionId === undefined) return empty

  // 取数主源(T6 深接):session id 感知后,turn/step 结构与 token 量从 DRS
  // 投影直读(免 jsonl 解码);投影库缺席/未同步该会话 → jsonl 解码重算兜底。
  const drsIndex = readDrsSessionIndex({ sessionId })
  const pairs: VerifyIndexRow[] = []
  let formulaGross = 0
  let formulaOffsets = 0
  let turns = 0
  let indexedEvents: number
  let formulaBasis: string
  let indexSource: 'drs' | 'jsonl'
  let turnStructure: DrsTurnRow[] | undefined
  let drsTotals: DrsProjectionTotals | undefined
  if (drsIndex !== undefined) {
    indexSource = 'drs'
    formulaBasis = drsIndex.basis
    turns = drsIndex.turnCount
    indexedEvents = drsIndex.segments
    turnStructure = drsIndex.turns
    for (const pair of drsIndex.pairs) {
      pairs.push({
        turn: pair.turn, step: pair.step, seq: pair.seq,
        originalTokens: pair.aTokens, replacementTokens: pair.bTokens, gross: pair.aTokens - pair.bTokens,
      })
      // live 过滤与 jsonl 兜底同语义：被 checkpoint 吸收的对不重复计费。
      if (pair.kind === 'compress') { if (pair.live === 1) formulaGross += pair.aTokens - pair.bTokens }
      else formulaOffsets += pair.bTokens
    }
    drsTotals = {
      grossSaved: formulaGross,
      recallTokens: formulaOffsets,
      net: formulaGross - formulaOffsets,
      compressPairs: drsIndex.pairs.filter(pair => pair.kind === 'compress').length,
      recallPairs: drsIndex.pairs.filter(pair => pair.kind === 'recall').length,
      basis: drsIndex.basis,
      syncedAt: drsIndex.syncedAt,
    }
  } else {
    indexSource = 'jsonl'
    const dshHome = resolveStatsDshHome(input)
    const events = existsSync(dshHome) ? readTargetSessionEvents(dshHome, sessionId) : undefined
    if (events === undefined || events.length === 0) return { ...empty, verdict: 'no-jsonl' }
    indexedEvents = events.length

    // turn/step 索引 + 替换成对(a=被替换原文,b=替换文本;DS token 口径)
    const tokenizer = resolveDsTokenizer()
    const counter = tokenizer ?? charsCounter()
    formulaBasis = tokenizer !== undefined ? 'ds-token' : 'chars/4'
    const tokensBySeq = new Map<number, number>()
    let turn = 0
    let step = 0
    for (const event of events) {
      const data = event.data as { turn?: unknown; step?: unknown } | undefined
      if (event.type === 'step/start' && data !== undefined) {
        if (typeof data.turn === 'number') turn = data.turn
        if (typeof data.step === 'number') step = data.step
        turns = Math.max(turns, turn)
      }
      tokensBySeq.set(Number(event.seq), eventTextTokens(event, counter))
    }
    // 两遍：先收全部替换对并累积覆盖集，再按 live 聚合——替身行被后续区间
    // 再覆盖则 delta 清除不入 gross（与 DRS replaces.live 及 projectSavingsCore
    // 「只算仍在 surface 的替换节点」同语义；checkpoint 只影响其后的积分）。
    const covered = new Set<number>()
    const rawPairs: { seq: number; a: number; b: number }[] = []
    for (const event of events) {
      const op = event.surfaceOp as { op?: unknown; startSeq?: unknown; endSeq?: unknown } | null | undefined
      if (op === null || typeof op !== 'object' || op.op !== 'replace') continue
      const start = Number(op.startSeq)
      const end = Number(op.endSeq)
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue
      let a = 0
      for (let seq = start; seq <= end; seq += 1) a += tokensBySeq.get(seq) ?? 0
      const b = tokensBySeq.get(Number(event.seq)) ?? 0
      rawPairs.push({ seq: Number(event.seq), a, b })
      for (let seq = start; seq <= end; seq += 1) covered.add(seq)
    }
    for (const { seq, a, b } of rawPairs) {
      // 用户定标公式：压缩对(b≤a)毛 += a−b；扩写对(全文读回，b>a)= 召回重查，
      // 抵消 += b。live 过滤：被后续 checkpoint 吸收的先前对不重复计费。
      if (b <= a) { if (!covered.has(seq)) formulaGross += a - b }
      else formulaOffsets += b
      pairs.push({ turn, step, seq, originalTokens: a, replacementTokens: b, gross: a - b })
    }
  }

  // claims 对账侧(回填 chars/4 口径;live 会话为落库精确/chars 混合)
  let claimsGross = 0
  let claimsOffsets = 0
  let claimsBasis = 'n/a'
  if (store !== null) {
    const agg = store.perSessionAggregates().find(row => row.sessionId === sessionId)
    if (agg !== undefined) {
      claimsGross = agg.gross.exact + agg.gross.estimated
      claimsOffsets = agg.offsets.exact + agg.offsets.estimated
      claimsBasis = agg.gross.exact > 0 ? 'exact-tokenizer' : 'chars/4'
    }
  }

  // DRS 投影侧:drs 主源模式复用同一次读库的产物;jsonl 兜底模式照旧探一次
  const drs = drsTotals ?? readDrsProjectionTotals({ sessionId })

  const verdict: SavingsVerifyReport['verdict'] = claimsGross === 0 && claimsOffsets === 0
    ? 'no-claims'
    : formulaBasis === 'chars/4' ? 'cross-basis' : 'match'
  return {
    sessionId, source, turns, indexedEvents, pairs,
    indexSource,
    formulaGross,
    formulaOffsets,
    formulaNet: formulaGross - formulaOffsets,
    formulaBasis,
    claimsGross, claimsOffsets, claimsNet: claimsGross - claimsOffsets, claimsBasis,
    ...(drs === undefined ? {} : { drs }),
    ...(turnStructure === undefined ? {} : { turnStructure }),
    verdict,
  }
}

/** 验算报告 → /ccip 文本行(紧凑,面板命令直接回显)。 */
export function formatVerifyReport(report: SavingsVerifyReport): string[] {
  if (report.verdict === 'no-session') return ['ccip verify: no session to verify']
  if (report.verdict === 'no-jsonl') return [`ccip verify: session ${report.sessionId ?? '?'} jsonl not found/readable`]
  const lines = [
    `ccip verify ${report.sessionId ?? '?'} (${report.source})`,
    `index(${report.indexSource}): ${report.indexedEvents} events · ${report.turns} turns · ${report.pairs.length} replacement pair(s)`,
    ...(report.turnStructure === undefined
      ? []
      : [`drs turns: ${report.turnStructure.slice(0, 4).map(row => `t${row.turn}·${row.tokens}tk·${row.steps}s`).join(' · ')}${report.turnStructure.length > 4 ? ' · …' : ''}`]),
    ...report.pairs.slice(0, 6).map(row =>
      `  t${row.turn}/s${row.step} seq${row.seq}: a=${row.originalTokens} − b=${row.replacementTokens} = +${row.gross} (${report.formulaBasis})`),
    `formula(${report.formulaBasis}): gross=${report.formulaGross} recall-offset=${report.formulaOffsets} net=${report.formulaNet}`,
    `claims(${report.claimsBasis}): gross=${report.claimsGross} recall-offset=${report.claimsOffsets} net=${report.claimsNet}`,
    ...(report.drs === undefined
      ? ['drs(projection): unavailable (projection.db absent or session not synced)']
      : [`drs(projection): gross=${report.drs.grossSaved} recall-offset=${report.drs.recallTokens} net=${report.drs.net} (${report.drs.basis}, synced ${report.drs.syncedAt})`]),
  ]
  if (report.verdict === 'no-claims') lines.push('verdict: claims empty for this session (nothing persisted yet)')
  else if (report.verdict === 'cross-basis') lines.push('verdict: tokenizer unavailable — formula fell back to chars/4; compare basis-by-basis only')
  else {
    const drift = Math.abs(report.formulaGross - report.claimsGross)
    const tolerance = Math.max(8, Math.ceil(Math.max(report.formulaGross, 1) * 0.35))
    lines.push(drift <= tolerance
      ? `verdict: match (drift ${drift} within cross-basis tolerance ±${tolerance})`
      : `verdict: cross-basis drift ${drift} (ds-token vs ${report.claimsBasis}; different metrics, both shown)`)
  }
  return lines
}

/** 面板命令入口:解析 + 执行 + 文本化。 */
export function verifySessionSavingsLines(input: { sessionId?: string } & StatsDbPathOptions = {}): string[] {
  return formatVerifyReport(verifySessionSavings(input))
}
