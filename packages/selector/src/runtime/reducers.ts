/** Deterministic, evidence-backed reducers for fresh tool results. */

import { codePointLength } from './config.ts'
import { classifyToolSource } from './toolclass.ts'

/** Input shared by every fresh-result reducer. */
export interface ReducerInput {
  readonly toolName: string
  readonly argumentsText: string
  readonly text: string
  readonly budgetChars: number
  readonly sourceRef: string
  readonly isError: boolean
  /**
   * Orthogonal user gate for the `hypa-code-skeleton` candidate. Absent or
   * false keeps source-code content on its existing head/tail reducers.
   */
  readonly codeSkeleton?: boolean
}

/** One verified reducer candidate. */
export interface ReducerOutput {
  readonly text: string
  readonly reducer: string
  readonly lossy: boolean
  /**
   * Structured telemetry (task_4c/G7): how many ORIGINAL-event lines the
   * reducer elided, when the reducer knows it. Never printed into `text` —
   * host-side logging is what turns this into the compress→retrieve M/N ratio.
   */
  readonly elidedLines?: number
}

/** Internal face every reducer sees: the normalized text plus its line mapping. */
type PreparedInput = ReducerInput & {
  readonly lines: readonly NormalizedLine[]
  /** Gutter-stripped view of `text`; form detection reads this, never `text`. */
  readonly contentText: string
}

/**
 * Optional side-channel ranking (S1a/S1b) handed to the form-dispatched
 * reducers. Selection and order ONLY — the mechanical fold stays the sole
 * content authority, and `undefined` reproduces the mechanical output
 * byte-for-byte. The ranking itself always comes from outside the reducers:
 * the mechanical layer never calls a model.
 */
export interface ReductionRanking {
  /** Search file paths, most relevant first (S1a). Unknown paths are ignored. */
  readonly files?: readonly string[]
  /** Document section heading texts, most relevant first (S1b). */
  readonly sections?: readonly string[]
}

/**
 * Per-file search node summaries for the S1a rank prompt (SC8: the judgment
 * input must carry a content sample, not just the identifier). Derived from
 * the raw event text.
 */
export function searchNodeSummaries(text: string): readonly { readonly id: string, readonly count: number, readonly sample: string }[] {
  const groups = new Map<string, { count: number, sample: string }>()
  for (const line of splitLines(text)) {
    const match = PATH_LINE_PATTERN.exec(line)
    if (match === null) continue
    const path = match[1] ?? '<unknown>'
    const bucket = groups.get(path) ?? { count: 0, sample: Array.from(line.trim()).slice(0, 160).join('') }
    bucket.count += 1
    groups.set(path, bucket)
  }
  return [...groups.entries()].map(([id, bucket]) => ({ id, count: bucket.count, sample: bucket.sample }))
}

/**
 * Per-section document node summaries for the S1b rank prompt: heading text,
 * level, section character mass, and the section's first content line (AD9:
 * headings are the author's structure, not the relevance structure).
 */
