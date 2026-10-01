/**
 * Compression monitor surface for the floating panel (FAB, task: cci-monitor-fab).
 *
 * Three pieces, one module:
 *  - `buildMonitorSnapshot`: the savings snapshot (reused verbatim from the
 *    ledger — no second accounting) plus the turn-tail intent-summary block
 *    (override / observed flag / gate constants / last fold);
 *  - `applySessionOverride`: the `/ctx-summary` override state machine,
 *    addressed by session id — the panel buttons drive the same state the
 *    command drives, never a second one;
 *  - `estimateSavingsPricing`: moved here from the entry (the savings route
 *    and the monitor route share it; keeping it next to the monitor payload
 *    avoids a runtime → entry import cycle).
 *
 * The monitor route itself stays in the entry (`registerMonitorRoute`),
 * mirroring the savings/estimator registrars: all webServer wiring lives in
 * one place, the data plane lives here.
 *
 * Contract discipline: the published `/savings` route contract is frozen
 * (estimator-route spec encodes it) — the monitor aggregates but never
 * reshapes it; new fields attach under `intent` / `sessionScope`.
 */

/** Current host model-group selection, when the service exposes one. */
export interface AgentDefaultModelLike {
  currentSelection?: () => { provider?: unknown, model?: unknown } | undefined
}

import { priceOfficialDeepSeekUsage } from './deepseek-official-pricing.ts'
import { getSavingsLedger, type SavingsLedger, type SavingsSnapshot } from './savings.ts'
import {
  getLastIntentFold,
  getObservedIntentEnabled,
  getSummaryOverride,
  setSummaryOverride,
  type IntentFoldRecord,
} from './tokenpilot/advisor-state.ts'
import { INTENT_GATE_FLOOR_FRACTION, INTENT_GATE_GROWTH_TOKENS } from './tokenpilot/intent-gate.ts'

export interface MonitorIntentBlock {
  /** Session-scoped override; absent = settings-driven. */
  override: 'on' | 'off' | undefined
  /** Settings flag as last observed by the gate; absent = gate not evaluated yet. */
  observedEnabled: boolean | undefined
  gate: { floorFraction: number, growthTokens: number }
  lastFold: IntentFoldRecord | undefined
}

export type MonitorSnapshot = SavingsSnapshot & {
  intent: MonitorIntentBlock
  /** The session the snapshot was filtered to; `null` = all-sessions aggregate. */
  sessionScope: string | null
}

/**
 * Savings snapshot plus the intent-summary control block. Ledger is
 * injectable so tests seed a private instance instead of the process
 * singleton.
 */
export function buildMonitorSnapshot(
  sessionId?: string,
  ledger: SavingsLedger = getSavingsLedger(),
): MonitorSnapshot {
  const override = getSummaryOverride(sessionId ?? '')
  return {
    ...ledger.snapshot(sessionId),
    intent: {
      override,
      observedEnabled: getObservedIntentEnabled(sessionId ?? ''),
      gate: { floorFraction: INTENT_GATE_FLOOR_FRACTION, growthTokens: INTENT_GATE_GROWTH_TOKENS },
      lastFold: getLastIntentFold(sessionId ?? ''),
    },
    sessionScope: sessionId ?? null,
  }
}

export type SessionOverrideAction = 'on' | 'off' | 'clear'

export function isSessionOverrideAction(value: unknown): value is SessionOverrideAction {
  return value === 'on' || value === 'off' || value === 'clear'
}

/**
 * Drive the `/ctx-summary` override state machine: `on`/`off` pin the
 * session, `clear` returns it to settings-driven. The resulting override is
 * handed back so the route can echo the post-action truth.
 */
export function applySessionOverride(
  sessionId: string,
  action: SessionOverrideAction,
): { override: 'on' | 'off' | undefined } {
  setSummaryOverride(sessionId, action === 'clear' ? undefined : action)
  return { override: getSummaryOverride(sessionId) }
}

/**
 * 金额估算(monitor 口径的 token/金额估算,结合官方牌价):
 *  - actualCost:本进程累计真实 usage 的官方牌价(exact/range);
 *  - estimatedSavedCost:净节省(精确口径)按 cache-miss 输入价折算——
 *    基线假设"这些 token 不压缩就要全价进上下文",标注估算。
 * 仅官方 deepseek-official 路由可解;第三方/未知模型 fail-closed 为 undefined。
 * (自入口迁入: savings 路由与 monitor 路由共享,避免 runtime → entry 回环。)
 */
export function estimateSavingsPricing(readService: (name: string) => unknown, snapshot: {
  startedAt: string
  net: { exact: number; estimated: number }
  usage: { requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
}): { currency: string; actualCost?: string | undefined; estimatedSavedCost?: string | undefined } | undefined {
  if (snapshot.usage.requests === 0 && snapshot.net.exact === 0) return undefined
  const defaults = readService('agentDefaultModel') as AgentDefaultModelLike | undefined
  const selection = defaults?.currentSelection?.()
  const provider = typeof selection?.provider === 'string' ? selection.provider : ''
  const modelId = typeof selection?.model === 'string' ? selection.model : ''
  if (provider !== 'deepseek-official') return undefined
  const now = new Date()
  const startedAt = new Date(snapshot.startedAt)
  const completedAt = now.getTime() > startedAt.getTime() ? now : new Date(startedAt.getTime() + 1)
  const base = {
    provider,
    baseUrlClass: 'official-public',
    apiRoute: 'chat-completions',
    modelId,
    currency: 'USD',
    startedAt,
    completedAt,
  } as const
  const actual = priceOfficialDeepSeekUsage({
    ...base,
    usage: {
      cacheReadTokens: Math.max(0, Math.round(snapshot.usage.cacheReadTokens)),
      cacheMissTokens: Math.max(0, Math.round(snapshot.usage.inputTokens)),
      outputTokens: Math.max(0, Math.round(snapshot.usage.outputTokens)),
    },
  })
  const saved = snapshot.net.exact > 0
    ? priceOfficialDeepSeekUsage({
      ...base,
      usage: { cacheReadTokens: 0, cacheMissTokens: Math.round(snapshot.net.exact), outputTokens: 0 },
    })
    : undefined
  const decimalOf = (cost: typeof actual): string | undefined =>
    cost.kind === 'exact' ? cost.decimal : cost.kind === 'range' ? cost.minimum.decimal : undefined
  if (actual.kind === 'unpriced' && (saved === undefined || saved.kind === 'unpriced')) return undefined
  return {
    currency: 'USD',
    ...(actual.kind === 'unpriced' ? {} : { actualCost: decimalOf(actual) }),
    ...(saved === undefined || saved.kind === 'unpriced' ? {} : { estimatedSavedCost: decimalOf(saved) }),
  }
}
