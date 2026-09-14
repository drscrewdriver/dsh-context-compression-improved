/**
 * TokenPilot-inspired R2/R3: read-state semantics and clustered omission
 * markers.
 *
 * A read result is `superseded` when a later write-style tool call mutated the
 * same file: its full text can no longer match the file the model would read
 * again, so aggressive aging is safe. Superseded reads may compress to a small
 * aggregate placeholder instead of the ordinary historical placeholder.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Write-style tool names whose success supersedes earlier reads. */
const WRITE_TOOLS = /(?:^|[-_])?(?:write|edit|apply_patch|file_write|file_edit|str_replace|replace|multiedit)(?:$|[-_])/i
const PATH_KEYS = ['path', 'file_path'] as const

/** Parse one path out of a tool-call arguments JSON blob. */
export function toolCallPath(argumentsText: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsText)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  for (const key of PATH_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * Decide whether an oversized read result was superseded by a later mutation
 * of the same file. `readPath` is the read call's target path; events after
 * `readSeq` are scanned for a write-style call on it.
 */
export function isSupersededRead(
  events: readonly SessionEvent[],
  readSeq: number,
  readPath: string | undefined,
): boolean {
  if (readPath === undefined) return false
  for (let seq = readSeq + 1; seq < events.length; seq += 1) {
    const event = events[seq]
    if (event?.type !== 'tool/call') continue
    if (!WRITE_TOOLS.test(event.data.name)) continue
    if (toolCallPath(event.data.arguments) === readPath) return true
  }
  return false
}

/** Error/warning/info line classifiers used by the omission summary. */
const ERROR_LINE = /\b(error|failed|failure|fatal|exception|traceback|cannot|unable|denied)\b/i
const WARN_LINE = /\b(warn|warning|deprecated)\b/i

/**
 * Cluster one omitted line-count into an error/warn/info census appended to a
 * placeholder marker, giving the model meta-knowledge about what was dropped.
 */
export function clusterOmittedLines(text: string, omittedLines: number): string | undefined {
  if (omittedLines <= 0) return undefined
  let errors = 0
  let warns = 0
  let infos = 0
  for (const line of text.split('\n')) {
    if (ERROR_LINE.test(line)) errors += 1
    else if (WARN_LINE.test(line)) warns += 1
    else infos += 1
  }
  const parts: string[] = []
  if (errors > 0) parts.push(`${String(errors)} error`)
  if (warns > 0) parts.push(`${String(warns)} warn`)
  if (infos > 0) parts.push(`${String(infos)} info`)
  if (parts.length === 0) return undefined
  return `${String(omittedLines)} lines omitted (${parts.join(', ')})`
}