export function documentSectionSummaries(text: string): readonly { readonly id: string, readonly level: number, readonly chars: number, readonly sample: string }[] {
  const lines = splitLines(text)
  const headings: { id: string, level: number, line: number }[] = []
  for (let index = 0; index < lines.length; index++) {
    const match = /^#{1,6}\s+(.*)$/.exec(lines[index] ?? '')
    if (match !== null) headings.push({ id: match[1]!.trim(), level: (lines[index]!.match(/^#+/) ?? ['#'])[0]!.length, line: index })
  }
  return headings.map((heading, position) => {
    const from = heading.line + 1
    const to = position + 1 < headings.length ? headings[position + 1]!.line : lines.length
    let chars = 0
    let sample = ''
    for (let index = from; index < to; index++) {
      const line = lines[index] ?? ''
      if (line.trim() === '') continue
      chars += line.length + 1
      if (sample === '') sample = Array.from(line.trim()).slice(0, 160).join('')
    }
    return { id: heading.id, level: heading.level, chars, sample }
  })
}

/** Ranked-first ordering: ranked ids keep their rank, the rest append in order. */
function rankedFirst<T extends { readonly id: string }>(items: readonly T[], ranking: readonly string[] | undefined): readonly T[] {
  if (ranking === undefined || ranking.length === 0) return items
  const ranked = new Map<string, T>()
  for (const id of ranking) {
    const found = items.find(item => item.id === id)
    if (found !== undefined && !ranked.has(id)) ranked.set(id, found)
  }
  return [...ranked.values(), ...items.filter(item => !ranked.has(item.id))]
}

const ANSI_PATTERN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu
const IMPORTANT_PATTERN = new RegExp([
  String.raw`\b(?:error|failed|failure|fatal|panic|exception|warning|warn|conflict|denied|forbidden|`,
  String.raw`timeout|timed out|not found|cannot|unable|invalid|exit(?:ed)?\s+(?:code|status)|traceback|`,
  String.raw`assert(?:ion)?|segmentation fault|oom|out of memory)\b`,
].join(''), 'i')
const STATUS_PATTERN = new RegExp([
  String.raw`\b(?:success|succeeded|passed|installed|added|removed|updated|built|compiled|`,
  String.raw`tests?\s+(?:passed|failed)|exit(?:ed)?\s+(?:code|status))\b`,
].join(''), 'i')
const PATH_LINE_PATTERN = /^(.*?):(\d+)(?::\d+)?(?::|\s+-\s+)(.*)$/
const GIT_STATUS_PATTERN = new RegExp([
  String.raw`^(?:On branch|Your branch|HEAD detached|Changes |Untracked |Unmerged |\s*(?:modified|deleted|`,
  String.raw`new file|renamed|both modified):)`,
].join(''), 'i')
const CODE_IMPORT_PATTERN = new RegExp([
  String.raw`^\s*(?:import\b|from\s+[\w.]+\s+import\b|use\s+\w|package\s+|#include\b|`,
  String.raw`using\s+[\w.]+;|require\s*\(|extern\s+crate\b)`,
].join(''))
const CODE_STRUCTURE_PATTERN = new RegExp([
  String.raw`^\s*(?:@[\w.]+|export\s+|default\s+|declare\s+|abstract\s+|public\s+|private\s+|protected\s+|`,
  String.raw`internal\s+|static\s+|final\s+|sealed\s+|override\s+|pub(?:\([^)]*\))?\s+|async\s+|unsafe\s+)*`,
  String.raw`(?:function\b|class\b|interface\b|enum\b|struct\b|impl\b|trait\b|type\s+\w|fn\s|func\b|`,
  String.raw`def\s|module\b|namespace\b|sub\s)`,
].join(''))
const PYTHON_STRUCTURE_PATTERN = /^\s*(?:async\s+)?def\s|^\s*class\s/
const CODE_DECORATOR_PATTERN = /^\s*@[\w.]+/
const CODE_COMMENT_PATTERN = /^\s*(?:\/\/|#|\/\*|\*)/
const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s+\S/
const LIST_ITEM_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+\S/
const TABLE_ROW_PATTERN = /^\s*\|/
const FENCE_PATTERN = /^\s*(?:```|~~~)/
const UUID_PATTERN = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g
const LONG_HEX_PATTERN = /\b[0-9a-fA-F]{64,}\b/g
const LONG_BASE64_PATTERN = /[A-Za-z0-9+/]{200,}={0,2}/g
const HTML_TAG_PATTERN = /<!DOCTYPE html|<html\b|<head\b|<div\b|<span\b|<script\b|<style\b|<body\b|<p>|<table\b|<a\s/i
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g
const HTML_DROPPED_ELEMENTS = /<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const HTML_DATA_URI_PATTERN = /\s(?:src|href)="data:[^"]*"/gi
const HTML_TAG_PATTERN_FULL = /<([a-z][a-z0-9]*)((?:\s[^<>]*?)?)\/?>/gi
const HTML_INLINE_TAG_PATTERN = /<\/?(?:em|strong|b|i|u|s|code|small|sub|sup|span|br)\b[^<>]*>/gi
const HTML_WHITELISTED_ATTRIBUTES = /\s(?:href|src|alt|title|id)="[^"]*"/gi
const ADJACENT_REPEAT_MARKER = '[previous line repeated'
/** Non-adjacent folding only pays off once a line recurs enough to beat the marker cost. */
const NON_ADJACENT_FOLD_THRESHOLD = 3
/** Read-output line-number gutter added unconditionally by the host's `formatReadOutput`. */
const READ_GUTTER_PATTERN = /^(\d+): ?/

/**
 * Block-level read-gutter detection (GF-1). The host prefixes read output with
 * `N: ` line numbers unconditionally and cannot be configured off. The gutter
 * is only recognized when the block as a whole reads like a numbered listing —
 * enough non-empty lines, a large majority guttered, and the numbers strictly
 * increasing — so prose like `12:30 pm` (one stray gutter-looking line) is
 * never stripped. The stripping happens on the CONTENT view only; the output
 * view keeps the gutter because it is the model's only inline locator into the
 * original file (and its measured cost, 9.16% of read bodies, never gets
 * retrieved anyway).
 */
function hasReadGutter(lines: readonly string[]): boolean {
  let nonEmpty = 0
  let guttered = 0
  let previousNumber = 0
  for (const line of lines) {
    if (line.trim() === '') continue
    nonEmpty += 1
    const match = READ_GUTTER_PATTERN.exec(line)
    if (match === null) continue
    const number = Number(match[1])
    if (number <= previousNumber) return false
    previousNumber = number
    guttered += 1
  }
  return nonEmpty >= 4 && guttered / nonEmpty >= 0.75
}

/**
 * Replace long opaque literals with length summaries (R12). Data URIs, base64
 * blobs, and long hex dumps are pure noise in a compressed view; the prefix is
 * kept so the model can still recognize the value. Short strings are never
 * touched, and replacements never span lines, so the line mapping survives.
 */
function placeholderizeLongStrings(line: string): string {
  if (!/[0-9a-zA-Z+/]{32}/.test(line) && !/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(line)) return line
  let result = line.replace(UUID_PATTERN, '[uuid]')
  result = result.replace(LONG_HEX_PATTERN, (match) => `[hex ${String(match.length)} chars: ${match.slice(0, 16)}…]`)
  result = result.replace(LONG_BASE64_PATTERN, (match) => `[base64 ${String(match.length)} chars: ${match.slice(0, 16)}…]`)
  return result
}

/**
 * Select a reducer from verified tool, command, and content evidence.
 * @param input - original result text, recovery source, and output budget.
 * @returns a verified candidate, or `null` when every reducer fails open.
 */
export function reduceFreshToolResult(input: ReducerInput, ranking?: ReductionRanking): ReducerOutput | null {
  const normalized = normalizeTerminalLines(input.text)
  const prepared: PreparedInput = {
    ...input,
    text: normalized.text,
    lines: normalized.folded,
    contentText: normalized.contentText,
  }
  const command = extractCommand(input.argumentsText)
  const name = input.toolName.toLowerCase()
  const toolClass = classifyToolSource(input.toolName, command, normalized.contentText)
  // TOC-first (G6): for a large read-class result the structure lines ARE the
  // table of contents. The code skeleton gets a vote before head/tail
  // truncation, without waiting for the orthogonal `codeSkeleton` user gate.
  const readTocFirst = toolClass === 'read' && codePointLength(normalized.contentText) >= READ_TOC_MIN_CHARS
  const candidates: Array<() => ReducerOutput | null> = []

  if (looksLikeJson(normalized.contentText)) candidates.push(() => reduceJson(prepared))
  // R10-B (bundled/minified JS): must sit before every line-anchored candidate
  // — a bundle's statement structure lives INSIDE lines, not at line starts.
  if (looksLikeMinified(normalized.contentText)) candidates.push(() => reduceBundledJs(prepared))
  if (toolClass === 'search') candidates.push(() => reduceSearch(prepared, ranking?.files))
  if (isGitCommand(name, command)) candidates.push(() => reduceGit(prepared, command))
  if (isPackageCommand(command)) candidates.push(() => reducePatternLog(prepared, 'hypa-package', packagePattern()))
  if (isBuildOrTestCommand(command)) candidates.push(() => reducePatternLog(prepared, 'hypa-build-test', buildPattern()))
  if (looksLikeSourceCode(normalized.contentText)) {
    if (input.codeSkeleton === true) candidates.push(() => reduceCodeSkeleton(prepared))
    else if (readTocFirst) candidates.push(() => tocGuardedCodeSkeleton(prepared))
  }
  // Form-dispatched prose candidates (R8/R8b): classification reads content
  // shape only — never the tool name, the path extension, or the command.
  if (looksLikeHtml(normalized.contentText)) candidates.push(() => reduceHtml(prepared))
  if (looksLikeDocument(normalized.contentText)) candidates.push(() => reduceDocSkeleton(prepared, ranking?.sections))
  if (toolClass === 'shell' || command !== '') candidates.push(() => reduceShell(prepared))
  candidates.push(() => reduceProseKeep(prepared))
  if (toolClass === 'read') candidates.push(() => reduceHead(prepared, 'pi-head'))
  candidates.push(() => reduceSalient(prepared, 'generic-salience'))

  for (const make of candidates) {
    const candidate = make()
    if (candidate !== null && verifyReduction(input, candidate)) return candidate
  }
  return null
}

/**
 * Build a recoverable placeholder for an old tool result.
 * @param input - tool identity, source reference, size, status, and retained evidence.
 * @returns a lossy placeholder that cites the immutable source event.
 */
export function historicalPlaceholder(input: {
  readonly toolName: string
  readonly sourceRef: string
  readonly charsBefore: number
  readonly isError: boolean
  readonly text: string
  readonly compact?: boolean
}): ReducerOutput {
  const anchor = input.compact ? '' : importantAnchor(input.text, 360)
  // The retrieve hint starts at the anchor's ORIGINAL line: that is the one
  // row of context worth re-reading first (R9b site).
  const anchorLine = input.compact
    ? undefined
    : (normalizeTerminalLines(input.text).folded
      .find(line => IMPORTANT_PATTERN.test(line.text))
      ?? undefined)?.originalLine
  const retrieveHint = anchorLine === undefined
    ? `retrieve: context_compression_retrieve({"ref":"${input.sourceRef}"})`
    : `retrieve: context_compression_retrieve({"ref":"${input.sourceRef}","start_line":${String(anchorLine)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}})`
  const lines = [
    '[Old tool result content cleared from active context]',
    `tool: ${input.toolName || 'unknown'}`,
    `status: ${input.isError ? 'error' : 'completed'}`,
    `original_chars: ${String(input.charsBefore)}`,
    `source: ${input.sourceRef}`,
    retrieveHint,
  ]
  if (anchor !== '') lines.push(`retained_anchor: ${anchor}`)
  return {
    text: lines.join('\n'),
    reducer: input.compact ? 'pair-preserving-tail-aging' : 'historical-tool-result-aging',
    lossy: true,
  }
}

/**
 * Validate shrinkage, budget, recovery, and error retention.
 * @param input - original reducer input and its safety requirements.
 * @param output - candidate reduced text and reducer metadata.
 * @returns whether the candidate is safe to land.
 */
export function verifyReduction(input: ReducerInput, output: ReducerOutput): boolean {
  const before = codePointLength(input.text)
  const after = codePointLength(output.text)
  if (after <= 0 || after >= before || after > input.budgetChars) return false
  if (output.lossy && !output.text.includes(input.sourceRef)) return false
  if ((input.isError || IMPORTANT_PATTERN.test(input.text))
    && !IMPORTANT_PATTERN.test(output.text) && !output.text.includes('status: error')) return false
  return true
}

/**
 * Strip ANSI, collapse carriage-return progress redraws, and fold exact repeats.
 * @param text - raw terminal output.
 * @returns normalized terminal text.
 */
export function normalizeTerminalText(text: string): string {
  return normalizeTerminalLines(text).text
}

/** One folded output line that remembers its place in the original event. */
export interface NormalizedLine {
  /** Output view: byte-identical with the original event line (gutter kept). */
  readonly text: string
  /**
   * Content view: the same line with a block-detected read gutter (`N: `)
   * stripped. Form detection, skeleton retention, and repeat keys read this;
   * the printed output never does (GF-1 dual view).
   */
  readonly content: string
  /** 1-based line number in the ORIGINAL event text (before normalization). */
  readonly originalLine: number
  /**
   * Last original line this entry covers. Only the synthetic repeat marker
   * spans more than one original line (the occurrences it replaces).
   */
  readonly originalLineEnd?: number
}

export interface NormalizedTerminal {
  /** Adjacent-duplicate-folded lines; `folded.map(l => l.text).join('\n')` is `text`. */
  readonly folded: readonly NormalizedLine[]
  /** The folded text, byte-identical with `normalizeTerminalText`. */
  readonly text: string
  /** The folded text with the read gutter stripped (detection view). */
  readonly contentText: string
}

/**
 * Structured normalization (R9a): `retrieve` reads the original event, so any
 * line number a reducer prints must resolve against the ORIGINAL text, not the
 * normalized surface. ANSI stripping and `\r` redraw collapse never change the
 * line count (logical lines are 1:1 with original lines); only the adjacent
 * duplicate fold drops lines, so every folded entry carries the original line
 * (range) it was kept from.
 */
export function normalizeTerminalLines(text: string): NormalizedTerminal {
  const withoutAnsi = text.replace(ANSI_PATTERN, '')
  const logical = withoutAnsi.split('\n').map((line) => {
    const redraws = line.split('\r').filter(part => part !== '')
    return placeholderizeLongStrings(redraws.at(-1) ?? '')
  })
  const stripGutter = hasReadGutter(logical)
  const folded: NormalizedLine[] = []
  let previous: string | undefined
  let firstText = ''
  let count = 0
  let firstOriginal = 0
  const flush = (nextOriginal: number): void => {
    if (previous === undefined) return
    folded.push({ text: firstText, content: previous, originalLine: firstOriginal })
    if (count > 1) {
      const marker = `[previous line repeated ${String(count - 1)} more times]`
      folded.push({
        text: marker,
        content: marker,
        originalLine: firstOriginal + 1,
        originalLineEnd: nextOriginal - 1,
      })
    }
  }
  logical.forEach((line, index) => {
    const originalLine = index + 1
    const content = stripGutter ? line.replace(READ_GUTTER_PATTERN, '') : line
    if (content === previous) {
      count++
      return
    }
    flush(originalLine)
    previous = content
    firstText = line
    count = 1
    firstOriginal = originalLine
  })
  flush(logical.length + 1)
  const result = foldNonAdjacentRepeats(folded)
  return {
    folded: result,
    text: result.map(line => line.text).join('\n'),
    contentText: result.map(line => line.content).join('\n'),
  }
}

/**
 * Fold non-adjacent exact repeats (R11). Adjacent folding runs FIRST and only
 * handles consecutive runs (0.03–0.32% of real duplicate content); separated
 * repeats reached 8.37% in large results. Each surviving occurrence — a kept
 * line plus its optional adjacent-repeat marker — is one unit; once a text
 * recurs ≥ threshold times, the first unit is kept and every later unit is
 * replaced by ONE counted marker citing the original-event span it covers.
 * A pure consecutive run forms a single unit, so this pass is a no-op on it
 * and can never double-fold the adjacent marker.
 */
function foldNonAdjacentRepeats(folded: readonly NormalizedLine[]): NormalizedLine[] {
  interface Unit { readonly lead: NormalizedLine, repeat?: NormalizedLine }
  const units: Unit[] = []
  for (const entry of folded) {
    if (entry.text.startsWith(ADJACENT_REPEAT_MARKER) && units.length > 0) {
      units[units.length - 1]!.repeat = entry
    } else {
      units.push({ lead: entry })
    }
  }
  const totals = new Map<string, number>()
  for (const unit of units) totals.set(unit.lead.content, (totals.get(unit.lead.content) ?? 0) + 1)
  if (totals.size === units.length) return [...folded]
  // Precompute, per repeated text, where the first kept occurrence and the
  // last folded occurrence sit in the ORIGINAL event. Keys are the CONTENT
  // view: guttered read output numbers every line, so `900: )` and `950: )`
  // are different strings in the output view but the same content.
  const firstOriginal = new Map<string, number>()
  const lastOriginalEnd = new Map<string, number>()
  for (const unit of units) {
    const content = unit.lead.content
    if (totals.get(content)! < NON_ADJACENT_FOLD_THRESHOLD) continue
    if (!firstOriginal.has(content)) firstOriginal.set(content, unit.lead.originalLine)
    const end = unit.repeat?.originalLineEnd ?? unit.lead.originalLineEnd ?? unit.lead.originalLine
    lastOriginalEnd.set(content, end)
  }
  const seen = new Map<string, number>()
  const result: NormalizedLine[] = []
  for (const unit of units) {
    const content = unit.lead.content
    const total = totals.get(content)!
    if (total < NON_ADJACENT_FOLD_THRESHOLD) {
      result.push(unit.lead)
      if (unit.repeat !== undefined) result.push(unit.repeat)
      continue
    }
    if (!seen.has(content)) {
      seen.set(content, 1)
      result.push(unit.lead)
      if (unit.repeat !== undefined) result.push(unit.repeat)
      continue
    }
    const ordinal = (seen.get(content) ?? 1) + 1
    seen.set(content, ordinal)
    if (ordinal > 2) continue
    const end = lastOriginalEnd.get(content)!
    const marker = `[× ${String(total)} total: same as line ${String(firstOriginal.get(content)!)}; original lines ${String(unit.lead.originalLine)}-${String(end)}]`
    result.push({
      text: marker,
      content: marker,
      originalLine: unit.lead.originalLine,
      originalLineEnd: end,
    })
  }
  return result
}

/** Default line window a retrieve hint suggests the model paste. */
const RETRIEVE_HINT_MAX_LINES = 80

/**
 * TOC-first (G6): read-class results at or above this size let the code
 * skeleton compete before head/tail truncation. The 14,000-char boundary is
 * the studied real-read cohort (findings §7), well above p90 of actual reads
 * so ordinary results keep their existing dispatch.
 */
const READ_TOC_MIN_CHARS = 14_000
/**
 * A skeleton whose output is dominated by elision markers is worse than
 * head/tail for the model (task_4b risk: structure-poor files degenerate into
 * "almost all markers") — above this marker-char share the TOC candidate fails
 * open to the prose reducers.
 */
const TOC_MARKER_RATIO_LIMIT = 0.5

/**
 * Fail-open wrapper for the TOC-first code-skeleton candidate: a skeleton that
 * degenerates into mostly-elision markers (minified bundles, generated files)
 * returns null so the prose head/tail pair takes over.
 */
function tocGuardedCodeSkeleton(input: PreparedInput): ReducerOutput | null {
  const output = reduceCodeSkeleton(input)
  if (output === null) return null
  const total = codePointLength(output.text)
  const markerChars = output.text.split('\n')
    .filter(line => line.startsWith('[...'))
    .reduce((sum, line) => sum + codePointLength(line) + 1, 0)
  return markerChars / total > TOC_MARKER_RATIO_LIMIT ? null : output
}

/** R10a thresholds: one giant line, uniformly fat lines, or very few fat lines. */
const MINIFIED_MAX_LINE_CHARS = 2_000
const MINIFIED_AVG_LINE_CHARS = 300
const MINIFIED_FEW_LINES = 40
const MINIFIED_FEW_LINES_TOTAL_CHARS = 20_000

/**
 * Require form evidence of a bundled/minified module (R10a): line-anchored
 * reducers cannot see inside a 135k-character line, and R9 line ranges on a
 * 53-line bundle cannot address anything smaller than the whole file.
 * @param text - normalized result text.
 * @returns whether the text reads as a bundled/minified module.
 */
export function looksLikeMinified(text: string): boolean {
  const lines = splitLines(text)
  if (lines.length === 0) return false
  let total = 0
  let max = 0
  for (const line of lines) {
    const length = line.length
    total += length
    if (length > max) max = length
  }
  if (max > MINIFIED_MAX_LINE_CHARS) return true
  if (total / lines.length > MINIFIED_AVG_LINE_CHARS) return true
  return lines.length < MINIFIED_FEW_LINES && total > MINIFIED_FEW_LINES_TOTAL_CHARS
}

/**
 * Statement-level declaration patterns scanned GLOBALLY per line: a bundle's
 * statements are separated by `;` / `},{` / `);` inside one physical line, so
 * line-anchored matching is useless here. Reserved-name traces (`exports.*`,
 * `module.exports`) are extracted first and called out in the header because
 * minifiers rename local symbols.
 */
const BUNDLED_DECLARATION_PATTERNS: readonly RegExp[] = [
  /\bexports\.([A-Za-z_$][\w$]*)\s*=/g,
  /\bmodule\.exports\s*=\s*([A-Za-z_$][\w$]*)/g,
  /\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
  /\b([A-Za-z_$][\w$]*)\s*:\s*function\b/g,
]
const SOURCEMAP_DIRECTIVE = '//# sourceMappingURL='

/**
 * Bundled/minified JS directory (R10-B). The useful first answer is the
 * declaration/export directory — WHAT the bundle exposes — plus one honest
 * whole-span marker: the host's continuation is line-addressed, so a
 * line-range retrieve on a 53-line bundle hands back the whole file (R10d:
 * character-range retrieval is a separate, undecided extension).
 */
function reduceBundledJs(input: PreparedInput): ReducerOutput | null {
  const declarations = new Map<string, number>()
  for (const line of input.lines) {
    for (const pattern of BUNDLED_DECLARATION_PATTERNS) {
      pattern.lastIndex = 0
      let match = pattern.exec(line.content)
      while (match !== null) {
        const symbol = match[1]
        if (symbol !== undefined && !declarations.has(symbol)) declarations.set(symbol, line.originalLine)
        match = pattern.exec(line.content)
      }
    }
  }
  if (declarations.size === 0) return null
  const hasSourceMap = input.contentText.includes(SOURCEMAP_DIRECTIVE)
  const entries = [...declarations.entries()].sort((a, b) => a[1] - b[1])
  const header = `[bundled/minified JS detected; ${String(entries.length)} declarations; minified symbols may be renamed — exports.*/module.exports traces are the reliable ones;${hasSourceMap ? ' source map present, prefer reading the original source;' : ''} source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}"}) (line-addressed: single-line bundles come back whole)]`
  const kept = [header, ...entries.slice(0, 400).map(([symbol, line]) => `${symbol}  (line ${String(line)})`)]
  const start = input.lines[0]?.originalLine ?? 1
  const end = originalEnd(input.lines, input.lines.length - 1)
  if (end > start) kept.push(elidedRangeMarker(start, end))
  const text = fitLines(kept, input.budgetChars, input.sourceRef)
  return text === null ? null : { text, reducer: 'bundled-js-directory', lossy: true }
}

/**
 * Continuous-mask marker (R9b): cites the ORIGINAL-event line range it elides
 * and carries a pasteable retrieve hint starting at the first elided line.
 * Falls back to the compact plain marker when the hint would not fit.
 */
function reduceHead(input: PreparedInput, reducer: string): ReducerOutput | null {
  const marker = omissionMarker(input, reducer)
  const available = input.budgetChars - codePointLength(marker) - 1
  if (available <= 0) return null
  const head = takeWholeLinesFromHead(input.text, available)
  if (head === input.text || head === '') return null
  const keptCount = head.split('\n').length
  const firstElided = input.lines[keptCount]
  if (firstElided !== undefined) {
    const elidedEnd = originalEnd(input.lines, input.lines.length - 1)
    const ranged = rangeOmissionMarker(input, reducer, firstElided.originalLine, elidedEnd)
    if (codePointLength(head) + codePointLength(ranged) + 1 <= input.budgetChars) {
      return { text: `${head}\n${ranged}`, reducer, lossy: true }
    }
  }
  return { text: `${head}\n${marker}`, reducer, lossy: true }
}

function reduceTail(input: PreparedInput, reducer: string): ReducerOutput | null {
  const marker = omissionMarker(input, reducer)
  const available = input.budgetChars - codePointLength(marker) - 1
  if (available <= 0) return null
  const tail = takeWholeLinesFromTail(input.text, available)
  if (tail === input.text || tail === '') return null
  const firstKept = input.lines.length - tail.split('\n').length
  if (firstKept > 0) {
    const elidedEnd = originalEnd(input.lines, firstKept - 1)
    const ranged = rangeOmissionMarker(input, reducer, input.lines[0]!.originalLine, elidedEnd)
    if (codePointLength(ranged) + codePointLength(tail) + 1 <= input.budgetChars) {
      return { text: `${ranged}\n${tail}`, reducer, lossy: true }
    }
  }
  return { text: `${marker}\n${tail}`, reducer, lossy: true }
}

function reduceJson(input: PreparedInput): ReducerOutput | null {
  let value: unknown
  try {
    value = JSON.parse(input.text)
  } catch {
    return null
  }
  const minified = JSON.stringify(value)
  if (codePointLength(minified) < codePointLength(input.text)
    && codePointLength(minified) <= input.budgetChars) {
    return { text: minified, reducer: 'json-minify', lossy: false }
  }
  const envelope = {
    $dsh_compression: {
      kind: 'json-preview',
      source: input.sourceRef,
      original_chars: codePointLength(input.text),
    },
    value: shrinkJson(value, 0),
  }
  const text = JSON.stringify(envelope, null, 2)
  if (codePointLength(text) <= input.budgetChars) {
    return { text, reducer: 'json-structure-preview', lossy: true }
  }
  return null
}

function shrinkJson(value: unknown, depth: number): unknown {
  if (depth >= 5) {
    if (Array.isArray(value)) return `[array length=${String(value.length)} omitted]`
    if (typeof value === 'object' && value !== null) return '[object omitted]'
    return value
  }
  if (Array.isArray(value)) {
    if (value.length <= 8) return value.map(entry => shrinkJson(entry, depth + 1))
    return [
      ...value.slice(0, 3).map(entry => shrinkJson(entry, depth + 1)),
      { $dsh_omitted_items: value.length - 5 },
      ...value.slice(-2).map(entry => shrinkJson(entry, depth + 1)),
    ]
  }
  if (typeof value !== 'object' || value === null) {
    if (typeof value === 'string' && codePointLength(value) > 800) {
      return `${Array.from(value).slice(0, 500).join('')}…[${String(codePointLength(value) - 700)} chars omitted]…${Array.from(value).slice(-200).join('')}`
    }
    return value
  }
  const entries = Object.entries(value)
  const important = entries.filter(([key]) => /error|warn|status|code|message|path|file|line|summary/i.test(key))
  const selected = entries.length <= 18
    ? entries
    : [...entries.slice(0, 10), ...important.filter(entry => !entries.slice(0, 10).includes(entry)).slice(0, 6), ...entries.slice(-2)]
  const result: Record<string, unknown> = {}
  for (const [key, entry] of selected) result[key] = shrinkJson(entry, depth + 1)
  if (selected.length < entries.length) result.$dsh_omitted_keys = entries.length - selected.length
  return result
}

/**
 * Two-tier search folding (R10). L1 is a LOSSLESS per-file locator —
 * `## <path> (<N> matches)  L12,L15,…` — one line number per hit, taken from
 * the hit's own `path:line` prefix (falling back to the original-event line).
 * L2 is the content quota, water-filled round-robin so no file vanishes and
 * no file runs more than one row ahead of another; the budget is reserved for
 * L1 first. When L1 itself cannot fit, the shortfall is ANNOUNCED
 * (withheld file/match counts) — never silently truncated. Outputs without
 * any `path:line` form fail open to salience.
 */
function reduceSearch(input: PreparedInput, fileRanking?: readonly string[]): ReducerOutput | null {
  interface Row { readonly text: string, readonly fileLine: number, readonly important: boolean }
  const groups = new Map<string, Row[]>()
  const ungrouped: Row[] = []
  input.lines.forEach((line) => {
    const match = PATH_LINE_PATTERN.exec(line.text)
    const row: Row = {
      text: line.text,
      fileLine: match !== null ? Number(match[2]) : line.originalLine,
      important: IMPORTANT_PATTERN.test(line.text),
    }
    if (match === null) {
      ungrouped.push(row)
      return
    }
    const path = match[1] ?? '<unknown>'
    const bucket = groups.get(path) ?? []
    bucket.push(row)
    groups.set(path, bucket)
  })
  if (groups.size === 0) return reduceSalient(input, 'search-salience')

  const totalMatches = [...groups.values()].reduce((sum, rows) => sum + rows.length, 0)
  const locatorFor = (path: string, rows: readonly Row[]): string =>
    `## ${path} (${String(rows.length)} matches)  ${rows.map(row => `L${String(row.fileLine)}`).join(',')}`
  // Rows within a file are offered to the quota important-first, then by
  // line. Files are visited in side-channel rank order when one was supplied
  // (ranked files first, the rest in original order) — the water-filling
  // round order is the only thing ranking changes.
  const perFile = new Map<string, Row[]>()
  for (const entry of rankedFirst([...groups.entries()].map(([id, rows]) => ({ id, rows })), fileRanking)) {
    perFile.set(entry.id, [...entry.rows].sort((a, b) => a.important === b.important
      ? a.fileLine - b.fileLine
      : a.important ? -1 : 1))
  }
  const allLocators = [...perFile.keys()].map(path => locatorFor(path, groups.get(path)!))

  const headerFor = (l2Rows: number, omitted: number): string =>
    `[search results compressed; ${String(groups.size)} files, ${String(totalMatches)} matches; ${String(l2Rows)} content rows shown, ${String(omitted)} matches omitted; source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}"})]`

  // L2 water-filling: one unchosen row per file per round, so no file
  // disappears and no file outpaces another by more than one round. Important
  // rows are offered first within each file.
  const fillL2 = (output: string[], quotaChars: number): { shown: number, omitted: number } => {
    let used = 0
    let shown = 0
    let round = 0
    let progress = true
    while (progress && round < 512) {
      progress = false
      for (const rows of perFile.values()) {
        if (round >= rows.length) continue
        const row = rows[round]!
        const cost = codePointLength(row.text) + 1
        if (used + cost > quotaChars) continue
        output.push(row.text)
        used += cost
        shown += 1
        progress = true
      }
      round += 1
    }
    // Locator-less important rows keep their bounded salience slot.
    for (const row of ungrouped.filter(entry => entry.important).slice(0, 12)) {
      const cost = codePointLength(row.text) + 1
      if (used + cost > quotaChars) break
      output.push(row.text)
      used += cost
      shown += 1
    }
    return { shown, omitted: totalMatches - shown }
  }

  const finish = (output: readonly string[]): ReducerOutput | null => {
    const text = output.join('\n')
    return text.includes(input.sourceRef) ? { text, reducer: 'search-by-file', lossy: true } : null
  }

  const headerProbe = headerFor(0, 0)
  const budget = input.budgetChars - codePointLength(headerProbe) - 2
  if (budget <= 0) return null
  const locatorCost = allLocators.reduce((sum, line) => sum + codePointLength(line) + 1, 0)
  if (locatorCost > budget) {
    // Visible degradation: include locators while they fit, ANNOUNCE the rest.
    // The announcement line's own cost is reserved up front so the final text
    // stays inside the budget and survives verifyReduction.
    const announcementReserve = 160
    const output: string[] = []
    let used = 0
    let withheldFiles = 0
    let withheldMatches = 0
    for (let index = 0; index < allLocators.length; index++) {
      const cost = codePointLength(allLocators[index]!) + 1 + announcementReserve
      if (used + cost > budget) {
        withheldFiles = allLocators.length - index
        withheldMatches = totalMatches
          - [...groups.values()].slice(0, index).reduce((sum, rows) => sum + rows.length, 0)
        break
      }
      output.push(allLocators[index]!)
      used += cost - announcementReserve
    }
    if (withheldFiles > 0) {
      output.push(`[L1 locator partially withheld: ${String(withheldFiles)} file(s) / ${String(withheldMatches)} matches' line lists did not fit the budget; retrieve for the full hit list]`)
    }
    const { shown, omitted } = fillL2(output, Math.max(0, budget - used - (withheldFiles > 0 ? announcementReserve : 0)))
    output.unshift(headerFor(shown, omitted + withheldMatches))
    return finish(output)
  }
  const output: string[] = [...allLocators]
  const { shown, omitted } = fillL2(output, budget - locatorCost)
  output.unshift(headerFor(shown, omitted))
  return finish(output)
}

function reduceGit(input: PreparedInput, command: string): ReducerOutput | null {
  const lines = input.lines
  const lower = command.toLowerCase()
  let keep: string[]
  let reducer: string
  if (/\bgit\s+(?:diff|show)\b/.test(lower)) {
    reducer = 'hypa-git-diff'
    keep = lines.map(line => line.text).filter(line => /^(?:diff --git|index |--- |\+\+\+ |@@ |[+-](?![+-]))/.test(line)
      || IMPORTANT_PATTERN.test(line))
  } else if (/\bgit\s+(?:status|switch|checkout|merge|rebase|cherry-pick)\b/.test(lower)) {
    reducer = 'hypa-git-status'
    keep = lines.map(line => line.text).filter(line => GIT_STATUS_PATTERN.test(line)
      || IMPORTANT_PATTERN.test(line))
  } else {
    reducer = 'hypa-git-log'
    keep = lines.map(line => line.text).filter(line => /^(?:commit\s+[0-9a-f]+|Author:|Date:|[0-9a-f]{7,}\s)/i.test(line)
      || IMPORTANT_PATTERN.test(line))
  }
  if (keep.length === 0) return reduceSalient(input, reducer)
  const header = `[git output compressed; ${scannedTotals(input, keep.length)}; source: ${input.sourceRef}; scatter-masked: retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","query":"<keyword>"}) for missed rows]`
  const text = fitLines([header, ...keep, ...lines.slice(-8).map(line => line.text)], input.budgetChars, input.sourceRef)
  return text === null ? null : { text, reducer, lossy: true }
}

function reducePatternLog(input: PreparedInput, reducer: string, pattern: RegExp): ReducerOutput | null {
  const lines = input.lines
  const kept = lines.filter(line => pattern.test(line.text) || IMPORTANT_PATTERN.test(line.text) || STATUS_PATTERN.test(line.text))
  const header = `[command output compressed by ${reducer}; ${scannedTotals(input, kept.length)}; source: ${input.sourceRef}; scatter-masked: retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","query":"<keyword>"}) for missed rows]`
  const text = fitLines([header, ...kept.map(line => line.text), ...lines.slice(-20).map(line => line.text)], input.budgetChars, input.sourceRef)
  return text === null ? null : { text, reducer, lossy: true }
}

function reduceShell(input: PreparedInput): ReducerOutput | null {
  const lines = input.lines
  const important = lines.filter(line => IMPORTANT_PATTERN.test(line.text))
  if (important.length === 0) return reduceTail(input, 'pi-tail')
  const header = `[shell/log output compressed; ${scannedTotals(input, important.length)}; source: ${input.sourceRef}; scatter-masked: retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","query":"<keyword>"}) for missed rows]`
  const text = fitLines([header, ...important.map(line => line.text), '--- final output ---', ...lines.slice(-40).map(line => line.text)], input.budgetChars, input.sourceRef)
  return text === null ? null : { text, reducer: 'shell-salience-tail', lossy: true }
}

function reduceSalient(input: PreparedInput, reducer: string): ReducerOutput | null {
  const lines = input.lines
  if (lines.length < 3) return reduceHead(input, reducer)
  const marker = omissionMarker(input, reducer)
  const headBudget = Math.max(1, Math.floor((input.budgetChars - codePointLength(marker)) * 0.34))
  const tailBudget = headBudget
  const head = takeWholeLinesFromHead(input.text, headBudget)
  const tail = takeWholeLinesFromTail(input.text, tailBudget)
  const salient = lines.filter(line => IMPORTANT_PATTERN.test(line.text) || STATUS_PATTERN.test(line.text)).slice(0, 24)
  const keptCount = head.split('\n').length + salient.length + tail.split('\n').length
  const text = fitLines([head, ...salient.map(line => line.text), `${marker} [${scannedTotals(input, keptCount)}]`, tail], input.budgetChars, input.sourceRef)
  return text === null ? null : { text, reducer, lossy: true }
}

/**
 * Require content evidence of a structured document: enough Markdown heading
 * lines among a bounded prefix. Pure form evidence — tool names, path
 * extensions, and commands are never read (MCP output has no predictable
 * identity). Real logs and build output carry no `#`-heading lines, which is
 * the misjudgment guard.
 * @param text - normalized result text.
 * @returns whether the text qualifies as a structured document.
 */
export function looksLikeDocument(text: string): boolean {
  const lines = splitLines(text)
  let headings = 0
  // C26 (AD5): the window covers 600 lines so a document whose headings only
  // start past line 400 still reaches doc-skeleton; the `^#{1,6}\s+\S` anchor
  // itself is unchanged (RK-4 — pure logs carry no heading lines).
  for (const line of lines.slice(0, 600)) {
    if (MARKDOWN_HEADING_PATTERN.test(line)) {
      headings += 1
      if (headings >= 3) return true
    }
  }
  return false
}

/** One R9-spec elision marker: an original-event line range plus its count. */
function elidedRangeMarker(start: number, end: number): string {
  return `[... lines ${String(start)}-${String(end)} elided (${String(end - start + 1)} lines) ...]`
}

/**
 * Require content evidence of HTML: enough lines carrying real markup tags
 * among a bounded prefix. Angle-bracket prose (TS generics, comparisons) does
 * not match the tag list, which is the misjudgment guard.
 */
function looksLikeHtml(text: string): boolean {
  const lines = splitLines(text)
  let tags = 0
  for (const line of lines.slice(0, 400)) {
    if (HTML_TAG_PATTERN.test(line)) {
      tags += 1
      if (tags >= 3) return true
    }
  }
  return false
}

const HTML_DROPPED_OPEN = /<(script|style|noscript|svg|head)\b[^>]*>/i

/** One stage-1 survivor; `marker` entries are synthetic repeated-block folds. */
interface HtmlSlimEntry { readonly text: string, readonly index: number, readonly marker?: boolean }

const HTML_BLOCK_MIN_LINES = 2
const HTML_BLOCK_MAX_LINES = 8
const HTML_BLOCK_MIN_OCCURRENCES = 3
const HTML_TABLE_TAG_PATTERN = /<table\b|<tr\b|<th\b|<\/tr\b|<\/table\b/i

/**
 * Deterministic repeated-block folding for slimmed HTML (R4/RK-3): contiguous
 * runs of 2–8 non-table lines whose digit-normalized signature recurs ≥3 times
 * keep their first occurrence; every later occurrence becomes ONE counted
 * marker. Tables never fold, and different copy never shares a signature —
 * only counter/number drift does.
 */
export function foldRepeatedHtmlBlocks(
  slim: readonly { readonly text: string, readonly index: number }[],
  originalLineFor: (index: number) => number,
): readonly HtmlSlimEntry[] {
  const signatureOf = (from: number, length: number): string | null => {
    let signature = `${String(length)}|`
    for (let position = from; position < from + length; position++) {
      const text = slim[position]!.text
      if (HTML_TABLE_TAG_PATTERN.test(text)) return null
      signature += `${text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()}\n`
    }
    return signature
  }
  const counts = new Map<string, { count: number, first: number }>()
  for (let length = HTML_BLOCK_MIN_LINES; length <= HTML_BLOCK_MAX_LINES; length++) {
    for (let start = 0; start + length <= slim.length; start++) {
      const signature = signatureOf(start, length)
      if (signature === null) continue
      const bucket = counts.get(signature)
      if (bucket === undefined) counts.set(signature, { count: 1, first: start })
      else bucket.count += 1
    }
  }
  const result: HtmlSlimEntry[] = []
  let position = 0
  while (position < slim.length) {
    let foldedLength = 0
    let matched: { count: number, first: number } | undefined
    for (let length = HTML_BLOCK_MAX_LINES; length >= HTML_BLOCK_MIN_LINES; length--) {
      if (position + length > slim.length) continue
      const signature = signatureOf(position, length)
      const bucket = signature === null ? undefined : counts.get(signature)
      if (bucket !== undefined && bucket.count >= HTML_BLOCK_MIN_OCCURRENCES) {
        foldedLength = length
        matched = bucket
        break
      }
    }
    if (matched === undefined) {
      result.push({ text: slim[position]!.text, index: slim[position]!.index })
      position += 1
      continue
    }
    if (matched.first === position) {
      for (let offset = 0; offset < foldedLength; offset++) {
        result.push({ text: slim[position + offset]!.text, index: slim[position + offset]!.index })
      }
    } else {
      const firstLine = originalLineFor(slim[matched.first]!.index)
      result.push({
        text: `[×${String(matched.count)} repeated block, first at line ${String(firstLine)}]`,
        index: slim[position]!.index,
        marker: true,
      })
    }
    position += foldedLength
  }
  return result
}

/**
 * Two-stage HTML reduction (R13). HTML previously fell into `pi-head`, which
 * keeps exactly the useless `<head>` metadata and drops the body.
 *
 * Stage 1 (`html-slim`) is a deterministic, line-aligned slimming pass:
 * comments, script/style/noscript/svg/head elements (single- or multi-line),
 * data URIs, non-whitelisted attributes, and inline-tag markup disappear;
 * every surviving line keeps its original-event position for the R9 ranges.
 * Stage 2 (`html-skeleton`) runs only when the slim output still exceeds the
 * budget: heading hierarchy, each section's first line, and table header rows
 * survive; the rest is elided with original-event line ranges.
 */
function reduceHtml(input: PreparedInput): ReducerOutput | null {
  interface SlimLine { readonly text: string, readonly index: number }
  const slim: SlimLine[] = []
  let dropping: string | null = null
  input.lines.forEach((line, index) => {
    let text = line.content
    if (dropping !== null) {
      const close = new RegExp(`</${dropping}\\s*>`, 'i').exec(text)
      if (close === null) return
      text = text.slice(close.index + close[0].length)
      dropping = null
    }
    text = text.replace(HTML_COMMENT_PATTERN, '')
    text = text.replace(HTML_DROPPED_ELEMENTS, '')
    const open = HTML_DROPPED_OPEN.exec(text)
    if (open !== null) {
      const close = new RegExp(`</${open[1] ?? ''}\\s*>`, 'i').exec(text.slice(open.index))
      if (close !== null) {
        const end = open.index + open[0].length + close.index + close[0].length
        text = text.slice(0, open.index) + text.slice(end)
      } else {
        dropping = open[1] ?? null
        text = text.slice(0, open.index)
      }
    }
    text = text.replace(HTML_DATA_URI_PATTERN, '')
    text = text.replace(HTML_TAG_PATTERN_FULL, (match: string, name: string, attrs: string) =>
      `<${name}${attrs.match(HTML_WHITELISTED_ATTRIBUTES)?.join('') ?? ''}>`)
    text = text.replace(HTML_INLINE_TAG_PATTERN, '')
    text = text.trim()
    if (text !== '') slim.push({ text, index })
  })
  if (slim.length === 0) return null

  const buildHeader = (reducer: string, firstElided?: { readonly start: number }): string => {
    const startLine = firstElided === undefined ? '' : `,"start_line":${String(firstElided.start)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}`
    return `[html compressed by ${reducer}; source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}"${startLine}})]`
  }

  // Third level (R4): deterministic repeated-block folding. Nav/footer/
  // boilerplate runs of ≥2 slimmed lines that recur ≥3 times collapse to a
  // counted marker citing the first occurrence's original line. Table blocks
  // never fold (their rows are the payload), and the signature normalizes
  // digits so counter-only variants still match while different copy does not.
  const foldedSlim = foldRepeatedHtmlBlocks(slim, index =>
    input.lines[index]?.originalLine ?? 1)

  const slimChars = foldedSlim.reduce((sum, line) => sum + codePointLength(line.text) + 1, 0)
  if (slimChars + 160 <= input.budgetChars) {
    const text = fitLines([buildHeader('html-slim'), ...foldedSlim.map(line => line.text)], input.budgetChars, input.sourceRef)
    if (text !== null) return { text, reducer: 'html-slim', lossy: true }
  }

  // Stage 2: tag-aware skeleton over the slimmed lines.
  const keep = new Array<boolean>(foldedSlim.length).fill(false)
  let tableRows = 0
  let lastHeading = -2
  for (let position = 0; position < foldedSlim.length; position++) {
    const text = foldedSlim[position]!.text
    if (foldedSlim[position]!.marker === true) {
      keep[position] = true
      continue
    }
    if (/<h[1-6]\b/i.test(text)) {
      keep[position] = true
      lastHeading = position
      continue
    }
    if (lastHeading === position - 1) {
      // First content line of the section keeps one sentence of context.
      keep[position] = true
      continue
    }
    if (/<table\b|<tr\b|<th\b/i.test(text)) {
      // Header + separator rows survive, matching the reduceDocSkeleton
      // `< 2` convention — one lone row is not table structure (R4).
      if (tableRows < 2) keep[position] = true
      tableRows += 1
      continue
    }
    if (!/<\/(tr|table)\b/i.test(text)) tableRows = 0
    if (IMPORTANT_PATTERN.test(text)) keep[position] = true
  }
  const kept: string[] = []
  let position = 0
  let firstElided: number | undefined
  let elidedLines = 0
  while (position < foldedSlim.length) {
    if (keep[position]) {
      kept.push(foldedSlim[position]!.text)
      position += 1
      continue
    }
    const runStart = position
    while (position < foldedSlim.length && !keep[position]) position += 1
    const start = input.lines[foldedSlim[runStart]!.index]!.originalLine
    const end = originalEnd(input.lines, foldedSlim[position - 1]!.index)
    if (firstElided === undefined) firstElided = start
    elidedLines += end - start + 1
    kept.push(elidedRangeMarker(start, end))
  }
  const text = fitLines([buildHeader('html-skeleton', firstElided === undefined ? undefined : { start: firstElided }), ...kept], input.budgetChars, input.sourceRef)
  return text === null ? null : { text, reducer: 'html-skeleton', lossy: true, elidedLines }
}

/** Original-event end line of folded entry `lines[index]`. */
function originalEnd(lines: readonly NormalizedLine[], index: number): number {
  const line = lines[index]
  return line?.originalLineEnd ?? line?.originalLine ?? 0
}

/**
 * Keep a document skeleton: the heading hierarchy, each section's first and
 * last content line, list-item starts, table headers, and fence markers,
 * eliding the remaining bodies with R9 line-range markers. Fails open (null)
 * when nothing is elidable or the budget cannot be met, so the next candidate
 * takes over.
 */
function reduceDocSkeleton(input: PreparedInput, sectionRanking?: readonly string[]): ReducerOutput | null {
  const lines = input.lines
  const keep = new Array<boolean>(lines.length).fill(false)
  const headingIndex: number[] = []
  let inFence = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.content
    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence
      keep[index] = true
      continue
    }
    if (!inFence && MARKDOWN_HEADING_PATTERN.test(line)) {
      headingIndex.push(index)
      keep[index] = true
      continue
    }
    if (IMPORTANT_PATTERN.test(line)) keep[index] = true
    else if (!inFence && LIST_ITEM_PATTERN.test(line)) keep[index] = true
  }
  // Table blocks keep their first two rows (header + separator) in every
  // variant — table structure is part of the skeleton, not section content.
  let tableRows = 0
  let fenceOpen = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.content
    if (FENCE_PATTERN.test(line)) {
      fenceOpen = !fenceOpen
      tableRows = 0
      continue
    }
    if (fenceOpen || line.trim() === '') continue
    if (TABLE_ROW_PATTERN.test(line)) {
      if (tableRows < 2) keep[index] = true
      tableRows += 1
      continue
    }
    tableRows = 0
  }
  const sectionStarts = [-1, ...headingIndex]
  const sectionEnds = [...headingIndex, lines.length]
  const sections = headingIndex.map((heading, position) => ({
    id: lines[heading]!.content.replace(/^#+\s*/, '').trim(),
    heading,
    from: heading + 1,
    to: position + 1 < headingIndex.length ? headingIndex[position + 1]! : lines.length,
  }))
  // Mechanical floor: every section keeps its first and last content line.
  const floorKeep = new Array<boolean>(lines.length).fill(false)
  for (let section = 0; section < sectionStarts.length; section++) {
    const from = sectionStarts[section]! + 1
    const to = sectionEnds[section]!
    let first = -1
    let last = -1
    for (let index = from; index < to; index++) {
      if (lines[index]!.content.trim() === '') continue
      if (first === -1) first = index
      last = index
    }
    if (first !== -1) floorKeep[first] = true
    if (last !== -1) floorKeep[last] = true
  }

  /** Emit the skeleton for one keep-set: header, kept lines, R9 range markers. */
  const assemble = (flags: readonly boolean[], budget: number): { text: string | null, firstElided?: number, elidedLines: number } => {
    const kept: string[] = []
    let index = 0
    let firstElided: number | undefined
    let elidedLines = 0
    while (index < lines.length) {
      if (flags[index]) {
        kept.push(lines[index]!.text)
        index += 1
        continue
      }
      const runStart = index
      while (index < lines.length && !flags[index]) index += 1
      const start = lines[runStart]!.originalLine
      const end = originalEnd(lines, index - 1)
      if (firstElided === undefined) firstElided = start
      elidedLines += end - start + 1
      kept.push(elidedRangeMarker(start, end))
    }
    const hint = firstElided === undefined
      ? ''
      : `,"start_line":${String(firstElided)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}`
    kept.unshift(`[document compressed by doc-skeleton; source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}"${hint}})]`)
    const text = fitLines(kept, budget, input.sourceRef)
    return { text, ...(firstElided === undefined ? {} : { firstElided }), elidedLines }
  }

  const combine = (base: readonly boolean[], overlay: readonly boolean[]): boolean[] =>
    lines.map((_, index) => (base[index] ?? false) || (overlay[index] ?? false))

  // Structural lines (headings/fences/important/list items) are part of every
  // variant; the mechanical floor rides on top of them.
  const mechanicalKeep = combine(keep, floorKeep)
  const mechanical = assemble(mechanicalKeep, input.budgetChars)
  if (mechanical.text === null) return null
  if (sectionRanking === undefined || sectionRanking.length === 0) {
    return { text: mechanical.text, reducer: 'doc-skeleton', lossy: true, elidedLines: mechanical.elidedLines }
  }

  // Ranked mode (S1b): floors (every heading + each section's first line)
  // are reserved first; the remaining budget is filled most relevant-first,
  // line by line, with an EXACT assembly check per line so the final output
  // never exceeds min(budgetChars, inputChars - 1) — a ranked skeleton must
  // always shrink the text at least as much as verifyReduction demands.
  const cap = Math.min(input.budgetChars, codePointLength(input.text) - 1)
  const rankedFloor = new Array<boolean>(lines.length).fill(false)
  // First lines only: a ranked unselected section falls back to its first
  // sentence, so the mechanical last-line floor must NOT ride along.
  for (const section of sections) {
    for (let index = section.from; index < section.to; index++) {
      if (lines[index]!.content.trim() === '') continue
      rankedFloor[index] = true
      break
    }
  }
  /** Exact packed-output size of a keep-set: header + kept lines + markers. */
  const packedSize = (flags: readonly boolean[]): number => {
    let size = 180 /* header with hint */
    let index = 0
    while (index < lines.length) {
      if (flags[index]) {
        size += codePointLength(lines[index]!.text) + 1
        index += 1
        continue
      }
      const runStart = index
      while (index < lines.length && !flags[index]) index += 1
      size += codePointLength(elidedRangeMarker(lines[runStart]!.originalLine, originalEnd(lines, index - 1))) + 1
    }
    return size
  }
  const fill = new Array<boolean>(lines.length).fill(false)
  for (const section of rankedFirst(sections, sectionRanking)) {
    for (let index = section.from; index < section.to; index++) {
      if (rankedFloor[index] || fill[index] || lines[index]!.content.trim() === '') continue
      fill[index] = true
      if (packedSize(combine(combine(keep, rankedFloor), fill)) > cap) {
        fill[index] = false
        break
      }
    }
  }
  const ranked = assemble(combine(combine(keep, rankedFloor), fill), cap)
  return ranked.text === null
    ? null
    : { text: ranked.text, reducer: 'doc-skeleton', lossy: true, elidedLines: ranked.elidedLines }
}

