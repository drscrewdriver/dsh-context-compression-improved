/**
 * 会话日志投影：重进/重启会话后按 JSON 重建节省账。
 *
 * 内存账本随进程重启归零；但每次压缩都 durable 地留在 append-only 的 Session
 * 日志里：
 *  - 替换事件带 `surfaceOp { op:'replace', startSeq, endSeq }`（"保留在会话里
 *    的内容"）；
 *  - 被替换的原始事件仍在日志中（只是移出 surface），可原样定价。
 *
 * 本模块只读地重算与实时账本同口径的两样东西：
 *  - **当前生效毛节省（仪表）**：遍历当前 surface 的替换节点，累加
 *    `price(原始) − price(替换)`；替换已离开 surface 的自然不计。
 *  - **每次重读惩罚**：按 seq 顺序走日志，凡命中"此前被压缩过的原文"的普通
 *    工具结果都记一条 `full-read` 负项（不去重、不一次性消费）。
 *
 * fail-open：无法定价（富内容、缺 tokenizer）的节点跳过，绝不抛给主流程。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { sessionEvents } from './session-events.ts'
import { measureForCompaction } from './measurement.ts'
import { countExactCanonicalTextFields, type TokenCount } from './token-count.ts'
import { pressureCost } from '../pruner/content.ts'
import { viewToolResult } from '../compat/tool-result.ts'
import { flattenPlainText } from './tokenpilot/dedup.ts'
import { charsToTokens } from './config.ts'
import { savingsHash, type SavingsBasis } from './savings.ts'

/** 最小计价面：只需一个把文本换成 TokenCount 的规范化计数器。 */
export type SavingsTextCounter = (text: string) => TokenCount

export interface ProjectedSaving {
  component: string
  tokens: number
  basis: SavingsBasis
  at: number
  replacementSeq: number
}
export interface ProjectedOffset {
  component: 'full-read'
  tokens: number
  basis: SavingsBasis
  at: number
  /** 重读事件的绝对 seq（持久 claims 主键需要；投影条目靠它定位到日志行）。 */
  seq: number
  note: string
}
export interface ProjectedRegistryItem {
  hash: string
  claimedTokens: number
  basis: SavingsBasis
  sourceSeq: number
}
export interface SessionSavingsProjection {
  savings: ProjectedSaving[]
  offsets: ProjectedOffset[]
  registry: ProjectedRegistryItem[]
}

interface Priced {
  tokens: number
  basis: SavingsBasis
  chars: number
}

const EMPTY: SessionSavingsProjection = Object.freeze({ savings: [], offsets: [], registry: [] })

function blocksOf(event: SessionEvent): readonly ContentBlock[] | undefined {
  if (event.type !== 'tool/result') return undefined
  return viewToolResult(event.data.message).blocks as ContentBlock[]
}

function textOf(event: SessionEvent): string | undefined {
  const blocks = blocksOf(event)
  return blocks === undefined ? undefined : flattenPlainText(blocks)
}

/** 与 pruner 的 `plan()` 同口径定价：全文本块可精确，否则字符口径。 */
function priceEvent(event: SessionEvent, countText: SavingsTextCounter): Priced | undefined {
  const blocks = blocksOf(event)
  if (blocks === undefined) return undefined
  const chars = pressureCost(blocks)
  if (chars <= 0) return undefined
  const texts = blocks.map(block => (block.type === 'text' ? block.text : undefined))
  if (texts.every((text): text is string => text !== undefined)) {
    const count = countExactCanonicalTextFields(texts, countText, 'savings projection')
    if (count.kind === 'exact-tokenizer') return { tokens: count.tokens, basis: 'exact-tokenizer', chars }
  }
  return { tokens: Math.max(1, charsToTokens(chars)), basis: 'characters', chars }
}

/** 替换事件的被替换 span；非替换节点（或畸形 op）返回 undefined。 */
function replacedSpan(event: SessionEvent): { start: number; end: number } | undefined {
  const op = event.surfaceOp as { op?: unknown; startSeq?: unknown; endSeq?: unknown } | 'append' | undefined
  if (typeof op !== 'object' || op === null || op.op !== 'replace') return undefined
  const start = Number(op.startSeq)
  const end = Number(op.endSeq)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  return { start, end }
}

function originalText(bySeq: ReadonlyMap<number, SessionEvent>, span: { start: number; end: number }): string {
  const parts: string[] = []
  for (let seq = span.start; seq <= span.end; seq++) {
    const event = bySeq.get(seq)
    const text = event === undefined ? undefined : textOf(event)
    if (text !== undefined && text.length > 0) parts.push(text)
  }
  return parts.join('\n')
}

