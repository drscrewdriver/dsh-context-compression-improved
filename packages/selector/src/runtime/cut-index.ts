/**
 * Per-cut audit index (F2).
 *
 * Plan: cci-longterm-refactor v0.13.3
 *
 * Appends one JSON line per published cut to ~/.dsh/storages/dsh-context-compression/cuts-<sessionId>.jsonl.
 * Provides O(1) audit history without storing original content — only metadata.
 *
 * Fire-and-forget: write failure warns but never blocks the cut.
 *
 * @module dsh-context-compression-improved/runtime/cut-index
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Strategy classification for the panel's four-knife badges. */
export type CutStrategy = 'small-knife' | 'big-knife' | 'card-merge' | 'skeleton'

export interface CutEntry {
  /** ISO timestamp of the cut landing. */
  readonly ts: string
  /** Session identifier. */
  readonly sessionId: string
  /** Which knife made this cut. */
  readonly strategy: CutStrategy
  /** Component within the strategy (fresh/aggregate/history/sediment/etc). */
  readonly component: string
  /** Event seqs shadowed by this cut. */
  readonly eventSeqs: readonly number[]
  /** Token count before the cut. */
  readonly tokensBefore: number
  /** Token count after the cut (card + overhead). */
  readonly tokensAfter: number
  /** Net gain: tokensBefore - tokensAfter - cardOverhead. */
  readonly netGain: number
  /** Estimated tail-rewrite tokens (cache recompute). */
  readonly cacheRecomputeEst: number
  /** Reference to the source events for retrieval. */
  readonly cardRef: string
  /** Active profile at cut time. */
  readonly profile: string
}

const MAX_LINES_PER_SESSION = 2000

/** Storage directory resolver (lazy, creates if missing). */
function getStagingDir(): string {
  const dshHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  return join(dshHome, 'storages', 'dsh-context-compression')
}

function cutsFilePath(sessionId: string): string {
  return join(getStagingDir(), `cuts-${sessionId}.jsonl`)
}

/**
 * Append one cut entry to the session's index file.
 * Fire-and-forget: catches all errors, warns, never throws.
 */
export function appendCut(entry: CutEntry): void {
  try {
    const dir = getStagingDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const filePath = cutsFilePath(entry.sessionId)
    const line = JSON.stringify(entry) + '\n'
    appendFileSync(filePath, line, { encoding: 'utf8', flag: 'a' })
    // Truncation check: if file exceeds limit, keep newest half
    enforceLimit(filePath)
  } catch (err) {
    // Never block a cut for index failure
    console.warn('[cci-cut-index] write failed, skipping:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Read cut entries for a session (most recent first, up to limit).
 */
export function readCuts(sessionId: string, opts?: { limit?: number; strategy?: CutStrategy }): CutEntry[] {
  const filePath = cutsFilePath(sessionId)
  if (!existsSync(filePath)) return []
  try {
    const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
    let entries: CutEntry[] = []
    for (const line of lines) {
      try { entries.push(JSON.parse(line) as CutEntry) } catch { /* skip malformed */ }
    }
    // Most recent first
    entries.reverse()
    // Filter by strategy
    if (opts?.strategy !== undefined) {
      entries = entries.filter(e => e.strategy === opts.strategy)
    }
    // Apply limit
    if (opts?.limit !== undefined && opts.limit > 0) {
      entries = entries.slice(0, opts.limit)
    }
    return entries
  } catch {
    return []
  }
}

/** Enforce the per-session line limit by truncating oldest half. */
function enforceLimit(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf8')
    const lines = content.split('\n').filter(Boolean)
    if (lines.length <= MAX_LINES_PER_SESSION) return
    // Keep newest half
    const kept = lines.slice(Math.floor(lines.length / 2))
    const { writeFileSync } = require('node:fs')
    writeFileSync(filePath, kept.join('\n') + '\n', 'utf8')
  } catch {
    // Truncation failure is non-fatal
  }
}

/** Export the limit for testing. */
export { MAX_LINES_PER_SESSION }
