import { describe, expect, it } from 'vitest'
import { classifyToolSource } from '../../src/runtime/toolclass.ts'
import { extractCommand, reduceFreshToolResult } from '../../src/runtime/reducers.ts'

/** Checklist C1–C15 against the FOUR-class narrowing (tasks v2 G4): web/memory
 *  search and research/sql names fall to generic, glob is path-listing, only
 *  grep/rg/ripgrep are search, and the content fallback never overrides a
 *  whitelist hit. */
describe('classifyToolSource — name whitelist', () => {
  it('keeps web_search out of search (C1)', () => {
    expect(classifyToolSource('web_search', '')).toBe('generic')
  })

  it('routes glob to path-listing (C2)', () => {
    expect(classifyToolSource('glob', '')).toBe('path-listing')
  })

  it('keeps memory/conversation search generic — four classes only (C3, v2)', () => {
    expect(classifyToolSource('memory_search', '')).toBe('generic')
    expect(classifyToolSource('conversation_search', '')).toBe('generic')
  })

  it('routes grep/rg/ripgrep to search (C4)', () => {
    expect(classifyToolSource('grep', '')).toBe('search')
    expect(classifyToolSource('rg', '')).toBe('search')
    expect(classifyToolSource('ripgrep', '')).toBe('search')
    expect(classifyToolSource('grep_search', '')).toBe('search')
  })

  it('routes shell/bash/pwsh/terminal to shell-exec (C5)', () => {
    expect(classifyToolSource('shell', '')).toBe('shell')
    expect(classifyToolSource('bash', '')).toBe('shell')
    expect(classifyToolSource('pwsh', '')).toBe('shell')
    expect(classifyToolSource('powershell', '')).toBe('shell')
    expect(classifyToolSource('terminal', '')).toBe('shell')
  })

  it('routes read/read_file/cat/view/open_file to file-read (C6)', () => {
    expect(classifyToolSource('read', '')).toBe('read')
    expect(classifyToolSource('read_file', '')).toBe('read')
    expect(classifyToolSource('cat', '')).toBe('read')
    expect(classifyToolSource('view', '')).toBe('read')
    expect(classifyToolSource('view_file', '')).toBe('read')
    expect(classifyToolSource('open_file', '')).toBe('read')
  })

  it('is generic for mutation tools — no file-mutate class in the four-class set (C7, v2)', () => {
    expect(classifyToolSource('write', '')).toBe('generic')
    expect(classifyToolSource('edit', '')).toBe('generic')
    expect(classifyToolSource('apply_patch', '')).toBe('generic')
  })

  it('returns generic for any name with an mcp token, before content evidence (C8)', () => {
    expect(classifyToolSource('mcp__server__grep', '', 'src/a.ts:1: x')).toBe('generic')
    expect(classifyToolSource('mcp-grep', '', 'src/a.ts:1: x')).toBe('generic')
  })

  it('never misroutes `research` into a search class (C9)', () => {
    expect(classifyToolSource('research', '')).toBe('generic')
    expect(classifyToolSource('deep_research', '')).toBe('generic')
  })

  it('never misroutes `execute_sql` into shell-exec (C10)', () => {
    expect(classifyToolSource('execute_sql', '')).toBe('generic')
  })

  it('matches tokens exactly — no substring bleed (task_11)', () => {
    expect(classifyToolSource('advanced_search', '')).toBe('generic')
    expect(classifyToolSource('free_search_test', '')).toBe('generic')
    expect(classifyToolSource('theme_global', '')).toBe('generic')
  })
})

describe('classifyToolSource — command and content fallback', () => {
  it('routes rg/grep commands to search even from an unknown tool name', () => {
    expect(classifyToolSource('run_tool', 'rg pattern src/')).toBe('search')
    expect(classifyToolSource('run_tool', 'grep -n TODO .')).toBe('search')
  })

  it('routes find/fd/ls/tree commands to path-listing, not search', () => {
    expect(classifyToolSource('run_tool', 'find . -name "*.ts"')).toBe('path-listing')
    expect(classifyToolSource('run_tool', 'fd config')).toBe('path-listing')
  })

  it('falls back to search on a path:line:content line (C13)', () => {
    expect(classifyToolSource('unknown_tool', '', 'src/index.ts:12: export const x')).toBe('search')
  })

  it('does not let prose colons or URLs masquerade as grep output (C13 guard)', () => {
    expect(classifyToolSource('unknown_tool', '', 'Note: 2024 - something happened')).toBe('generic')
    expect(classifyToolSource('unknown_tool', '', 'see https://host.example:8080 - login')).toBe('generic')
  })

  it('falls back to path-listing when ≥80% of lines are pure paths (C14)', () => {
    const listing = ['src/index.ts', 'src/main.ts', 'src/util.ts', 'README.md'].join('\n')
    expect(classifyToolSource('unknown_tool', '', listing)).toBe('path-listing')
  })

  it('never overrides a whitelist hit with content evidence (C15)', () => {
    expect(classifyToolSource('bash', '', 'src/index.ts:12: export const x')).toBe('shell')
    expect(classifyToolSource('glob', '', 'src/index.ts:12: export const x')).toBe('path-listing')
    expect(classifyToolSource('read', '', 'src/index.ts')).toBe('read')
  })
})

describe('extractCommand — input key removed (C11/C12)', () => {
  it('returns empty for an input-only payload (C11)', () => {
    expect(extractCommand('{"input":"arbitrary model text"}')).toBe('')
  })

  it('still reads the command key (C12)', () => {
    expect(extractCommand('{"command":"npm test"}')).toBe('npm test')
  })

  it('still reads cmd/script fallbacks', () => {
    expect(extractCommand('{"cmd":"pnpm build"}')).toBe('pnpm build')
    expect(extractCommand('{"script":"ls"}')).toBe('ls')
  })
})

/** End-to-end dispatch guard for the misroute fixes: a `glob` result and an
 *  `execute_sql` result must not land on the search reducer even when they
 *  exceed every form gate. */
describe('toolclass dispatch integration', () => {
  const paths = Array.from({ length: 200 }, (_, index) => `pkg/dir${String(index)}/file${String(index)}.ts`)
  const globText = paths.join('\n')

  it('routes a large glob result away from search-salience (task_11)', () => {
    const output = reduceFreshToolResult({
      toolName: 'glob',
      argumentsText: '{}',
      text: globText,
      budgetChars: 4_000,
      sourceRef: 'session://probe/glob',
      isError: false,
    })
    expect(output).not.toBeNull()
    expect(output!.reducer).not.toBe('search-by-file')
    expect(output!.reducer).not.toBe('search-salience')
  })

  it('routes a large mcp web_search result away from the search reducer (C1/AD1)', () => {
    const web = Array.from({ length: 60 }, (_, index) =>
      `- [Result ${String(index)}](https://example.com/${String(index)}) — a summary paragraph of the ${String(index)}th hit.`).join('\n')
    const output = reduceFreshToolResult({
      toolName: 'mcp__web__web_search',
      argumentsText: '{}',
      text: web,
      budgetChars: 2_000,
      sourceRef: 'session://probe/web',
      isError: false,
    })
    expect(output).not.toBeNull()
    expect(output!.reducer).not.toBe('search-by-file')
  })
})
