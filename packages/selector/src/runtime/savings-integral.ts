/**
 * 按 call 积分器（spec T15/T16）——"真节省"口径。
 *
 * 定义:真节省 = Σ_每次call(该次基线输入 − 实际输入)。存量(delta, observeActive
 * 收敛)回答"现在省多少";积分把每个 fresh 边界的存量净快照累加成跨重启的
 * "累计(按 N 次 call)"。召回不追溯翻账:召回前的 call 真省过钱,样本保留;
 * 召回后存量转负,后续采样自然把积分往下拉——前向口径,历史样本永不改写。
 *
 * 采样点:pruneSession stage='fresh' 的 recordUsage 同点(pruner 接线行,本
 * 模块不重做任何测量)。boundarySeq = 采样时刻事件日志的最大绝对 seq——每完成
 * 一次请求日志必追加(assistant/message 等),相邻两次 fresh 采样之间 maxSeq
 * 单调递增,天然构成 per-call 幂等键;同 seq 重放被 claims 主键吸收。
 *
 * 省钱口径(T16):cached/uncached 分权——cachedInput×inputCacheHit +
 * uncachedInput×inputCacheMiss(官方定价目录,定点 bigint,零浮点)。无定价
 * 路由(非 deepseek-official 官方公网/未知模型)返回 null,面板仅 token 口径。
 * 拆分规则:cacheReadTokens = 命中数;uncached = inputTokens − cacheRead
 * (负值截 0)。首 call 无 usage 报告时照常采样存量(calls 照计,拆分记 0)。
 *
 * @module dsh-context-compression-improved/runtime/savings-integral
 */
import type { Session } from '@deepseek-ai/dsh-session'
import {
  decimalRateNanoUnits,
  type OfficialDeepSeekPriceRecord,
} from './deepseek-official-pricing.ts'
import { sessionEvents } from './session-events.ts'
import { recordIntegralSample } from './stats-sync.ts'

/** 一次 fresh 边界采样的输入(测量由调用方完成,本模块只定键、拆分、落库)。 */
export interface IntegralSampleInput {
  sessionId: string
  session: Session
  /** 内存账本当前存量净额(snapshot(sessionId).net,双 basis 分列)。 */
  net: { exact: number; estimated: number }
  /** 该边界读到的上一已完成请求官方 usage;首 call 缺报时 undefined。 */
  usage?: { inputTokens?: number; cacheReadTokens?: number } | undefined
}

/** 采样时刻事件日志的最大绝对 seq;空日志(无从定键)返回 undefined。 */
export function latestEventSeq(session: Session): number | undefined {
  let max: number | undefined
  for (const event of sessionEvents(session)) {
    const seq = Number(event.seq)
    if (Number.isFinite(seq)) max = max === undefined ? seq : Math.max(max, seq)
  }
  return max
}

/** usage 拆分:cacheRead = 命中;uncached = input − cacheRead(负截 0);非法值记 0。 */
export function splitCachedUncached(usage: IntegralSampleInput['usage']): { cachedInput: number; uncachedInput: number } {
  const cached = typeof usage?.cacheReadTokens === 'number' && Number.isFinite(usage.cacheReadTokens) && usage.cacheReadTokens > 0
    ? Math.trunc(usage.cacheReadTokens)
    : 0
  const input = typeof usage?.inputTokens === 'number' && Number.isFinite(usage.inputTokens) && usage.inputTokens > 0
    ? Math.trunc(usage.inputTokens)
    : 0
  return { cachedInput: cached, uncachedInput: Math.max(0, input - cached) }
}

/** fresh 边界采样入口:定键 → 拆分 → 经 stats-sync 幂等落库;空日志静默跳过。 */
export function sampleIntegralBoundary(input: IntegralSampleInput): void {
  const boundarySeq = latestEventSeq(input.session)
  if (boundarySeq === undefined) return
  const { cachedInput, uncachedInput } = splitCachedUncached(input.usage)
  recordIntegralSample({
    sessionId: input.sessionId,
    boundarySeq,
    netExact: input.net.exact,
    netEstimated: input.net.estimated,
    cachedInput,
    uncachedInput,
  })
}

/** 定价目录单位(每 1M tokens)下的双科目省钱估计;记录缺有效费率 = null。 */
export interface IntegralMoneyEstimate {
  /** 定点十进制(主币种单位),格式同定价模块 femto 渲染。 */
  decimal: string
  /** 原始定点整数(femto 主币种单位),供聚合而不丢精度。 */
  femtoUnits: string
  currency: 'USD' | 'CNY'
  band: 'peak' | 'off-peak'
}

/**
 * 省钱估计(T16):cached 走 inputCacheHit、uncached 走 inputCacheMiss,
 * femto = tokens × nanoRate(与定价模块 amountFor 同构,输出侧不计——
 * 积分口径只对输入省钱)。费率不可解析(理论上目录内不会)返回 null。
 */
export function estimateIntegralMoney(input: {
  cachedInput: number
  uncachedInput: number
  record: OfficialDeepSeekPriceRecord
}): IntegralMoneyEstimate | null {
  const hit = decimalRateNanoUnits(input.record.inputCacheHit)
  const miss = decimalRateNanoUnits(input.record.inputCacheMiss)
  if (hit === undefined || miss === undefined) return null
  const cached = Number.isFinite(input.cachedInput) && input.cachedInput > 0 ? BigInt(Math.trunc(input.cachedInput)) : 0n
  const uncached = Number.isFinite(input.uncachedInput) && input.uncachedInput > 0 ? BigInt(Math.trunc(input.uncachedInput)) : 0n
  if (cached === 0n && uncached === 0n) return null
  const femtoUnits = cached * hit + uncached * miss
  return {
    decimal: formatFemtoUnits(femtoUnits),
    femtoUnits: femtoUnits.toString(),
    currency: input.record.currency,
    band: input.record.band,
  }
}

/** femto(1e-15)整数 → 十进制串;与定价模块的 femto 渲染同构(模块内私有,此处独立实现)。 */
function formatFemtoUnits(value: bigint): string {
  const digits = value.toString().padStart(16, '0')
  const whole = digits.slice(0, -15)
  const fraction = digits.slice(-15).replace(/0+$/u, '')
  return fraction.length === 0 ? whole : `${whole}.${fraction}`
}
