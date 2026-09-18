import { describe, expect, it } from 'vitest'
import { reduceFreshToolResult, type ReducerInput } from '../../src/runtime/reducers.ts'

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
})