/**
 * Universal prose fallback (R8b, the main force): keep the head AND the tail
 * of any non-code text and one R9 line-range marker for everything elided in
 * between. Unstructured prose (85%+ of large results) previously landed on
 * head-only truncation; a tail keep preserves conclusions and closing state.
 * Fails open for code-like text and when the budget cannot hold both ends.
 */
function reduceProseKeep(input: PreparedInput): ReducerOutput | null {
  const lines = input.lines
  if (lines.length < 8) return null
  if (looksLikeSourceCode(input.contentText)) return null
  const first = lines[0]!
  const last = lines[lines.length - 1]!
  const tailLine = last.originalLineEnd ?? last.originalLine
  const markerTemplate = elidedRangeMarker(first.originalLine, tailLine)
  const sourceNoteTemplate = `; source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}"})`
  const reserved = codePointLength(markerTemplate) + codePointLength(sourceNoteTemplate) + 2
  const bodyBudget = input.budgetChars - reserved
  if (bodyBudget <= 0) return null
  const headBudget = Math.floor(bodyBudget / 2)
  const tailBudget = bodyBudget - headBudget
  let headCount = 0
  let used = 0
  while (headCount < lines.length) {
    const cost = codePointLength(lines[headCount]!.text) + (headCount === 0 ? 0 : 1)
    if (used + cost > headBudget) break
    used += cost
    headCount += 1
  }
  let tailCount = 0
  used = 0
  while (tailCount < lines.length - headCount) {
    const index = lines.length - 1 - tailCount
    const cost = codePointLength(lines[index]!.text) + (tailCount === 0 ? 0 : 1)
    if (used + cost > tailBudget) break
    used += cost
    tailCount += 1
  }
  if (headCount === 0 || tailCount === 0 || headCount + tailCount >= lines.length) return null
  const elidedStart = lines[headCount]!.originalLine
  const elidedEnd = originalEnd(lines, lines.length - tailCount - 1)
  if (elidedEnd < elidedStart) return null
  const sourceNote = `; source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","start_line":${String(elidedStart)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}})`
  const text = [
    ...lines.slice(0, headCount).map(line => line.text),
    elidedRangeMarker(elidedStart, elidedEnd) + sourceNote,
    ...lines.slice(lines.length - tailCount).map(line => line.text),
  ].join('\n')
  return { text, reducer: 'prose-keep', lossy: true, elidedLines: elidedEnd - elidedStart + 1 }
}

