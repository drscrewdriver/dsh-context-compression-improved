/**
 * Semantic-role input masking for the intent-summary writer (task_2.2).
 *
 * The intent summary records historical TASK semantics — for read-class tools
 * the semantics are "read X", never the file body, so the body is masked to a
 * one-line record before it can reach the summary prompt. Write-class results
 * (edits) ARE task semantics and keep their skeleton + verbatim error lines.
 *
 * Classification REUSES `classifyToolSource()` (reducers.ts routes on the
 * same classes): hand-rolling a name→role map here would regress its fixed
 * misclassification edges (mcp→generic, web_search/memory_search not being
 * content search, glob being path-listing, execute_sql not being shell).
 * Only the write class is layered on top — `ToolClass` has no write member.
 */
import { classifyToolSource, type ToolClass } from '../toolclass.ts'

export type IntentRole = 'read-mask' | 'write-keep' | 'conservative'

/** Exact-token write layer, same tokenization discipline as toolclass. */
const WRITE_NAMES = new Set(['apply_patch', 'multi_edit', 'create_file', 'write_to_file', 'str_replace_editor'])
const WRITE_TOKENS = new Set(['write', 'edit', 'patch'])

function hasWriteToken(name: string): boolean {
  const lowered = name.toLowerCase()
  if (WRITE_NAMES.has(lowered)) return true
  return lowered.split(/[-_/]+/).some(token => WRITE_TOKENS.has(token))
}

/**
 * Role for one candidate. The write layer is consulted first; everything
 * else defers to the shared classifier. `shell`/`generic` stay conservative
 * (skeleton + error lines, never a blind mask) — a bash result can be a
 * mutation even when its name says nothing.
 */
export function classifyIntentRole(toolName: string, command: string, text?: string): IntentRole {
  if (hasWriteToken(toolName)) return 'write-keep'
  const toolClass: ToolClass = classifyToolSource(toolName, command, text)
  if (toolClass === 'read' || toolClass === 'search' || toolClass === 'path-listing') return 'read-mask'
  return 'conservative'
}

/** One candidate's slimmed face for the summary prompt. */
export interface MaskedCandidate {
  readonly seq: number
  readonly role: IntentRole
  /** Read-mask single line; skeleton/error lines for keep roles. */
  readonly record: string
}

const ERROR_LINE_PATTERN = /\b(error|failed|failure|exception|panic|fatal|traceback|unreachable|denied)\b/i
const KEEP_HEAD_LINES = 40
const KEEP_HEAD_CHARS = 2_000

/** Verbatim error/warn lines kept out of the LLM's hands and into the intent block. */
export function extractErrorLines(text: string): string[] {
  return text.split('\n').filter(line => ERROR_LINE_PATTERN.test(line)).slice(0, 10)
}

/** Count lines and code points for the read-mask record tail. */
function scaleOf(text: string): { lines: number, chars: number } {
  const lines = text.length === 0 ? 0 : text.split('\n').length
  return { lines, chars: text.length }
}

/**
 * Build the prompt face for one candidate. Read-mask output contains NONE of
 * the original body — only the tool name, the call's target argument, and
 * the dropped scale — so a hostile body can never leak into the summary.
 */
export function maskCandidateForSummary(
  seq: number,
  toolName: string,
  argumentsText: string,
  text: string,
): MaskedCandidate {
  const role = classifyIntentRole(toolName, extractCommand(argumentsText), text)
  if (role === 'read-mask') {
    const { lines, chars } = scaleOf(text)
    return {
      seq,
      role,
      record: `${toolName} ${extractTarget(argumentsText)} -> masked (${lines} lines / ${chars} chars)`,
    }
  }
  const head = text.split('\n', KEEP_HEAD_LINES).join('\n').slice(0, KEEP_HEAD_CHARS)
  const errorLines = extractErrorLines(text)
  const errorBlock = errorLines.length > 0 ? `\nerror lines (verbatim):\n${errorLines.join('\n')}` : ''
  return {
    seq,
    role,
    record: `${toolName} (seq ${seq})\n${head}${errorBlock}`,
  }
}

/** Extract a short command head from a tool-call arguments JSON string. */
function extractCommand(argumentsText: string): string {
  try {
    const parsed: unknown = JSON.parse(argumentsText)
    if (parsed !== null && typeof parsed === 'object') {
      const command = (parsed as { command?: unknown }).command
      if (typeof command === 'string') return command.slice(0, 200)
    }
  } catch {
    // arguments are free-form for some tools; classification still works.
  }
  return ''
}

/** Extract the most target-like string argument (path/query/url) for read-mask records. */
export function extractTarget(argumentsText: string): string {
  try {
    const parsed: unknown = JSON.parse(argumentsText)
    if (parsed !== null && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const target = [record.path, record.file_path, record.query, record.url, record.pattern, record.glob]
        .find(candidate => typeof candidate === 'string' && candidate.trim().length > 0)
      if (typeof target === 'string') return target.slice(0, 160)
      const first = Object.values(record).find(value => typeof value === 'string')
      if (typeof first === 'string') return first.slice(0, 160)
    }
  } catch {
    // free-form arguments degrade to an unlabeled mask record
  }
  return '(unparsed target)'
}