/**
 * 一个替换节点"压掉了多少"（与实时 `plan()` 同口径：差额>0 才算）。
 * 原始价 = span 内原始事件之和；替换价 = 替换事件。
 */
function computeDelta(
  bySeq: ReadonlyMap<number, SessionEvent>,
  replacement: SessionEvent,
  span: { start: number; end: number },
  counter: SavingsTextCounter,
): { tokens: number; basis: SavingsBasis } | undefined {
  const after = priceEvent(replacement, counter)
  if (after === undefined) return undefined
  let beforeChars = 0
  let beforeExactTokens = 0
  let beforeExact = true
  let any = false
  for (let seq = span.start; seq <= span.end; seq++) {
    const original = bySeq.get(seq)
    const priced = original === undefined ? undefined : priceEvent(original, counter)
    if (priced === undefined) continue
    any = true
    beforeChars += priced.chars
    beforeExactTokens += priced.tokens
    if (priced.basis !== 'exact-tokenizer') beforeExact = false
  }
  if (!any) return undefined
  const exact = after.basis === 'exact-tokenizer' && beforeExact
  const basis: SavingsBasis = exact ? 'exact-tokenizer' : 'characters'
  const before = exact ? beforeExactTokens : charsToTokens(beforeChars)
  const afterTokens = exact ? after.tokens : charsToTokens(after.chars)
  const delta = before - afterTokens
  if (delta <= 0) return undefined
  return { tokens: delta, basis }
}

/**
 * 纯核心：给定事件流、当前 surface 节点与计价计数器，重算节省投影。
 * @param input - events/surfaceNodes/counter，均为实时路径的只读快照。
 * @returns savings（当前生效毛节省）/ offsets（每次重读惩罚）/ registry（原文配对键）。
 */
export function projectSavingsCore(input: {
  events: readonly SessionEvent[]
  surfaceNodes: Iterable<number | bigint | { valueOf(): number }>
  counter: SavingsTextCounter
}): SessionSavingsProjection {
  const { events, surfaceNodes, counter } = input
  if (events.length === 0) return EMPTY
  const bySeq = new Map<number, SessionEvent>()
  for (const event of events) bySeq.set(Number(event.seq), event)

  // 1) 当前生效毛节省（仪表）：只算仍在 surface 中的替换节点。
  const savings: ProjectedSaving[] = []
  for (const rawSeq of surfaceNodes) {
    const seq = Number(rawSeq)
    const replacement = bySeq.get(seq)
    if (replacement === undefined) continue
    const span = replacedSpan(replacement)
    if (span === undefined) continue
    const delta = computeDelta(bySeq, replacement, span, counter)
    if (delta === undefined) continue
    savings.push({
      component: 'projection',
      tokens: delta.tokens,
      basis: delta.basis,
      at: Number(replacement.time) || 0,
      replacementSeq: seq,
    })
  }

  // 2) 每次重读惩罚：按 seq 顺序,登记每个压缩的原文,其后每次同原文重读都记负项。
  const offsets: ProjectedOffset[] = []
  const registry: ProjectedRegistryItem[] = []
  const owned = new Map<string, { claimedTokens: number; basis: SavingsBasis; sourceSeq: number }>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const span = replacedSpan(event)
    if (span !== undefined) {
      const groupText = originalText(bySeq, span)
      if (groupText.length === 0) continue
      const delta = computeDelta(bySeq, event, span, counter)
      if (delta === undefined) continue
      const hash = savingsHash(groupText)
      owned.set(hash, { claimedTokens: delta.tokens, basis: delta.basis, sourceSeq: span.start })
      registry.push({ hash, claimedTokens: delta.tokens, basis: delta.basis, sourceSeq: span.start })
      continue
    }
    const text = textOf(event)
    if (text === undefined || text.length === 0) continue
    const hit = owned.get(savingsHash(text))
    if (hit === undefined) continue
    const priced = priceEvent(event, counter)
    if (priced === undefined) continue
    offsets.push({
      component: 'full-read',
      tokens: priced.tokens,
      basis: priced.basis,
      at: Number(event.time) || 0,
      seq: Number(event.seq),
      note: `#${hit.sourceSeq} 的原文被全文重读(投影重建)`,
    })
  }

  return { savings, offsets, registry }
}

/**
 * 从会话快照投影节省账。`measureForCompaction` 提供与实时同口径的 tokenizer
 * 计数器；失败时向上抛，由调用方 fail-open。
 */
export function projectSessionSavings(ctx: Context, session: Session): SessionSavingsProjection {
  const view = measureForCompaction(ctx, session)
  return projectSavingsCore({
    events: sessionEvents(session),
    surfaceNodes: session.surface.nodes as Iterable<number | bigint | { valueOf(): number }>,
    counter: candidate => view.countCanonicalText(candidate),
  })
}