/**
 * Keep a source-file skeleton: imports, decorators, declaration signatures,
 * comments at brace depth zero, and every error-signalling line, eliding the
 * remaining bodies with counted markers. Covers brace languages (TS/JS, Rust,
 * Go, Java, C family) and indent blocks (Python); unknown syntax fails open to
 * the next candidate. Output is compressed evidence, not required to parse.
 * @param input - original result text, recovery source, and output budget.
 * @returns a verified candidate, or `null` when the text is not code-like.
 */
function reduceCodeSkeleton(input: PreparedInput): ReducerOutput | null {
  // The skeleton logic reads the CONTENT view (gutter-stripped) so structure
  // lines survive the host's read gutter; markers still cite originalLine.
  const lines = input.lines.map(line => line.content)
  const kept: string[] = []
  let elided = 0
  let elidedTotal = 0
  let firstElided: { readonly start: number, readonly end: number } | undefined
  const flushElided = (): void => {
    if (elided > 0) {
      const start = input.lines[index - elided]?.originalLine ?? 0
      const end = originalEnd(input.lines, index - 1)
      if (firstElided === undefined) firstElided = { start, end }
      kept.push(elidedRangeMarker(start, end))
      elidedTotal += elided
    }
    elided = 0
  }
  let depth = 0
  let index = 0
  const elideBraceBody = (): void => {
    const startDepth = depth
    index += 1
    while (index < lines.length && depth > startDepth) {
      const body = lines[index]
      if (body === undefined) break
      if (IMPORTANT_PATTERN.test(body)) {
        flushElided()
        kept.push(body)
      } else {
        elided += 1
      }
      depth += braceDelta(body)
      index += 1
    }
    flushElided()
  }
  const keepPythonSignature = (signatureLine: string): void => {
    // The signature line is already kept; every path below must advance the
    // cursor past it so the caller's `continue` cannot revisit the same line.
    index += 1
    if (/:\s*$/.test(signatureLine)) {
      elideIndentedBody(leadingIndent(signatureLine))
      return
    }
    // Multi-line signature: keep continuation lines until the colon, then
    // elide the indented body at the colon line's indent.
    for (let guard = 0; guard < 6 && index < lines.length; guard += 1) {
      const next = lines[index]
      if (next === undefined) break
      if (next.trim() !== '' && leadingIndent(next) <= leadingIndent(signatureLine)) break
      flushElided()
      kept.push(next)
      index += 1
      if (/:\s*$/.test(next)) {
        elideIndentedBody(leadingIndent(next))
        return
      }
      if (next.trim() !== '' && !/[:,(]\s*$/.test(next)) break
    }
  }
  const elideIndentedBody = (indent: number): void => {
    while (index < lines.length) {
      const body = lines[index]
      if (body === undefined) break
      if (body.trim() !== '' && leadingIndent(body) <= indent) break
      if (IMPORTANT_PATTERN.test(body)) {
        flushElided()
        kept.push(body)
        index += 1
        continue
      }
      if (isCodeStructureLine(body) || CODE_DECORATOR_PATTERN.test(body)) {
        flushElided()
        kept.push(body)
        keepPythonSignature(body)
        continue
      }
      elided += 1
      index += 1
    }
    flushElided()
  }
  while (index < lines.length) {
    const line = lines[index]
    if (line === undefined) break
    const delta = braceDelta(line)
    if (IMPORTANT_PATTERN.test(line)) {
      flushElided()
      kept.push(line)
      depth += delta
      index += 1
      continue
    }
    if (isCodeStructureLine(line) || CODE_IMPORT_PATTERN.test(line) || CODE_DECORATOR_PATTERN.test(line)) {
      flushElided()
      kept.push(line)
      depth += delta
      if (delta > 0) {
        elideBraceBody()
        continue
      }
      if (PYTHON_STRUCTURE_PATTERN.test(line)) {
        keepPythonSignature(line)
        continue
      }
      // Brace-language signature continuation: keep following lines until one
      // opens a block, then elide that block.
      let opened = false
      for (let guard = 0; guard < 6 && index + 1 < lines.length; guard += 1) {
        const next = lines[index + 1]
        if (next === undefined) break
        const nextDelta = braceDelta(next)
        if (nextDelta === 0 && next.trim() !== '' && !/[:,(]\s*$/.test(next)) break
        flushElided()
        kept.push(next)
        depth += nextDelta
        index += 1
        if (nextDelta > 0) {
          opened = true
          break
        }
      }
      if (opened) elideBraceBody()
      else index += 1
      continue
    }
    if (depth === 0 && CODE_COMMENT_PATTERN.test(line)) {
      flushElided()
      kept.push(line)
    } else {
      elided += 1
    }
    depth += delta
    index += 1
  }
  flushElided()
  return finishSkeleton(kept, lines, input, firstElided, elidedTotal)
}

function finishSkeleton(
  kept: readonly string[],
  lines: readonly string[],
  input: PreparedInput,
  firstElided: { readonly start: number, readonly end: number } | undefined,
  elidedLines: number,
): ReducerOutput | null {
  const hint = firstElided === undefined
    ? ''
    : `; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","start_line":${String(firstElided.start)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}})`
  const header = `[code output compressed by hypa-code-skeleton; source: ${input.sourceRef}${hint}]`
  const text = fitLines([header, ...kept, ...lines.slice(-4)], input.budgetChars, input.sourceRef)
  return text === null ? null : { text, reducer: 'hypa-code-skeleton', lossy: true, elidedLines }
}

/** Net brace delta of one line, ignoring braces inside string literals. */
function braceDelta(line: string): number {
  let delta = 0
  let quote: string | null = null
  for (let position = 0; position < line.length; position += 1) {
    const char = line[position]
    if (quote !== null) {
      if (char === '\\') position += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') delta += 1
    else if (char === '}') delta -= 1
  }
  return delta
}

function leadingIndent(line: string): number {
  return codePointLength(line) - codePointLength(line.trimStart())
}

function isCodeStructureLine(line: string): boolean {
  return CODE_STRUCTURE_PATTERN.test(line) || PYTHON_STRUCTURE_PATTERN.test(line)
}

/**
 * Require content evidence of source code: enough declaration, import, or
 * decorator lines among a bounded prefix. Failing this keeps prose, logs, and
 * data on their existing reducers.
 * @param text - normalized result text.
 * @returns whether the text qualifies as source code.
 */
function looksLikeSourceCode(text: string): boolean {
  const lines = splitLines(text)
  if (lines.length < 12) return false
  let evidence = 0
  for (const line of lines.slice(0, 400)) {
    if (isCodeStructureLine(line) || CODE_IMPORT_PATTERN.test(line) || CODE_DECORATOR_PATTERN.test(line)) {
      evidence += 1
      if (evidence >= 3) return true
    }
  }
  return false
}

function omissionMarker(input: PreparedInput, reducer: string): string {
  return `[... ${reducer} omitted content; original_chars=${String(codePointLength(input.text))}; source=${input.sourceRef}; retrieve with context_compression_retrieve ...]`
}

/**
 * Continuous-mask marker (R9b): an original-event line range plus a pasteable
 * retrieve hint whose start_line is the first elided line. Line numbers point
 * at the RAW event because retrieve reads raw events (D8).
 */
function rangeOmissionMarker(
  input: PreparedInput,
  reducer: string,
  elidedStart: number,
  elidedEnd: number,
): string {
  return `[... lines ${String(elidedStart)}-${String(elidedEnd)} elided (${String(elidedEnd - elidedStart + 1)} lines); ${reducer}; original_chars=${String(codePointLength(input.text))}; source=${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","start_line":${String(elidedStart)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}}) ...]`
}

/** Scatter-mask note (R9b): totals instead of fragmented per-run ranges. */
function scannedTotals(input: PreparedInput, kept: number): string {
  const last = input.lines[input.lines.length - 1]
  const lastLine = Math.max(last?.originalLineEnd ?? 0, last?.originalLine ?? 0, input.lines.length)
  return `lines 1-${String(lastLine)} scanned, ${String(kept)} kept`
}

function importantAnchor(text: string, maxChars: number): string {
  const lines = splitLines(normalizeTerminalText(text))
  const chosen = lines.find(line => IMPORTANT_PATTERN.test(line)) ?? lines.at(-1) ?? ''
  return Array.from(chosen.trim()).slice(0, maxChars).join('')
}

function fitLines(lines: readonly string[], budgetChars: number, requiredRef: string): string | null {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    if (line === '' || seen.has(line)) continue
    seen.add(line)
    unique.push(line)
  }
  const output: string[] = []
  let used = 0
  for (const line of unique) {
    const cost = codePointLength(line) + (output.length === 0 ? 0 : 1)
    if (used + cost > budgetChars) continue
    output.push(line)
    used += cost
  }
  const text = output.join('\n')
  return text.includes(requiredRef) ? text : null
}

function takeWholeLinesFromHead(text: string, budgetChars: number): string {
  const output: string[] = []
  let used = 0
  for (const line of splitLines(text)) {
    const cost = codePointLength(line) + (output.length === 0 ? 0 : 1)
    if (used + cost > budgetChars) break
    output.push(line)
    used += cost
  }
  if (output.length === 0) return Array.from(text).slice(0, budgetChars).join('')
  return output.join('\n')
}

function takeWholeLinesFromTail(text: string, budgetChars: number): string {
  const lines = splitLines(text)
  const output: string[] = []
  let used = 0
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]
    if (line === undefined) continue
    const cost = codePointLength(line) + (output.length === 0 ? 0 : 1)
    if (used + cost > budgetChars) break
    output.unshift(line)
    used += cost
  }
  if (output.length === 0) return Array.from(text).slice(-budgetChars).join('')
  return output.join('\n')
}

