/**
 * PTC disclosurePolicy awareness (F5).
 *
 * Plan: cci-longterm-refactor v0.13.5
 *
 * When the host preset uses disclosurePolicy='full', the first-turn schema
 * is already ~30K tokens (dsh-ops #994 evidence). Aggressive tool-result
 * trimming becomes less necessary because the per-request token overhead is
 * dominated by schema, not tool output.
 *
 * This module provides the adjustment function: full → historyMinReclaim × 1.2.
 *
 * @module dsh-context-compression-improved/runtime/ptc-disclosure
 */

export type DisclosurePolicy = 'on-demand' | 'full' | undefined

/**
 * Compute the effective minReclaim based on disclosure policy.
 * Under 'full', schema already eats the budget → relax tool-result aging by 20%.
 *
 * @param baseMinReclaim - The profile's base minReclaim in tokens
 * @param policy - The disclosure policy as read from the host (undefined = unknown/old host)
 * @returns The effective minReclaim value
 */
export function effectiveMinReclaim(baseMinReclaim: number, policy: DisclosurePolicy): number {
  if (policy === 'full') {
    return Math.round(baseMinReclaim * 1.2)
  }
  // 'on-demand' or undefined (old host) → no change
  return baseMinReclaim
}
