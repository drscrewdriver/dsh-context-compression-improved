import { describe, expect, it } from 'vitest'
import { codePointLength } from '../src/config.ts'
import { reduceFreshToolResult, verifyReduction } from '../src/reducers.ts'

const SOURCE_REF = 'session://s1/event/12'

function readInput(
  text: string,
  budgetChars = 700,
  codeSkeleton?: boolean,
): Parameters<typeof reduceFreshToolResult>[0] {
  return {
    toolName: 'read_file',
    argumentsText: '{"path":"src/example.ts"}',
    text,
    budgetChars,
    sourceRef: SOURCE_REF,
    isError: false,
    ...codeSkeleton === undefined ? {} : { codeSkeleton },
  }
}

const TYPESCRIPT_FILE = [
  '/** Module doc block. */',
  "import { helper } from './helper'",
  'import type { Options } from "./options"',
  '',
  'export interface Options {',
  '  retries: number',
  '  timeout: number',
  '}',
  '',
  'export function runJob(job: string,',
  '  retries: number,',
  '  timeout: number) {',
  '  const started = Date.now()',
  "  throw new Error('fatal: job queue unreachable')",
  '  return started',
  '}',
  '',
  'class Runner {',
  '  private stopped = false',
  '  stop(): void {',
  '    this.stopped = true',
  '  }',
  '}',
  ...Array.from({ length: 40 }, (_, i) => `// filler line ${String(i)} to make the file worth compressing`),
].join('\n')

const PYTHON_FILE = [
  '"""Docstring."""',
  'import os',
  'from pathlib import Path',
  '',
  'class Runner:',
  '    def __init__(self, name,',
  '        retries=3):',
  '        self.name = name',
  '        raise RuntimeError("fatal: bad config")',
  '',
  '    def run(self):',
  '        return os.getcwd()',
  ...Array.from({ length: 40 }, (_, i) => `# filler line ${String(i)} to make the file worth compressing`),
].join('\n')

describe('hypa-code-skeleton reducer', () => {
  it('keeps imports and signatures while eliding brace-language bodies', () => {
    const input = readInput(TYPESCRIPT_FILE, 700, true)
    const output = reduceFreshToolResult(input)
    expect(output).not.toBeNull()
    expect(output?.reducer).toBe('hypa-code-skeleton')
    expect(output?.text).toContain("import { helper } from './helper'")
    expect(output?.text).toContain('export interface Options {')
    expect(output?.text).toContain('export function runJob(job: string,')
    expect(output?.text).toContain('class Runner {')
    expect(output?.text).toContain('lines elided')
    expect(output?.text).not.toContain('const started = Date.now()')
    expect(output?.text).toContain(SOURCE_REF)
    expect(verifyReduction(input, output!)).toBe(true)
  })

  it('preserves error lines from inside elided bodies', () => {
    const input = readInput(TYPESCRIPT_FILE, 700, true)
    const output = reduceFreshToolResult(input)
    expect(output?.text).toContain("throw new Error('fatal: job queue unreachable')")
  })

  it('keeps multi-line signature continuations', () => {
    const input = readInput(TYPESCRIPT_FILE, 700, true)
    const output = reduceFreshToolResult(input)
    expect(output?.text).toContain('  retries: number,')
    expect(output?.text).toContain('  timeout: number) {')
  })

  it('elides indented Python bodies and keeps method signatures', () => {
    const input = readInput(PYTHON_FILE, 700, true)
    const output = reduceFreshToolResult(input)
    expect(output).not.toBeNull()
    expect(output?.reducer).toBe('hypa-code-skeleton')
    expect(output?.text).toContain('class Runner:')
    expect(output?.text).toContain('def __init__(self, name,')
    expect(output?.text).toContain('def run(self):')
    expect(output?.text).not.toContain('return os.getcwd()')
    expect(output?.text).toContain('raise RuntimeError("fatal: bad config")')
    expect(verifyReduction(input, output!)).toBe(true)
  })

  it('stays within the char budget', () => {
    const input = readInput(TYPESCRIPT_FILE, 1_200, true)
    const output = reduceFreshToolResult(input)
    expect(output?.reducer).toBe('hypa-code-skeleton')
    expect(codePointLength(output!.text)).toBeLessThanOrEqual(1_200)
  })

  it('leaves prose on the existing head reducer', () => {
    const prose = Array.from({ length: 200 }, (_, i) =>
      `Paragraph ${String(i)} explains a concept in plain sentences with no code structure at all.`).join('\n')
    const input = readInput(prose)
    const output = reduceFreshToolResult(input)
    expect(output?.reducer).toBe('pi-head')
  })

  it('does not fire on small or sparse content', () => {
    const sparse = ['function a() {}', 'function b() {}', 'plain text line'].join('\n')
    expect(reduceFreshToolResult(readInput(sparse))?.reducer).not.toBe('hypa-code-skeleton')
  })

  it('stays off for code content when the orthogonal gate is unset or false', () => {
    for (const codeSkeleton of [undefined, false]) {
      const input = readInput(TYPESCRIPT_FILE, 700, codeSkeleton)
      const output = reduceFreshToolResult(input)
      expect(output?.reducer).not.toBe('hypa-code-skeleton')
      expect(output?.reducer).toBe('pi-head')
    }
  })

  it('fires for code content only when the orthogonal gate is enabled', () => {
    const enabled = reduceFreshToolResult(readInput(TYPESCRIPT_FILE, 700, true))
    expect(enabled?.reducer).toBe('hypa-code-skeleton')
  })
})
