/**
 * Net-gain threshold check (F1).
 *
 * Plan: cci-longterm-refactor v0.13.2
 *
 * A cut is only worthwhile if the tokens saved (minus the cost of the
 * replacement card/pointer) exceed a configurable minimum. This prevents
 * the "切了个寂寞" degeneration where small outputs are cut into cards
 * that cost almost as much as the original.
 *
 * @module dsh-context-compression-improved/runtime/netgain
 */

/** Fixed card overhead estimate: sourceRef + header + retrieve hint ≈ 80 tokens. */
const CARD_OVERHEAD_TOKENS = 80

/**
 * Check whether a candidate cut has sufficient net gain to be published.
 *
 * @param tokensBefore - tokens of the original content
 * @param tokensAfter - tokens of the replacement card/pointer
 * @param minNetGain - minimum required net savings (0 = disabled)
 * @returns true if the cut should proceed, false if it should be skipped
 */
export function checkNetGain(
  tokensBefore: number,
  tokensAfter: number,
  minNetGain: number,
): boolean {
  // Feature disabled
  if (minNetGain <= 0) return true
  const netGain = tokensBefore - tokensAfter - CARD_OVERHEAD_TOKENS
  return netGain >= minNetGain
}

/**
 * Compute the effective net gain of a proposed cut.
 * Useful for logging/audit even when the cut is allowed.
 */
export function computeNetGain(
  tokensBefore: number,
  tokensAfter: number,
): number {
  return tokensBefore - tokensAfter - CARD_OVERHEAD_TOKENS
}

/** The card overhead constant (exported for tests). */
export { CARD_OVERHEAD_TOKENS }
