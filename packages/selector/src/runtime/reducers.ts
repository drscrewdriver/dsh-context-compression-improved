/** Deterministic, evidence-backed reducers for fresh tool results. */

import { codePointLength } from './config.ts'

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
}

/** Internal face every reducer sees: the normalized text plus its line mapping. */
type PreparedInput = ReducerInput & { readonly lines: readonly NormalizedLine[] }

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
const ADJACENT_REPEAT_MARKER = '[previous line repeated'
/** Non-adjacent folding only pays off once a line recurs enough to beat the marker cost. */
const NON_ADJACENT_FOLD_THRESHOLD = 3

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
export function reduceFreshToolResult(input: ReducerInput): ReducerOutput | null {
  const normalized = normalizeTerminalLines(input.text)
  const prepared: PreparedInput = { ...input, text: normalized.text, lines: normalized.folded }
  const command = extractCommand(input.argumentsText)
  const name = input.toolName.toLowerCase()
  const candidates: Array<() => ReducerOutput | null> = []

  if (looksLikeJson(normalized.text)) candidates.push(() => reduceJson(prepared))
  if (isSearchTool(name, command)) candidates.push(() => reduceSearch(prepared))
  if (isGitCommand(name, command)) candidates.push(() => reduceGit(prepared, command))
  if (isPackageCommand(command)) candidates.push(() => reducePatternLog(prepared, 'hypa-package', packagePattern()))
  if (isBuildOrTestCommand(command)) candidates.push(() => reducePatternLog(prepared, 'hypa-build-test', buildPattern()))
  if (input.codeSkeleton === true && looksLikeSourceCode(normalized.text)) candidates.push(() => reduceCodeSkeleton(prepared))
  // Form-dispatched prose candidates (R8/R8b): classification reads content
  // shape only — never the tool name, the path extension, or the command.
  if (looksLikeDocument(normalized.text)) candidates.push(() => reduceDocSkeleton(prepared))
  if (isShellTool(name) || command !== '') candidates.push(() => reduceShell(prepared))
  candidates.push(() => reduceProseKeep(prepared))
  if (isReadTool(name)) candidates.push(() => reduceHead(prepared, 'pi-head'))
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
  readonly text: string
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
  const folded: NormalizedLine[] = []
  let previous: string | undefined
  let count = 0
  let firstOriginal = 0
  const flush = (nextOriginal: number): void => {
    if (previous === undefined) return
    folded.push({ text: previous, originalLine: firstOriginal })
    if (count > 1) {
      folded.push({
        text: `[previous line repeated ${String(count - 1)} more times]`,
        originalLine: firstOriginal + 1,
        originalLineEnd: nextOriginal - 1,
      })
    }
  }
  logical.forEach((line, index) => {
    const originalLine = index + 1
    if (line === previous) {
      count++
      return
    }
    flush(originalLine)
    previous = line
    count = 1
    firstOriginal = originalLine
  })
  flush(logical.length + 1)
  const result = foldNonAdjacentRepeats(folded)
  return { folded: result, text: result.map(line => line.text).join('\n') }
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
  for (const unit of units) totals.set(unit.lead.text, (totals.get(unit.lead.text) ?? 0) + 1)
  if (totals.size === units.length) return [...folded]
  // Precompute, per repeated text, where the first kept occurrence and the
  // last folded occurrence sit in the ORIGINAL event.
  const firstOriginal = new Map<string, number>()
  const lastOriginalEnd = new Map<string, number>()
  for (const unit of units) {
    const text = unit.lead.text
    if (totals.get(text)! < NON_ADJACENT_FOLD_THRESHOLD) continue
    if (!firstOriginal.has(text)) firstOriginal.set(text, unit.lead.originalLine)
    const end = unit.repeat?.originalLineEnd ?? unit.lead.originalLineEnd ?? unit.lead.originalLine
    lastOriginalEnd.set(text, end)
  }
  const seen = new Map<string, number>()
  const result: NormalizedLine[] = []
  for (const unit of units) {
    const text = unit.lead.text
    const total = totals.get(text)!
    if (total < NON_ADJACENT_FOLD_THRESHOLD) {
      result.push(unit.lead)
      if (unit.repeat !== undefined) result.push(unit.repeat)
      continue
    }
    if (!seen.has(text)) {
      seen.set(text, 1)
      result.push(unit.lead)
      if (unit.repeat !== undefined) result.push(unit.repeat)
      continue
    }
    const ordinal = (seen.get(text) ?? 1) + 1
    seen.set(text, ordinal)
    if (ordinal > 2) continue
    const end = lastOriginalEnd.get(text)!
    result.push({
      text: `[× ${String(total)} total: same as line ${String(firstOriginal.get(text)!)}; original lines ${String(unit.lead.originalLine)}-${String(end)}]`,
      originalLine: unit.lead.originalLine,
      originalLineEnd: end,
    })
  }
  return result
}

