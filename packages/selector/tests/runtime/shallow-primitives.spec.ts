/**
 * T4.7/T4.8/T4.11/T4.12 red tests: shallow primitives and tool-side pure cores
 * (plan cci-sedimentation-triage Phase 4.5).
 */
import { describe, expect, it } from 'vitest'
import {
  buildShallowFooter,
  classifyShallowSample,
  evaluateDiscardGuard,
  normalizeToolPath,
  renderCheckpointLine,
} from '../../src/runtime/triage/shallow.ts'
import { buildShallowView, parseReadCoverage } from '../../src/runtime/shallow-tools.ts'
import { skeletonFromRead } from '../../src/runtime/triage/masks.ts'

describe('normalizeToolPath (pairing key, three shapes)', () => {
  it('unifies drive letters, separators, and relative segments', () => {
    expect(normalizeToolPath('E:\\Repo\\A\\b.ts')).toBe('e:/Repo/A/b.ts')
    expect(normalizeToolPath('./src/app.ts')).toBe('src/app.ts')
    expect(normalizeToolPath('src/../src/app.ts')).toBe('src/app.ts')
    expect(normalizeToolPath('E:/Repo//A/./b.ts')).toBe('e:/Repo/A/b.ts')
    // case of the path TAIL is preserved (filesystems may be case-sensitive)
    expect(normalizeToolPath('e:/repo/App.TS')).toBe('e:/repo/App.TS')
  })
})

describe('classifyShallowSample (T4.12 five families)', () => {
  it('routes JSON / TS source / CSV / markdown / unknown-large correctly', () => {
    expect(classifyShallowSample('{"a":1', '.json', 9_000).method).toBe('json-skeleton')
    expect(classifyShallowSample('import x from "y"\n', '.ts', 9_000).method).toBe('code-skeleton')
    expect(classifyShallowSample('name,size\na,1\nb,2\nc,3', '.csv', 9_000).method).toBe('csv-header')
    expect(classifyShallowSample('# Title\nbody', '.md', 9_000).method).toBe('toc-lines')
    expect(classifyShallowSample('random bytes', '.bin', 9_000).method).toBe('toc-lines')
    expect(classifyShallowSample('tiny', '', 30).method).toBe('head-tail')
  })
})

describe('evaluateDiscardGuard (T4.7 asymmetric guard)', () => {
  const mapFull = { seq: 10, path: 'E:\\repo\\big.ts', coverage: { kind: 'full' } as const }

  it('refuses map discard when the covering read is a slice (window-gap and full-map shapes)', () => {
    expect(evaluateDiscardGuard({
      map: mapFull,
      covering: { seq: 20, path: 'e:/repo/big.ts', coverage: { kind: 'slice', from: 100, to: 300 } },
    }).allowed).toBe(false)
  })
  it('allows map discard under a full covering read, path case/shape differing', () => {
    const verdict = evaluateDiscardGuard({
      map: mapFull,
      covering: { seq: 20, path: 'E:/repo/big.ts', coverage: { kind: 'full' } },
    })
    expect(verdict.allowed).toBe(true)
  })
  it('window containment for a map that covers a window', () => {
    const mapWindow = { seq: 10, path: 'a.ts', coverage: { kind: 'slice', from: 50, to: 150 } as const }
    expect(evaluateDiscardGuard({
      map: mapWindow,
      covering: { seq: 20, path: 'a.ts', coverage: { kind: 'slice', from: 40, to: 160 } },
    }).allowed).toBe(true)
    expect(evaluateDiscardGuard({
      map: mapWindow,
      covering: { seq: 20, path: 'a.ts', coverage: { kind: 'slice', from: 60, to: 140 } },
    }).allowed).toBe(false)
  })
  it('path mismatch refuses before any coverage math', () => {
    expect(evaluateDiscardGuard({
      map: mapFull,
      covering: { seq: 20, path: 'e:/repo/other.ts', coverage: { kind: 'full' } },
    }).reason).toContain('path-mismatch')
  })
})

describe('buildShallowView (T4.11 checkpoint layer)', () => {
  const code = `import fs from "node:fs"\n${'  const v = compute()\n'.repeat(200)}export function go() { return 1 }`

  it('code-skeleton view carries the four checkpoint fields', () => {
    const { body, checkpoint } = buildShallowView(code, 'code-skeleton', 'E:\\src\\big.ts', 77)
    expect(body).toContain('import fs')
    expect(body).toContain('elided')
    expect(checkpoint).not.toBeNull()
    expect(checkpoint?.path).toBe('e:/src/big.ts')
    expect(checkpoint?.coverage).toContain('lines')
    expect(checkpoint?.ref).toBe('event/77')
    expect(checkpoint?.fingerprint).toMatch(/^[0-9a-f]+-[0-9a-f]+$/)
  })
  it('json-skeleton lists keys, csv-header keeps rows count, toc-lines keeps headings', () => {
    const json = buildShallowView(JSON.stringify({ a: { b: 1 }, list: [1, 2] }), 'json-skeleton', 'x.json', 1)
    expect(json.body).toContain('a.b')
    expect(json.body).toContain('list[] (2)')
    const csv = buildShallowView('h1,h2\n1,2\n3,4\n5,6', 'csv-header', 'x.csv', 1)
    expect(csv.body).toContain('1 data rows elided')
    const md = buildShallowView('# A\ntext\n## B\nmore', 'toc-lines', 'x.md', 1)
    expect(md.body).toContain('## B')
  })
})

describe('parseReadCoverage (pairing input)', () => {
  it('bare read is full; offset/limit is a window; broken args match nothing', () => {
    expect(parseReadCoverage(JSON.stringify({ file_path: 'a.ts' }))).toEqual({ kind: 'full' })
    expect(parseReadCoverage(JSON.stringify({ file_path: 'a.ts', offset: 100, limit: 50 })))
      .toEqual({ kind: 'slice', from: 101, to: 150 })
    expect(parseReadCoverage('{broken')).toMatchObject({ kind: 'slice', to: 0 })
  })
})

describe('footer and checkpoint rendering (T4.8 data-shaped teaching)', () => {
  const checkpoint = {
    path: 'e:/src/big.ts', coverage: '900 lines', ref: 'session://s1/event/77', fingerprint: '3c-91',
  }
  it('footer names the sibling ref, the saving, and forbids reconstitution', () => {
    const footer = buildShallowFooter(checkpoint, 1_800)
    expect(footer).toContain('session://s1/event/77')
    expect(footer).toContain('1800')
    expect(footer).toContain('不要凭本行推测补写')
  })
  it('checkpoint line keeps all four fields on one line', () => {
    const line = renderCheckpointLine(checkpoint)
    for (const part of ['e:/src/big.ts', '900 lines', 'session://s1/event/77', '3c-91']) {
      expect(line).toContain(part)
    }
    expect(line.split('\n')).toHaveLength(1)
  })
})

describe('skeletonFromRead checkpoint back-compat', () => {
  const padded = `import fs from "node:fs"\n${'  const x = 1\n'.repeat(400)}`
  it('stays checkpoint-free without a path (existing callers unaffected)', () => {
    const verdict = skeletonFromRead(padded, 5)
    expect(verdict?.kind === 'skeleton' && verdict.checkpoint === undefined).toBe(true)
  })
  it('gains the checkpoint with a path', () => {
    const verdict = skeletonFromRead(padded, 5, 'src/a.ts')
    expect(verdict?.kind === 'skeleton' && verdict.checkpoint?.path).toBe('src/a.ts')
  })
})
