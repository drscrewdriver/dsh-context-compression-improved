/**
 * Line-A signal rules (plan cci-sedimentation-triage, Phase 1).
 *
 * Two decoupled layers, mirroring the trial-3 findings:
 * 1. `blockFailureVerdict` — the five BASE structural signals that mark a
 *    whole tool result as a hard failure (audit + card section grouping).
 * 2. `linePool` — verbatim per-line capture, INDEPENDENT of the block verdict
 *    so soft-failure blocks (exit 0 with error lines in the body) still yield
 *    protected lines. Round-1 replay measured 62.4% recall when capture was
 *    gated on the block verdict; decoupling is the regression anchor.
 *
 * The base set is never removable; `mergeExtraPatterns` appends the validated
 * default extras (trial-3: extras carried 48.2% of pool lines) plus user
 * entries from `sediment.extraSignalPatterns`. Invalid regex entries are
 * skipped here (profiles decode already rejects them upstream — belt and
 * suspenders, never a throw at capture time).
 *
 * @module runtime/triage/signals
 */
import type { TriageRole, VerbatimLine } from './types.ts'

/** Per-line verbatim cap (plan: 240 codepoints, ` …` marker excluded). */
const LINE_CAP = 240

/** Base structural block signals: id + predicate over the raw result text. */
const BASE_BLOCK_SIGNALS: ReadonlyArray<{
  readonly id: string
  readonly test: (text: string, isError: boolean) => boolean
}> = Object.freeze([
  { id: 'sig:isError-flag', test: (_text, isError) => isError },
  { id: 'sig:stderr-prefix', test: text => text.trimStart().startsWith('[stderr]') },
  {
    id: 'sig:exit-code-bracket',
    test: text => {
      const trimmed = text.trim()
      return /\[exit code:\s*(?!0\b)-?\d+\s*\]\s*$/.test(trimmed)
        || /\[Command finished with exit code\s+(?!0\b)-?\d+\]\s*$/.test(trimmed)
        || /^exit_code=\s*(?!0\b)-?\d+\s*$/.test(trimmed)
    },
  },
  {
    id: 'sig:json-exitcode',
    test: text => {
      const trimmed = text.trim()
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false
      try {
        const parsed: unknown = JSON.parse(trimmed)
        return typeof (parsed as Record<string, unknown>)?.exitCode === 'number'
          && (parsed as { exitCode: number }).exitCode !== 0
      } catch {
        return false
      }
    },
  },
])

/** Line-level base family: the classic failure markers (spine-validated). */
const FAILURE_BASE_PATTERN = /(?:^|\s)(?:FAIL(?:ED)?\b|Error:|Exception:|Traceback\b|panic:|AssertionError)/

/**
 * Built-in default extras — trial-3 validated families the base misses
 * (48.2% of pool lines in the replay corpus). Distributed like user extras:
 * append-only, never replaces the base, individually skippable when invalid.
 */
const DEFAULT_EXTRA_PATTERNS: ReadonlyArray<{ readonly id: string; readonly source: string }> = Object.freeze([
  { id: 'ext:tool-timeout', source: String.raw`TOOL_TIMEOUT|timed out after \d+ms` },
  { id: 'ext:npm-err', source: String.raw`npm ERR!|\bERR!` },
  { id: 'ext:proc-kill', source: String.raw`\bkilled\b|OOM|out of memory` },
  { id: 'ext:assert-ctx', source: String.raw`expected .* to (?:be|equal|throw)|Received:|toStrictEqual` },
])

/** One compiled line rule with its audit id. */
export interface LineRule {
  readonly id: string
  readonly pattern: RegExp
}

/**
 * Compile the append-only line-rule set: base classic family first (its id
 * wins on multi-rule matches, keeping audit stable), then built-in default
 * extras, then user extras. Invalid user regexes are skipped silently — the
 * settings boundary already rejected them upstream; capture must never throw.
 */
export function mergeExtraPatterns(userExtra: readonly string[]): readonly LineRule[] {
  const rules: LineRule[] = [{ id: 'line:failure-classic', pattern: FAILURE_BASE_PATTERN }]
  for (const entry of DEFAULT_EXTRA_PATTERNS) {
    try {
      rules.push({ id: entry.id, pattern: new RegExp(entry.source, 'i') })
    } catch {
      // Unreachable by construction; keep the loop total regardless.
    }
  }
  for (const source of userExtra) {
    try {
      rules.push({ id: `ext:user:${source.slice(0, 60)}`, pattern: new RegExp(source) })
    } catch {
      // Invalid or oversized entry: skip this rule only; base and defaults stay armed.
    }
  }
  return rules
}

const DEFAULT_LINE_RULES = mergeExtraPatterns([])

/** Verdict of the base structural block-signal set. */
export interface BlockFailureVerdict {
  readonly hard: boolean
  readonly ruleIds: readonly string[]
}

/** Decide whether the whole block carries a hard failure signal (audit/grouping only — never gates the line pool). */
export function blockFailureVerdict(text: string, isError: boolean): BlockFailureVerdict {
  const ruleIds: string[] = []
  for (const rule of BASE_BLOCK_SIGNALS) {
    if (rule.test(text, isError)) ruleIds.push(rule.id)
  }
  return { hard: ruleIds.length > 0, ruleIds }
}

/** Capture context for one block's lines. */
export interface LinePoolContext {
  readonly seq: number
  readonly role: TriageRole
  readonly hardFailure: boolean
  /** Compiled rule set from `mergeExtraPatterns`; absent uses the default set. */
  readonly extraPatterns?: readonly LineRule[]
}

function usefulLines(text: string): string[] {
  return text.replace(/\n+$/, '').split('\n')
    .filter(line => {
      const trimmed = line.trim()
      return trimmed.length > 0 && trimmed !== '[stderr]' && !/^\[exit code:/.test(trimmed)
    })
}

/**
 * Verbatim per-line capture over the compiled rule set. Dedup by exact line
 * text within the block, 240-codepoint cap with ` …` marker, first-matching
 * rule wins the audit id (base order guarantees `line:failure-classic` wins
 * ties). Decoupled from block classification: soft-failure blocks pass through
 * with `hardFailure: false` and still yield lines.
 */
export function linePool(text: string, context: LinePoolContext): VerbatimLine[] {
  const rules = context.extraPatterns ?? DEFAULT_LINE_RULES
  const pool: VerbatimLine[] = []
  const seen = new Set<string>()
  for (const raw of usefulLines(text)) {
    const line = raw.trim()
    if (seen.has(line)) continue
    const matched = rules.find(rule => rule.pattern.test(line))
    if (matched === undefined) continue
    seen.add(line)
    const chars = Array.from(line)
    const truncated = chars.length > LINE_CAP
    const captured = truncated ? `${chars.slice(0, LINE_CAP).join('')} …` : line
    pool.push({
      seq: context.seq,
      role: context.role,
      text: captured,
      ruleId: matched.id,
      truncated,
      hardFailure: context.hardFailure,
    })
  }
  return pool
}
