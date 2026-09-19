import { describe, expect, it } from 'vitest'
import { foldRepeatedHtmlBlocks, reduceFreshToolResult, type ReducerInput } from '../../src/runtime/reducers.ts'

const SOURCE_REF = 'session://s1/event/3'

function htmlInput(text: string, budgetChars = 2_000): ReducerInput {
  return {
    toolName: 'web_fetch',
    argumentsText: '{"url":"https://example.com"}',
    text,
    budgetChars,
    sourceRef: SOURCE_REF,
    isError: false,
  }
}

function samplePage(): string {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<script>window.tracking = "analytics payload ".repeat(200);</script>',
    '<style>body { color: red; }</style>',
    '</head>',
    '<body>',
    '<!-- navigation comment that must disappear -->',
    '<div id="main" class="wrapper" style="color: blue" onclick="track()">',
    '<h1>Pricing Overview</h1>',
    '<p>The pricing page explains tiers, quotas, and the billing cycle for every plan we offer.</p>',
    '<img src="data:image/png;base64,AAAA BillingBlob" alt="chart">',
    '<a href="https://example.com/faq" title="FAQ">Read the <strong>FAQ</strong></a>',
    '<table>',
    '<tr><th>Plan</th><th>Quota</th></tr>',
    '<tr><td>Free</td><td>5k/day</td></tr>',
    '</table>',
    '<h2>Enterprise Terms</h2>',
    '<p>Enterprise customers sign a dedicated agreement with custom data-retention guarantees.</p>',
    '</div>',
    '</body>',
    '</html>',
  ].join('\n')
}

