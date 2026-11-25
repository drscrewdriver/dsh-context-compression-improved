/**
 * CardMerge: multi-card consolidation (F3 — 中刀).
 *
 * Plan: cci-longterm-refactor v0.13.4
 *
 * When the surface accumulates too many individual compressed cards (each ~100-300 tokens),
 * CardMerge takes the OLDEST N cards and merges them into a single summary card.
 * This is the "中刀" (medium knife) level between small-knife per-message cuts and
 * big-knife (official/sediment) turn-level compression.
 *
 * Default OFF: the user must explicitly enable it. Panel requires double confirmation.
 *
 * @module dsh-context-compression-improved/runtime/card-merge
 */

export interface CardMergeSettings {
  enabled: boolean
  /** Minimum number of cards on surface before triggering (default 8). */
  mergeMaxCards: number
  /** Minimum total card tokens to justify merge (default 4000). */
  mergeMinTokens: number
  /** Break-even ratio: oneTimeRecompute / netGain must be <= this (default 2). */
  mergeBreakEven: number
  /** Cooldown between merges in ms (default 300000 = 5min). */
  mergeCooldownMs: number
}

export const DEFAULT_CARD_MERGE_SETTINGS: CardMergeSettings = {
  enabled: false,
  mergeMaxCards: 8,
  mergeMinTokens: 4_000,
  mergeBreakEven: 2,
  mergeCooldownMs: 300_000,
}

export interface CardInfo {
  seq: number
  tokens: number
  /** The source reference(s) this card points to. */
  sourceRefs: string[]
}

export interface MergePlan {
  /** Cards to merge (oldest first). */
  readonly cards: readonly CardInfo[]
  readonly totalTokens: number
  readonly estimatedOutputTokens: number
  readonly netGain: number
  readonly recomputeEstimate: number
  readonly breakEvenOk: boolean
}

/**
 * Decide whether and how to merge cards. Returns null if merge should NOT happen.
 *
 * @param cards - All compressed cards currently on surface, ordered by seq (oldest first)
 * @param settings - The card merge configuration
 * @param tailTokens - Tokens on the surface AFTER the last card (rewrite tail)
 */
export function planCardMerge(
  cards: readonly CardInfo[],
  settings: CardMergeSettings,
  tailTokens: number,
): MergePlan | null {
  if (!settings.enabled) return null
  if (cards.length < settings.mergeMaxCards) return null

  // Take the oldest N cards (up to chunkMax equivalent) for merging
  const mergeable = cards.slice(0, Math.max(settings.mergeMaxCards, Math.floor(cards.length * 0.6)))
  const totalTokens = mergeable.reduce((sum, c) => sum + c.tokens, 0)

  if (totalTokens < settings.mergeMinTokens) return null

  // Estimated output: roughly 15% of input (heuristic for good summary)
  const estimatedOutputTokens = Math.ceil(totalTokens * 0.15) + 200
  const netGain = totalTokens - estimatedOutputTokens

  if (netGain <= 0) return null

  // One-time recompute cost: the tail after the merged range must be resent
  const recomputeEstimate = tailTokens
  const breakEvenOk = recomputeEstimate / netGain <= settings.mergeBreakEven

  if (!breakEvenOk) return null

  return {
    cards: mergeable,
    totalTokens,
    estimatedOutputTokens,
    netGain,
    recomputeEstimate,
    breakEvenOk: true,
  }
}

/**
 * Validate that decode of settings produces the correct shape.
 */
export function decodeCardMergeSettings(value: unknown): CardMergeSettings {
  if (value === undefined || value === null) return { ...DEFAULT_CARD_MERGE_SETTINGS }
  if (typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_CARD_MERGE_SETTINGS }
  const obj = value as Record<string, unknown>
  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULT_CARD_MERGE_SETTINGS.enabled,
    mergeMaxCards: clampInt(obj.mergeMaxCards, 2, 50, DEFAULT_CARD_MERGE_SETTINGS.mergeMaxCards),
    mergeMinTokens: clampInt(obj.mergeMinTokens, 500, 50_000, DEFAULT_CARD_MERGE_SETTINGS.mergeMinTokens),
    mergeBreakEven: clampInt(obj.mergeBreakEven, 1, 10, DEFAULT_CARD_MERGE_SETTINGS.mergeBreakEven),
    mergeCooldownMs: clampInt(obj.mergeCooldownMs, 60_000, 3_600_000, DEFAULT_CARD_MERGE_SETTINGS.mergeCooldownMs),
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}
