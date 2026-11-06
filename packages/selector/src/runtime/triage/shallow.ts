/**
 * Shallow-read primitives (plan cci-sedimentation-triage, Phase 4.5).
 *
 * Pure decision layer for the upgrade-discard pair:
 * - `normalizeToolPath` — the pairing key (drive letter lowered, separators
 *   unified, `./` resolved); false pairing must fail CLOSED (no footer, guard
 *   refuses), never silently drop content;
 * - `classifyShallowSample` — the `probe` decision: O(1) header sample picks
 *   which shallow view fits (T4.12);
 * - `evaluateDiscardGuard` — the asymmetric protection (M20): discarding the
 *   MAP when the covering full read is only a slice is refused; discarding
 *   the full read while the checkpoint survives is always allowed;
 * - `buildShallowFooter` / `renderCheckpointLine` — the data-shaped teaching
 *   that rides the pruner seam (findings F5: reminders as data, not rules).
 */
import type { ShallowCheckpoint } from './types.ts'

/** Windows-first corpus; forward slashes accepted everywhere. */
export function normalizeToolPath(raw: string): string {
  const unified = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  const lowered = /^[A-Za-z]:\//.test(unified)
    ? `${unified[0]!.toLowerCase()}${unified.slice(1)}`
    : unified
  // collapse duplicate separators and trailing slash, keep leading root
  const collapsed = lowered.replace(/\/{2,}/g, '/').replace(/\/$/, '')
  // resolve `..` segments lexically (no fs access here)
  const segments = collapsed.split('/')
  const out: string[] = []
  for (const segment of segments) {
    if (segment === '..') out.pop()
    else if (segment !== '.' && segment !== '') out.push(segment)
  }
  const joined = out.join('/')
  return collapsed.startsWith('/') ? `/${joined}` : joined
}

/** Shallow view methods the probe can recommend. */
export type ShallowMethod = 'json-skeleton' | 'code-skeleton' | 'csv-header' | 'toc-lines' | 'head-tail'

export interface ProbeVerdict {
  readonly method: ShallowMethod
  readonly reason: string
}

const JSON_START = /^[{[]/
const CSV_HINT = /^[^\n,]*,.*\n(?:[^\n,]*,.*){2,}/
const FRONTMATTER_HINT = /^---\n/

/** Classify from a bounded header sample only — the body is never opened here. */
export function classifyShallowSample(head: string, ext: string, totalBytes: number): ProbeVerdict {
  const extension = ext.toLowerCase().replace(/^\./, '')
  const trimmed = head.replace(/^\uFEFF/, '').trimStart()
  if (extension === 'json' || extension === 'jsonc' || (JSON_START.test(trimmed) && (extension === '' || extension === 'jsonl'))) {
    return { method: 'json-skeleton', reason: 'structured JSON: key skeleton beats raw text' }
  }
  if (extension === 'jsonl' || extension === 'ndjson') {
    return { method: 'code-skeleton', reason: 'record stream: head/tail records with counts' }
  }
  if (extension === 'csv' || extension === 'tsv' || (totalBytes > 2000 && CSV_HINT.test(trimmed))) {
    return { method: 'csv-header', reason: 'tabular: header row + row count, rows elided' }
  }
  if (['md', 'markdown', 'rst', 'txt', 'adoc'].includes(extension)) {
    return { method: 'toc-lines', reason: 'prose: heading outline, bodies elided' }
  }
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'py', 'go', 'rs', 'java', 'c', 'h', 'cc', 'cpp', 'cs', 'kt', 'swift', 'php', 'rb'].includes(extension)
    || FRONTMATTER_HINT.test(trimmed) === false && /^\s*(?:import|from|package|use|def|fn|class|const|function)/.test(trimmed)) {
    return { method: 'code-skeleton', reason: 'source code: declarations kept, bodies elided' }
  }
  if (totalBytes < 4000) {
    return { method: 'head-tail', reason: 'small enough that a plain slice is the honest view' }
  }
  return { method: 'toc-lines', reason: 'unknown shape: line-structure outline as safe default' }
}

/** One side of a discard pair. */
export interface ReadPairSide {
  readonly seq: number
  readonly path: string
  /** 'full' covers whole file; 'slice' carries the covered line window. */
  readonly coverage: { readonly kind: 'full' } | { readonly kind: 'slice'; readonly from: number; readonly to: number }
}

export interface DiscardGuardInput {
  /** The MAP side being considered for discard (the skeleton result). */
  readonly map: ReadPairSide
  /** The covering side claimed to supersede the map. */
  readonly covering: ReadPairSide
}

/**
 * The asymmetric guard (findings F6): losing the map costs far more than the
 * saved bytes. Discarding the map requires the covering read to span it
 * fully; equal paths after normalization are a precondition, never assumed.
 */
export function evaluateDiscardGuard(input: DiscardGuardInput): { readonly allowed: boolean; readonly reason: string } {
  const mapPath = normalizeToolPath(input.map.path)
  const coveringPath = normalizeToolPath(input.covering.path)
  if (mapPath === '' || coveringPath === '' || mapPath !== coveringPath) {
    return { allowed: false, reason: `path-mismatch:${input.map.path}|${input.covering.path}` }
  }
  if (input.map.coverage.kind === 'full') {
    // map covers everything; only a full covering read supersedes it
    if (input.covering.coverage.kind === 'full') return { allowed: true, reason: 'covered-full' }
    return { allowed: false, reason: 'map-is-full-need-full-coverage' }
  }
  if (input.covering.coverage.kind === 'full') return { allowed: true, reason: 'covered-by-full' }
  const fromOk = input.covering.coverage.from <= input.map.coverage.from
  const toOk = input.covering.coverage.to >= input.map.coverage.to
  return fromOk && toOk
    ? { allowed: true, reason: 'covered-by-window' }
    : { allowed: false, reason: `window-gap:${input.map.coverage.from}-${input.map.coverage.to} vs ${input.covering.coverage.from}-${input.covering.coverage.to}` }
}

/** Footer riding a full read that pairs with a live shallow map (T4.8). */
export function buildShallowFooter(checkpoint: ShallowCheckpoint, savedTokens: number): string {
  return `[cci-shallow-pair] 同文件的浅读视图 ${checkpoint.ref}（≈${savedTokens} tok）仍在上下文；确认不再需要时可调 context_compression_discard 释放（检查点行会保留）。被省略的输出不要凭本行推测补写。`
}

/** The one permanent line a discarded map leaves behind (R11). */
export function renderCheckpointLine(checkpoint: ShallowCheckpoint): string {
  return `[cci-checkpoint] ${checkpoint.path} | ${checkpoint.coverage} | ref ${checkpoint.ref} | fp ${checkpoint.fingerprint}`
}

/** Cheap order-sensitive header hash + size; staleness hint only, never authority. */
export function shallowFingerprint(text: string): string {
  const head = text.slice(0, 512)
  let hash = 5381
  for (let index = 0; index < head.length; index += 1) {
    hash = ((hash << 5) + hash + head.charCodeAt(index)) >>> 0
  }
  return `${text.length.toString(16)}-${hash.toString(16)}`
}