describe('html slimming (R13)', () => {
  it('keeps body paragraphs and headings; never lands on pi-head', () => {
    const output = reduceFreshToolResult(htmlInput(samplePage()))
    expect(output).not.toBeNull()
    expect(output!.reducer).not.toBe('pi-head')
    expect(output!.reducer).toMatch(/^html-/)
    expect(output!.text).toContain('Pricing Overview')
    expect(output!.text).toContain('billing cycle for every plan')
    expect(output!.text).toContain('Enterprise Terms')
    expect(output!.text).toContain('Enterprise customers sign a dedicated agreement')
  })

  it('drops script bodies, style bodies, comments, and data URIs', () => {
    const output = reduceFreshToolResult(htmlInput(samplePage()))
    expect(output!.text).not.toContain('analytics payload')
    expect(output!.text).not.toContain('color: red')
    expect(output!.text).not.toContain('navigation comment')
    expect(output!.text).not.toContain('data:image/png')
    // Non-whitelisted attributes are stripped; href/alt/id survive (the R13
    // whitelist is href/src/alt/title/id).
    expect(output!.text).not.toContain('class="wrapper"')
    expect(output!.text).not.toContain('style="color: blue"')
    expect(output!.text).not.toContain('onclick=')
    expect(output!.text).toContain('href="https://example.com/faq"')
    expect(output!.text).toContain('alt="chart"')
  })

  it('falls back to a tag-aware skeleton when slim output exceeds the budget', () => {
    const big = samplePage().replace(
      '<h2>Enterprise Terms</h2>',
      ['<h2>Enterprise Terms</h2>', ...Array.from({ length: 120 }, (_, i) => `<p>Section sentence ${String(i)} about contracts and retention windows.</p>`)].join('\n'),
    )
    const output = reduceFreshToolResult(htmlInput(big, 1_200))
    expect(output).not.toBeNull()
    expect(output!.reducer).toBe('html-skeleton')
    expect(output!.text).toContain('<h1>Pricing Overview</h1>')
    expect(output!.text).toContain('<h2>Enterprise Terms</h2>')
    expect(output!.text).toMatch(/\[\.\.\. lines \d+-\d+ elided \(\d+ lines\)/)
  })

  it('misjudgment guard: TS generics and comparisons are not HTML', () => {
    const code = [
      'const map = new Map<string, number>()',
      'if (a < b) {',
      '  return new Array<Array<string>>()',
      '}',
      'const cmp = x < table.length ? 1 : 0',
      'export function f<T extends object>(arg: T): T {',
      '  return arg',
      '}',
    ].join('\n')
    const output = reduceFreshToolResult(htmlInput(code))
    expect(output?.reducer ?? 'none').not.toMatch(/^html-/)
  })
  // R4 third level (C23–C25, S4): deterministic repeated-block folding.
  // NOTE: byte-identical repeated blocks are ALREADY folded by the R11
  // normalizer before the reducers run — so these cases use counter-variant
  // blocks (byte-different, digit-normalized-identical), which only the HTML
  // third level can catch.
  describe('repeated-block folding (R4)', () => {
    const section = (word: string): string => [
      `<h2>Section ${word}</h2>`,
      `<p>Section ${word} carries unique body copy for the reader.</p>`,
    ].join('\n')

    it('folds a counter-variant repeated non-table block to a counted marker (C24)', () => {
      // Counter-variant navs: byte-different lines (so the R11 normalizer fold
      // leaves them alone) whose digit-normalized signature the HTML third
      // level must catch.
      const navBlock = (badge: number): readonly string[] => [
        '<div class="nav">',
        '<a href="/home">Home</a>',
        `<span class="badge">${String(badge)}</span>`,
        '</div>',
      ]
      const slim = [
        ...navBlock(1).map((text, offset) => ({ text, index: offset })),
        { text: '<h2>Section Alpha</h2>', index: 4 },
        { text: '<p>Alpha body copy.</p>', index: 5 },
        ...navBlock(2).map((text, offset) => ({ text, index: 6 + offset })),
        { text: '<h2>Section Beta</h2>', index: 10 },
        { text: '<p>Beta body copy.</p>', index: 11 },
        ...navBlock(3).map((text, offset) => ({ text, index: 12 + offset })),
        { text: '<h2>Section Gamma</h2>', index: 16 },
        { text: '<p>Gamma body copy.</p>', index: 17 },
      ]
      const folded = foldRepeatedHtmlBlocks(slim, index => index + 1)
      const markers = folded.filter(entry => entry.marker === true)
      expect(markers).toHaveLength(2)
      expect(markers[0]!.text).toBe('[×3 repeated block, first at line 1]')
      expect(markers[0]!.index).toBe(6)
    })

    it('never folds table blocks (C25)', () => {
      // Data-different tables: neither the R11 normalizer nor the HTML third
      // level may fold them.
      const tableBlock = (plan: string, quota: string, index: number): readonly { text: string, index: number }[] =>
        [
          '<table>',
          '<tr><th>Plan</th><th>Quota</th></tr>',
          `<tr><td>${plan}</td><td>${quota}</td></tr>`,
          '</table>',
        ].map((text, offset) => ({ text, index: index + offset }))
      const slim = [
        ...tableBlock('Free', '5k/day', 0),
        { text: '<h2>Alpha</h2>', index: 4 },
        ...tableBlock('Pro', '50k/day', 5),
        { text: '<h2>Beta</h2>', index: 9 },
        ...tableBlock('Max', '500k/day', 10),
        { text: '<h2>Gamma</h2>', index: 14 },
      ]
      const folded = foldRepeatedHtmlBlocks(slim, currentIndex => currentIndex + 1)
      expect(folded.filter(entry => entry.marker === true)).toHaveLength(0)
      // Every table line survives the pass untouched.
      expect(folded.filter(entry => entry.text === '<table>')).toHaveLength(3)
    })

    it('does not fold blocks whose copy differs beyond digits (S4)', () => {
      const block = (word: string, index: number): readonly { text: string, index: number }[] =>
        ['<div class="note">', `<span>${word}</span>`, '</div>']
          .map((text, offset) => ({ text, index: index + offset }))
      const same = [
        ...block('Alpha', 0), { text: '<hr>', index: 3 },
        ...block('Alpha', 4), { text: '<hr>', index: 7 },
        ...block('Alpha', 8),
      ]
      expect(foldRepeatedHtmlBlocks(same, currentIndex => currentIndex + 1)
        .filter(entry => entry.marker === true)).toHaveLength(2)
      const different = [
        ...block('Alpha', 0), { text: '<hr>', index: 3 },
        ...block('Beta', 4), { text: '<hr>', index: 7 },
        ...block('Gamma', 8),
      ]
      expect(foldRepeatedHtmlBlocks(different, currentIndex => currentIndex + 1)
        .filter(entry => entry.marker === true)).toHaveLength(0)
    })

    it('keeps header + separator row of a table in the skeleton stage (C23)', () => {
      const rows = ['<table>', '<tr><th>Plan</th><th>Quota</th></tr>', '<tr><td>Free</td><td>5k/day</td></tr>',
        '<tr><td>Pro</td><td>50k/day</td></tr>', '<tr><td>Max</td><td>500k/day</td></tr>', '</table>']
      const page = ['<h1>Plans</h1>', rows.join('\n'), '<h2>Details</h2>',
        ...Array.from({ length: 60 }, (_, index) => `<p>Detail line ${String(index)} with distinct copy ${String(index * 7)}.</p>`)].join('\n')
      const output = reduceFreshToolResult(htmlInput(page, 900))
      expect(output).not.toBeNull()
      expect(output!.reducer).toBe('html-skeleton')
      expect(output!.text).toContain('<tr><th>Plan</th><th>Quota</th></tr>')
      expect(output!.text).toContain('<tr><td>Free</td><td>5k/day</td></tr>')
    })

    it('digit-normalized signature folds counter-only variants (S4, end-to-end)', () => {
      const counterBlock = (step: number): string => [
        '<div class="page">',
        `<span>Item ${String(step * 3 + 1)}</span>`,
        `<span>Item ${String(step * 3 + 2)}</span>`,
        '</div>',
      ].join('\n')
      const page = [
        counterBlock(0), section('Alpha'),
        counterBlock(1), section('Beta'),
        counterBlock(2), section('Gamma'),
        counterBlock(3),
      ].join('\n')
      const output = reduceFreshToolResult(htmlInput(page, 400))
      expect(output).not.toBeNull()
      expect(output!.text).toContain('repeated block')
    })
  })
})
