/**
 * Tool-source classification (R1/R2), narrowed to FOUR classes (tasks v2 G4):
 * `read` / `shell` / `search` / `path-listing`, everything else `generic`.
 *
 * Form routing beats identity routing — most tools' results land through
 * `read`/`cat` — so this layer exists to keep the OBSERVED misroutes out of
 * the wrong reducers, not to add per-identity behavior:
 * - `web_search` / `memory_search` are not content-search (findings §0)
 * - `glob` is path listing, not search
 * - `execute_sql` is not shell; `research` is not search (substring era bugs)
 * - MCP output has no predictable identity (`mcp` token → generic, C8)
 *
 * Judgment order (C15): name whitelist → command hit → content fallback, and
 * a hit at any earlier stage is never overridden by a later one.
 */

export type ToolClass = 'read' | 'shell' | 'search' | 'path-listing' | 'generic'

/** task_11 (AD3): exact-token matching, no substring hits. */
const TOKEN_SEPARATOR = /[-_/]+/

/** Multi-token names that must match as a whole word, not as a token. */
const READ_NAMES = new Set(['open_file'])
const READ_TOKENS = new Set(['read', 'cat', 'view'])
const SHELL_TOKENS = new Set(['shell', 'bash', 'pwsh', 'powershell', 'terminal', 'exec', 'command'])
const SEARCH_TOKENS = new Set(['grep', 'rg', 'ripgrep'])
const PATH_LISTING_TOKENS = new Set(['glob', 'tree', 'ls', 'fd', 'find'])

const SEARCH_COMMAND_PATTERN = /(?:^|\s)(?:rg|grep|ripgrep)\s/
const PATH_COMMAND_PATTERN = /(?:^|\s)(?:find|fd|ls|tree)\s/

/** grep-style hit line: `path:line[:column][: content]`. */
const PATH_LINE_CONTENT_PATTERN = /^(.*?):(\d+)(?::\d+)?(?::|\s+-\s+)(.*)$/

/**
 * Classify a tool result's source.
 * @param name - raw tool name (case-insensitive).
 * @param command - extracted command argument, '' when absent.
 * @param text - result text; enables the C13/C14 content fallback for names
 *   that no whitelist (and no command hit) claims.
 * @returns the tool source class.
 */
export function classifyToolSource(name: string, command: string, text?: string): ToolClass {
  const lowered = name.toLowerCase()
  const tokens = lowered.split(TOKEN_SEPARATOR).filter(token => token !== '')
  // C8: an `mcp` token means the output identity is arbitrary — generic first,
  // before any content heuristic gets a vote.
  if (tokens.includes('mcp')) return 'generic'
  const byName = classifyByName(lowered, tokens)
  if (byName !== 'generic') return byName
  const byCommand = classifyByCommand(command)
  if (byCommand !== 'generic') return byCommand
  return text === undefined ? 'generic' : classifyByContent(text)
}

function classifyByName(lowered: string, tokens: readonly string[]): ToolClass {
  if (READ_NAMES.has(lowered) || tokens.some(token => READ_TOKENS.has(token))) return 'read'
  if (tokens.some(token => SHELL_TOKENS.has(token))) return 'shell'
  if (tokens.some(token => SEARCH_TOKENS.has(token))) return 'search'
  if (tokens.some(token => PATH_LISTING_TOKENS.has(token))) return 'path-listing'
  return 'generic'
}

function classifyByCommand(command: string): ToolClass {
  if (command === '') return 'generic'
  if (SEARCH_COMMAND_PATTERN.test(command)) return 'search'
  if (PATH_COMMAND_PATTERN.test(command)) return 'path-listing'
  return 'generic'
}

/** A path-shaped hit locator needs a path-looking prefix, not just `:digits`. */
function looksLikeFilePath(prefix: string): boolean {
  if (prefix.includes('://')) return false
  return prefix.includes('/') || prefix.includes('\\') || /\.[A-Za-z0-9]{1,8}$/.test(prefix)
}

/** A bare path: no whitespace, no URL scheme, with a separator or an extension. */
function isPurePathLine(line: string): boolean {
  if (/\s/.test(line) || line.includes('://')) return false
  return line.includes('/') || line.includes('\\') || /\.[A-Za-z0-9]{1,8}$/.test(line)
}

/**
 * Content fallback (C13/C14) for unknown names: one path-plausible
 * `path:line:content` line reads as grep output; a body of ≥80% pure paths
 * reads as a directory listing. Both require file-path evidence so prose
 * (`Note: 2024 - ...`) and URLs (`https://host:8080 - ...`) stay generic.
 */
function classifyByContent(text: string): ToolClass {
  let nonEmpty = 0
  let purePaths = 0
  let pathLineHits = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    nonEmpty += 1
    const match = PATH_LINE_CONTENT_PATTERN.exec(line)
    if (match !== null && looksLikeFilePath(match[1] ?? '')) pathLineHits += 1
    if (isPurePathLine(line)) purePaths += 1
  }
  if (pathLineHits >= 1) return 'search'
  if (nonEmpty >= 4 && purePaths / nonEmpty >= 0.8) return 'path-listing'
  return 'generic'
}
