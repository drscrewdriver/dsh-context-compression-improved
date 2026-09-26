/**
 * Type-only stub of the advisor benefit band, pending the advisor 全家桶 port
 * (task: archive-line advisor port, tdd-drift-backport plan T18). The intent
 * summary's session override state (`advisor-state.ts`) carries a `band` field
 * typed by this union; the runtime benefit model itself is NOT part of this
 * line. Keep the union byte-identical with the 0.1.7/0.2.0 lines so a future
 * port lands without consumer-visible type changes.
 */

/** How the discounted-payback accounting classifies a compression decision. */
export type AdviceBand =
  /** Payback ≤ 1 turn, or ≤ a quarter of the estimated remaining turns. */
  | 'profitable'
  /** At least one candidate reaches the high-impact threshold: the batch is
   *  large enough that a human would want to know it moved. */
  | 'high-impact'
  /** Ŝ known and payback ∈ (1, 3]: it does pay back, but slowly. */
  | 'slow-payback'
  /** α·R ≤ 0: the accounting has no discounted recovery to argue from. */
  | 'unpriceable'
  /** Ŝ known and payback > 3 turns: the model would not have spent the cache break. */
  | 'not-worth-it'
