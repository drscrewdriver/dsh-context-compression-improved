/**
 * Line-C deterministic masks (plan cci-sedimentation-triage, Phase 2).
 *
 * Two extractions replace enumeration (findings F5 "extraction over
 * enumeration"):
 * 1. `manifestFromCall` — write-family results collapse to the touched-file
 *    list. Paths come from CALL ARGS first: result text usually says "written"
 *    without full paths (replay round-1 failure mode).
 * 2. `skeletonFromRead` — large read results collapse to declaration lines.
 * Matching runs on the gutter-stripped view (the host's `N: ` prefix defeats
 * naive declaration regexes — the CCI JSON-skeleton trap), while CAPTURED
 * lines keep their gutter because it is the model's inline locator into the
 * original file, same convention as `hasReadGutter` in reducers.
 *
 * Both fail open: returning `null` means "not maskable", the caller keeps the
 * normal reduction path. Zero-hit is a normal outcome, not an error.
 *
 * @module runtime/triage/masks
 */
import { hasReadGutter } from '../reducers.ts'
import type { MaskVerdict } from './types.ts'

/** Write-family tool names whose results are pure "what changed" manifests. */
const WRITE_TOOLS = /^(write|edit|apply_patch|multi_edit|create|search_replace)$/i

/** Read-family tool names eligible for skeleton masking. */
const READ_TOOLS = /^(read|read_file|view)$/i

/** Read results below this char length stay verbatim (masking would lose more than it saves). */
const MASK_READ_MIN_CHARS = 3_000

/** Declaration-ish line starts across the languages this corpus exercises. */
const SKELETON_PATTERN = /^\s*(?:import |from \S+ import |export |package |use |fn |func |def |class |interface |type |impl |enum |pub |const |let |var |async function|public |private |protected |static |#define|template)/

/** Hard caps keep one card section bounded regardless of input size. */
const MANIFEST_MAX_PATHS = 12
const SKELETON_MAX_LINES = 40

/** Gutter prefix added by the host's `formatReadOutput`; strip for MATCHING only. */
const GUTTER_STRIP = /^(\d+): /

/** Text-fallback path pattern: absolute-ish paths and extension-bearing names. */
const PATH_FALLBACK = /((?:[A-Za-z]:)?[\\/][^\s"'`,:]{3,}|\.?[\w./\\-]+\.(?:ts|tsx|js|mjs|py|go|rs|md|json|ya?ml|css|html))(?::\d+)?/g

function collectArgPaths(argsJson: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(argsJson)
  } catch {
    return []
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const record = parsed as Record<string, unknown>
  const singles = [record.file_path, record.path, record.filePath]
  const list = Array.isArray(record.paths) ? record.paths : []
  const edits = Array.isArray(record.edits) ? record.edits : []
  const out: string[] = []
  for (const entry of [...singles, ...list, ...edits.map(item => (item as Record<string, unknown> | null)?.path)]) {
    if (typeof entry === 'string' && entry.trim() !== '') out.push(entry.trim())
  }
  return out
}

/**
 * Collapse a write-family result to its touched-file manifest.
 * Args first, result text only as fallback; never throws on broken args.
 */
export function manifestFromCall(name: string, argsJson: string, text: string, seq = 0): MaskVerdict | null {
  if (!WRITE_TOOLS.test(name)) return null
  const fromArgs = collectArgPaths(argsJson)
  const candidates = fromArgs.length > 0
    ? fromArgs
    : (text.match(PATH_FALLBACK) ?? []).map(entry => entry.replace(/:\d+$/, ''))
  const paths = [...new Set(candidates)].slice(0, MANIFEST_MAX_PATHS)
  if (paths.length === 0) return null
  return { kind: 'manifest', paths, seq }
}

/**
 * Collapse a large read result to its declaration skeleton. Returns `null`
 * for small reads, non-read content, and zero-hit bodies (prose dumps) —
 * fail-open to the normal reducer path. Captured lines keep the gutter.
 */
export function skeletonFromRead(text: string, seq = 0): MaskVerdict | null {
  if (text.length < MASK_READ_MIN_CHARS) return null
  const lines = text.replace(/\n+$/, '').split('\n')
  const guttered = hasReadGutter(lines)
  const kept: string[] = []
  for (const line of lines) {
    const matchView = guttered ? line.replace(GUTTER_STRIP, '') : line
    if (SKELETON_PATTERN.test(matchView)) {
      kept.push(line)
      if (kept.length >= SKELETON_MAX_LINES) break
    }
  }
  if (kept.length === 0) return null
  const keptChars = kept.reduce((sum, line) => sum + line.length + 1, 0)
  return {
    kind: 'skeleton',
    lines: kept,
    totalLines: lines.length,
    elidedChars: Math.max(0, text.length - keptChars),
    seq,
  }
}

/** Read-family predicate for the wiring site (keeps tool-name regex single-sourced here). */
export function isReadToolName(name: string): boolean {
  return READ_TOOLS.test(name)
}

/** Write-family predicate for the wiring site. */
export function isWriteToolName(name: string): boolean {
  return WRITE_TOOLS.test(name)
}
