/**
 * T2.1/T2.3 red tests: line-C deterministic masks (plan cci-sedimentation-triage).
 * Manifest paths come from call args FIRST (result text often says "written"
 * without full paths — the round-1 failure), and the read skeleton must work
 * over gutter-stripped content (the CCI JSON-skeleton trap regression).
 */
import { describe, expect, it } from 'vitest'
import { manifestFromCall, skeletonFromRead } from '../../src/runtime/triage/masks.ts'

describe('manifestFromCall (T2.1)', () => {
  it('takes the path from call args file_path', () => {
    const verdict = manifestFromCall(
      'write',
      JSON.stringify({ file_path: 'src/app.ts', content: 'x'.repeat(500) }),
      'File written successfully.',
    )
    expect(verdict).not.toBeNull()
    if (verdict === null || verdict.kind !== 'manifest') throw new Error('expected manifest verdict')
    expect(verdict.paths).toEqual(['src/app.ts'])
    expect(verdict.seq).toEqual(expect.any(Number))
  })

  it('collects paths[] and edits[].path forms', () => {
    const fromList = manifestFromCall('multi_edit', JSON.stringify({ paths: ['a.ts', 'b.ts'] }), '')
    if (fromList === null || fromList.kind !== 'manifest') throw new Error('expected manifest')
    expect(fromList.paths).toEqual(['a.ts', 'b.ts'])
    const fromEdits = manifestFromCall('apply_patch', JSON.stringify({ edits: [{ path: 'c.ts' }, { path: 'd.ts' }] }), '')
    if (fromEdits === null || fromEdits.kind !== 'manifest') throw new Error('expected manifest')
    expect(fromEdits.paths).toEqual(['c.ts', 'd.ts'])
  })

  it('falls back to result text only when args carry no paths', () => {
    const verdict = manifestFromCall('edit', '{}', 'updated E:\\repo\\fix.ps1 and notes.md')
    if (verdict === null || verdict.kind !== 'manifest') throw new Error('expected manifest')
    expect(verdict.paths.some(p => p.includes('fix.ps1'))).toBe(true)
  })

  it('caps at 12 unique paths', () => {
    const many = Array.from({ length: 30 }, (_, i) => `f${i}.ts`)
    const verdict = manifestFromCall('write', JSON.stringify({ paths: many }), '')
    if (verdict === null || verdict.kind !== 'manifest') throw new Error('expected manifest')
    expect(verdict.paths).toHaveLength(12)
  })

  it('non-write tools return null', () => {
    expect(manifestFromCall('read', JSON.stringify({ file_path: 'a.ts' }), 'body')).toBeNull()
    expect(manifestFromCall('pwsh', JSON.stringify({ command: 'ls' }), 'out')).toBeNull()
  })

  it('unparseable args degrade to text fallback, never throw', () => {
    expect(manifestFromCall('write', '{broken', 'wrote src/x.ts')).not.toBeNull()
  })
})

describe('skeletonFromRead (T2.3)', () => {
  const code = [
    'import fs from "node:fs"',
    'const LIMIT = 10',
    'export function big(a: number): number {',
    ...Array.from({ length: 200 }, (_, i) => `  const v${i} = a * ${i}; total += v${i}`),
    '}',
    'class Holder {',
    '  private items: string[] = []',
    '}',
  ].join('\n')
  const padded = `${code}\n${'  // filler body line for size\n'.repeat(80)}`

  it('returns null for small reads', () => {
    expect(skeletonFromRead('short file\nimport x\n')).toBeNull()
  })

  it('captures declaration lines over 40-line cap and reports elision', () => {
    const verdict = skeletonFromRead(padded, 77)
    expect(verdict).not.toBeNull()
    if (verdict === null || verdict.kind !== 'skeleton') throw new Error('expected skeleton')
    expect(verdict.lines.length).toBeLessThanOrEqual(40)
    expect(verdict.lines.some(l => l.includes('import fs'))).toBe(true)
    expect(verdict.elidedChars).toBeGreaterThan(0)
    expect(verdict.seq).toBe(77)
  })

  it('works on guttered read output (N: prefix trap regression)', () => {
    const guttered = padded.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n')
    const verdict = skeletonFromRead(guttered, 78)
    if (verdict === null || verdict.kind !== 'skeleton') throw new Error('guttered read must skeletonize')
    expect(verdict.lines.some(l => l.includes('import fs'))).toBe(true)
    // Captured lines stay guttered (the model's inline locator), never re-stripped.
    expect(verdict.lines.some(l => /^\d+: /.test(l))).toBe(true)
  })

  it('zero-hit content (prose dump) returns null — fail-open to the normal path', () => {
    const prose = 'chapter one\n'.concat('the quick brown fox jumps over the lazy dog\n'.repeat(120))
    expect(skeletonFromRead(prose, 79)).toBeNull()
  })
})