function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  return lines
}

/**
 * Extract the command argument from a tool call's arguments (task_10/AD2):
 * ONLY `command` / `cmd` / `script` are command keys. `input` was removed —
 * any MCP tool with a non-empty `input` string parameter would otherwise be
 * misrouted into the shell reducer, the single largest misroute source.
 * @param argumentsText - raw JSON arguments of the tool call.
 * @returns the command string, or '' when absent.
 */
export function extractCommand(argumentsText: string): string {
  try {
    const parsed = JSON.parse(argumentsText) as unknown
    if (typeof parsed !== 'object' || parsed === null) return ''
    const record = parsed as Record<string, unknown>
    for (const key of ['command', 'cmd', 'script']) {
      const value = record[key]
      if (typeof value === 'string') return value
    }
  } catch {
    return ''
  }
  return ''
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim()
  return (trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))
}

function isGitCommand(name: string, command: string): boolean {
  return name.includes('git') || /(?:^|\s)git\s/.test(command)
}

function isPackageCommand(command: string): boolean {
  return /(?:^|\s)(?:npm|pnpm|yarn|bun|pip|pip3|uv|poetry)\s/.test(command)
}

function isBuildOrTestCommand(command: string): boolean {
  const pattern = new RegExp([
    String.raw`(?:^|\s)(?:tsc|dotnet\s+(?:build|test)|pytest|cargo\s+(?:build|test|check)|go\s+test|mvn\s+test|`,
    String.raw`gradle|npm\s+(?:test|run\s+build)|pnpm\s+(?:test|build|lint)|yarn\s+(?:test|build|lint))\b`,
  ].join(''))
  return pattern.test(command)
}

function packagePattern(): RegExp {
  return new RegExp([
    String.raw`(?:ERR!|WARN|warning|error|failed|conflict|peer dep|added\s+\d+|removed\s+\d+|installed|success|`,
    String.raw`up to date|packages?\s+(?:added|removed|changed)|resolution|No matching distribution|Could not find a version)`,
  ].join(''), 'i')
}

function buildPattern(): RegExp {
  return new RegExp([
    String.raw`(?:error\s+TS\d+|warning\s+TS\d+|FAILED|FAIL\b|AssertionError|expected|actual|`,
    String.raw`tests?\s+(?:run|passed|failed|skipped)|Build\s+(?:succeeded|FAILED)|\d+\s+Error\(s\)|`,
    String.raw`\d+\s+Warning\(s\)|Finished\s+test|compilation failed)`,
  ].join(''), 'i')
}