/** Default line window a retrieve hint suggests the model paste. */
const RETRIEVE_HINT_MAX_LINES = 80

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
function reduceSearch(input: PreparedInput): ReducerOutput | null {
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
  const allLocators = [...groups].map(([path, rows]) => locatorFor(path, rows))
  // Rows within a file are offered to the quota important-first, then by line.
  const perFile = new Map<string, Row[]>()
  for (const [path, rows] of groups) {
    perFile.set(path, [...rows].sort((a, b) => a.important === b.important
      ? a.fileLine - b.fileLine
      : a.important ? -1 : 1))
  }

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
  for (const line of lines.slice(0, 400)) {
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
function reduceDocSkeleton(input: PreparedInput): ReducerOutput | null {
  const lines = input.lines
  const keep = new Array<boolean>(lines.length).fill(false)
  const headingIndex: number[] = []
  let inFence = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.text
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
  // Section boundaries: each section keeps its first and last content line.
  const sectionStarts = [-1, ...headingIndex]
  const sectionEnds = [...headingIndex, lines.length]
  for (let section = 0; section < sectionStarts.length; section++) {
    const from = sectionStarts[section]! + 1
    const to = sectionEnds[section]!
    let first = -1
    let last = -1
    for (let index = from; index < to; index++) {
      if (lines[index]!.text.trim() === '') continue
      if (first === -1) first = index
      last = index
    }
    if (first !== -1) keep[first] = true
    if (last !== -1) keep[last] = true
  }
  // Table blocks keep their first two rows (header + separator).
  let tableRows = 0
  let fenceOpen = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.text
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
  const kept: string[] = []
  let index = 0
  let firstElided: { readonly start: number, readonly end: number } | undefined
  while (index < lines.length) {
    if (keep[index]) {
      kept.push(lines[index]!.text)
      index += 1
      continue
    }
    const runStart = index
    while (index < lines.length && !keep[index]) index += 1
    const start = lines[runStart]!.originalLine
    const end = originalEnd(lines, index - 1)
    if (end >= start) {
      if (firstElided === undefined) firstElided = { start, end }
      kept.push(elidedRangeMarker(start, end))
    }
  }
  const hint = firstElided === undefined
    ? ''
    : `,"start_line":${String(firstElided.start)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}`
  kept.unshift(`[document compressed by doc-skeleton; source: ${input.sourceRef}; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}"${hint}})]`)
  const text = fitLines(kept, input.budgetChars, input.sourceRef)
  return text === null ? null : { text, reducer: 'doc-skeleton', lossy: true }
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
  if (looksLikeSourceCode(input.text)) return null
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
  return { text, reducer: 'prose-keep', lossy: true }
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
  const lines = input.lines.map(line => line.text)
  const kept: string[] = []
  let elided = 0
  let firstElided: { readonly start: number, readonly end: number } | undefined
  const flushElided = (): void => {
    if (elided > 0) {
      const start = input.lines[index - elided]?.originalLine ?? 0
      const end = originalEnd(input.lines, index - 1)
      if (firstElided === undefined) firstElided = { start, end }
      kept.push(elidedRangeMarker(start, end))
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
  return finishSkeleton(kept, lines, input, firstElided)
}

function finishSkeleton(
  kept: readonly string[],
  lines: readonly string[],
  input: PreparedInput,
  firstElided: { readonly start: number, readonly end: number } | undefined,
): ReducerOutput | null {
  const hint = firstElided === undefined
    ? ''
    : `; retrieve with context_compression_retrieve({"ref":"${input.sourceRef}","start_line":${String(firstElided.start)},"max_lines":${String(RETRIEVE_HINT_MAX_LINES)}})`
  const header = `[code output compressed by hypa-code-skeleton; source: ${input.sourceRef}${hint}]`
  const text = fitLines([header, ...kept, ...lines.slice(-4)], input.budgetChars, input.sourceRef)
  return text === null ? null : { text, reducer: 'hypa-code-skeleton', lossy: true }
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

function extractCommand(argumentsText: string): string {
  try {
    const parsed = JSON.parse(argumentsText) as unknown
    if (typeof parsed !== 'object' || parsed === null) return ''
    const record = parsed as Record<string, unknown>
    for (const key of ['command', 'cmd', 'script', 'input']) {
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

function isReadTool(name: string): boolean {
  return /(?:^|[-_/])(?:read|cat|view|open_file)(?:$|[-_/])/.test(name)
}

function isSearchTool(name: string, command: string): boolean {
  return /(?:grep|search|glob|find|ripgrep|rg)/.test(name)
    || /(?:^|\s)(?:rg|grep|find|fd)\s/.test(command)
}

function isShellTool(name: string): boolean {
  return /(?:bash|shell|terminal|powershell|pwsh|exec|command)/.test(name)
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
