/**
 * Tuning constants and pure helper functions for the context-compression pruner.
 *
 * These are stateless, session-independent, and safe to import from any
 * pruner sub-module without creating circular dependencies.
 */

/** Line-feed character used as the canonical newline separator. */
export const BS = String.fromCharCode(10)

/** Count the lines present in the original but absent from the replacement. */
export function countOmittedLines(original: string, replacement: string): number | undefined {
  const originalLines = original.split(BS).length
  const replacementLines = replacement.split(BS).length
  const omitted = originalLines - replacementLines
  return omitted > 0 ? omitted : undefined
}

/** Minimum token-equivalent cost charged for every rich content block. */
export const RICH_BLOCK_PRESSURE_COST = 256

/** Routed-context utilization required before capacity-pressure History may age sent history. */
export const CAPACITY_PRESSURE_RATIO = 0.7
