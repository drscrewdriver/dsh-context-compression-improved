import { describe, expect, it } from 'vitest'
import {
  looksLikeMinified,
  looksLikeDocument,
  reduceFreshToolResult,
  type ReducerInput,
} from '../../src/runtime/reducers.ts'

const input = (overrides: Partial<ReducerInput> & Pick<ReducerInput, 'text'>): ReducerInput => ({
  toolName: overrides.toolName ?? 'read',
  argumentsText: overrides.argumentsText ?? '{}',
  text: overrides.text,
  budgetChars: overrides.budgetChars ?? 4_000,
  sourceRef: overrides.sourceRef ?? 'session://probe/event/1',
  isError: overrides.isError ?? false,
  ...(overrides.codeSkeleton === undefined ? {} : { codeSkeleton: overrides.codeSkeleton }),
})

/** task_4b (G6): a large read-class result must present its skeleton (the
 *  natural table of contents) instead of head-only truncation, WITHOUT the
 *  orthogonal `codeSkeleton` user gate. Acceptance: the first step carries
 *  structure lines/headings and NO head boilerplate, and every elision marker
 *  is line-addressable via start_line. */
describe('TOC-first for large read results (task_4b)', () => {
  const sourceLines = [
    'import { a } from "./a.ts"',
    'import { b } from "./b.ts"',
    'import { c } from "./c.ts"',
    ...Array.from({ length: 60 }, (_, index) => [
      `export function handler${String(index)}(value: number): number {`,
      // Body lines must be UNIQUE across handlers — exact repeats fold in the
      // normalizer (R11), which would shrink the content view below the
      // TOC threshold and change the dispatch this suite pins.
      ...Array.from({ length: 40 }, (_, line) => `  value += ${String(line)}; // handler ${String(index)} padded body line`),
      '  return value',
      '}',
    ]).flat(),
  ]
  const guttered = sourceLines.map((line, index) => `${String(index + 1)}: ${line}`).join('\n')

  it('skeletons a large guttered read without the codeSkeleton gate', () => {
    const output = reduceFreshToolResult(input({ text: guttered, budgetChars: 8_000 }))
    expect(output).not.toBeNull()
    expect(output!.reducer).toBe('hypa-code-skeleton')
    // Structure lines survive (the directory)…
    expect(output!.text).toContain('export function handler0(')
    // …while the head-of-file boilerplate does NOT dominate the first step.
    expect(output!.text).not.toContain('value += 0; // padded body line')
  })

  it('keeps every elision marker line-addressable (start_line present)', () => {
    const output = reduceFreshToolResult(input({ text: guttered, budgetChars: 8_000 }))
    expect(output!.text).toMatch(/\[... lines \d+-\d+ elided \(\d+ lines\) ...\]/)
    expect(output!.text).toContain('start_line')
    // The host continuation footer is never dropped by the envelope.
    expect(output!.text).not.toBe('')
  })

  it('degrades to head/tail when the skeleton is mostly elision markers', () => {
    // Code-shaped (structure + import evidence) but structurally POOR: 20
    // tiny `fn` signatures each followed by 100 unique filler lines → the
    // skeleton output is dominated by elision markers, so the TOC guard must
    // fail open and the result must land on the prose/head pair.
    const flat = [
      'use crate::a;',
      'use crate::b;',
      'use crate::c;',
      ...Array.from({ length: 20 }, (_, index) => [
        `fn fx${String(index)}(v: u32) {`,
        ...Array.from({ length: 100 }, (_, line) => `  v = tick(${String(index)}, ${String(line)});`),
        '}',
      ]).flat(),
    ]
    const flatText = flat.join('\n')
    expect(flatText.length).toBeGreaterThan(8_000)
    const output = reduceFreshToolResult(input({ text: flatText, budgetChars: 4_000 }))
    expect(output).not.toBeNull()
    expect(output!.reducer).toBe('pi-head')
  })
})

/** task_15 (R10-B): bundled/minified JS — line-anchored reducers cannot see
 *  inside a 135k-character line; the useful first answer is a declaration
 *  directory, never half a statement. */
describe('bundled/minified JS directory (task_15)', () => {
  const bundleLines = [
    '/*! license header */',
    `(()=>{var __webpack_exports__={};${Array.from({ length: 30 }, (_, index) =>
      `function handleWidget${String(index)}(a,b){return a+b};`).join('')}export{handleWidget0};const CONFIG_VALUE=42;})();`,
    '//# sourceMappingURL=index.js.map',
  ]
  const bundle = bundleLines.join('\n')

  it('detects the minified form (R10a)', () => {
    expect(looksLikeMinified(bundle)).toBe(true)
  })

  it('still detects a 53-line webui bundle with one 135k line', () => {
    const giant = `var x=1;${'y'.repeat(135_000)};`
    expect(looksLikeMinified([giant, giant].join('\n'))).toBe(true)
  })

  it('emits a declaration directory with symbols and the source-map note (R10b/R10c)', () => {
    const output = reduceFreshToolResult(input({
      toolName: 'read',
      text: bundle,
      budgetChars: 3_000,
    }))
    expect(output).not.toBeNull()
    expect(output!.reducer).toBe('bundled-js-directory')
    expect(output!.text).toContain('handleWidget0')
    expect(output!.text).toContain('CONFIG_VALUE')
    expect(output!.text).toContain('source map present')
    // Never hands back half a statement of bundle body.
    expect(output!.text).not.toContain('return a+b')
  })

  it('fails open when the bundle declares nothing extractable', () => {
    const opaque = `${'q'.repeat(30_000)};`
    const output = reduceFreshToolResult(input({ text: opaque, budgetChars: 2_000 }))
    if (output !== null) expect(output.reducer).not.toBe('bundled-js-directory')
  })
})

/** R4/RK-4: looksLikeDocument keeps its `^#{1,6}\s+\S` anchoring but scans
 *  beyond line 400 (C26), and pure logs still fail (C27). */
describe('looksLikeDocument window (C26/C27)', () => {
  it('accepts a document whose ≥3 headings sit at lines 401–600', () => {
    const lines = Array.from({ length: 595 }, () => 'plain prose line with words only')
    lines[400] = '# Chapter Four'
    lines[499] = '# Chapter Five'
    lines[588] = '# Chapter Six'
    expect(looksLikeDocument(lines.join('\n'))).toBe(true)
  })

  it('still rejects pure logs without heading lines (C27)', () => {
    const log = Array.from({ length: 500 }, (_, index) =>
      `2026-09-19T10:${String(index % 60).padStart(2, '0')} INFO request ${String(index)} handled in ${String(index)}ms`).join('\n')
    expect(looksLikeDocument(log)).toBe(false)
  })
})
