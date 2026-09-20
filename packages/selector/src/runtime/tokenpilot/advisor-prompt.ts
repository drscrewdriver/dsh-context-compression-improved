/**
 * Prompt construction and answer parsing for the advisory relevance advisor.
 *
 * Same conventions as the estimator prompts: temperature-0 small-model calls,
 * JSON-only output instructions, and fail-open parsers that return
 * `undefined` (never throw) on any malformed answer so the advisor stays
 * observational even against a hostile or broken channel.
 */

/** One summary answer: overall task, active subtasks, prescreen keywords. */
export interface AdvisorSummaryAnswer {
  readonly overallTask: string
  readonly activeSubtasks: readonly string[]
  readonly keywords: readonly string[]
}

/** One scoring answer row. */
export interface AdvisorScoreAnswer {
  readonly seq: number
  /** Relevance in [0, 1]; out-of-range rows are dropped. */
  readonly score: number
  /** Short reason; kept out of audits, used only for diagnosis in tests. */
  readonly reason?: string
}

export function buildAdvisorSummarySystemPrompt(): string {
  return [
    'You summarize what an agent session is working on, for relevance statistics only.',
    'Input: the session todolist snapshot and a recent tail of assistant narration.',
    'Answer with ONLY one JSON object:',
    '{"overallTask":"<one sentence>","activeSubtasks":["<subtask>"],"keywords":["<task keyword>"]}.',
    'keywords must be 3-10 short distinctive words describing the CURRENT task.',
    'Never add commentary; never invent tasks that the input does not support.',
  ].join(' ')
}

export function buildAdvisorSummaryUserPrompt(taskText: string, tailText: string): string {
  const lines = [
    `todolist:\n${taskText}`,
    tailText.trim().length > 0 ? `recent tail:\n${tailText.trim()}` : 'recent tail: (none)',
  ]
  return lines.join('\n\n')
}

export function buildAdvisorScoringSystemPrompt(): string {
  return [
    'You score how relevant each historical session artifact is to the current task,',
    'for statistics only. Relevance covers both the artifact content and its comments',
    '(comment semantics count too). 0 means unrelated, 1 means the live agent will',
    'very likely need this exact content again.',
    'Answer with ONLY one JSON object per input line:',
    '{"seq":<number>,"score":<number between 0 and 1>,"reason":"<short>"}',
    'one per line, same order as the input. Never invent seq values; never add commentary.',
  ].join(' ')
}

export function buildAdvisorScoringUserPrompt(
  taskText: string,
  activeSubtasks: readonly string[],
  candidates: readonly { readonly seq: number, readonly preview: string }[],
): string {
  const lines = [
    `task: ${taskText.replace(/\s+/gu, ' ').slice(0, 600)}`,
    activeSubtasks.length > 0 ? `active subtasks: ${activeSubtasks.join('; ').slice(0, 300)}` : 'active subtasks: (none)',
    '',
    ...candidates.map(candidate => `seq=${String(candidate.seq)} | ${candidate.preview.replace(/\s+/gu, ' ')}`),
  ]
  return lines.join('\n')
}

/** Pull the first balanced JSON object out of a possibly chatty answer. */
function firstJsonObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, index + 1))
          return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : undefined
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, limit)
    .map(entry => entry.trim())
}

/**
 * Parse one summary answer. Fail-open: `undefined` on any malformed or
 * missing field, so a broken channel can never poison the cached summary.
 */
export function parseAdvisorSummary(text: string | undefined): AdvisorSummaryAnswer | undefined {
  if (text === undefined || text.trim().length === 0) return undefined
  const object = firstJsonObject(text)
  if (object === undefined) return undefined
  const overallTask = object.overallTask
  if (typeof overallTask !== 'string' || overallTask.trim().length === 0) return undefined
  const activeSubtasks = stringList(object.activeSubtasks, 12)
  const keywords = stringList(object.keywords, 12)
  if (keywords.length === 0 && activeSubtasks.length === 0) return undefined
  return { overallTask: overallTask.trim(), activeSubtasks, keywords }
}

/** Extract every balanced JSON object from a JSON-lines or chatty answer. */
function jsonObjects(text: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, index + 1))
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            objects.push(parsed as Record<string, unknown>)
          }
        } catch {
          // Skip one malformed object; the rest of the answer can still parse.
        }
        start = -1
      }
    }
  }
  return objects
}

/**
 * Parse one scoring answer. Fail-open: returns the valid rows it could read
 * (`undefined` when nothing valid remains) — a partially garbage answer still
 * contributes its good rows, mirroring the estimator's per-item tolerance.
 */
export function parseAdvisorScores(
  text: string | undefined,
  validSeqs: ReadonlySet<number>,
): Map<number, AdvisorScoreAnswer> | undefined {
  if (text === undefined || text.trim().length === 0) return undefined
  const scores = new Map<number, AdvisorScoreAnswer>()
  for (const object of jsonObjects(text)) {
    const seq = object.seq
    const score = object.score
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || !validSeqs.has(seq)) continue
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) continue
    const reason = typeof object.reason === 'string' && object.reason.trim().length > 0
      ? object.reason.trim()
      : undefined
    scores.set(seq, { seq, score, ...(reason !== undefined ? { reason } : {}) })
  }
  return scores.size > 0 ? scores : undefined
}
