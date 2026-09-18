import { describe, expect, it } from 'vitest'
import { codePointLength } from '../../src/runtime/config.ts'
import {
  documentSectionSummaries,
  reduceFreshToolResult,
  searchNodeSummaries,
  type ReducerInput,
} from '../../src/runtime/reducers.ts'
import {
  buildRankUserPrompt,
  mergeRanking,
  parseRanking,
  rankNodes,
  sideChannelGate,
  type RankedNode,
} from '../../src/runtime/tokenpilot/sidechannel.ts'

const SOURCE_REF = 'session://s1/event/9'

function input(text: string, budgetChars = 4_000): ReducerInput {
  return {
    toolName: 'grep_search',
    argumentsText: '{"pattern":"config"}',
    text,
    budgetChars,
    sourceRef: SOURCE_REF,
    isError: false,
  }
}

function stubChannel(answer: string | undefined, calls: { count: number }): Pick<{ ask: unknown }, never> & {
  ask: (request: { system: string, user: string, signal: AbortSignal }) => Promise<string | undefined>
  askAudited: (request: { system: string, user: string, signal: AbortSignal }) => Promise<{ text?: string, audit: { ok: boolean, latencyMs: number } }>
  identity: () => string | undefined
} {
  return {
    async ask(request) {
      calls.count += 1
      void request
      return answer
    },
    async askAudited(request) {
      const text = await this.ask(request)
      return { ...(text === undefined ? {} : { text }), audit: { ok: text !== undefined, latencyMs: 1 } }
    },
    identity: () => 'stub',
  }
}

describe('rank parsing and merging (TS4)', () => {
  it('keeps only valid identifiers in returned order', () => {
    const ranked = parseRanking('b.ts, junk, a.ts, b.ts', new Set(['a.ts', 'b.ts']))
    expect(ranked).toEqual(['b.ts', 'a.ts'])
  })
  it('resolves undefined for empty or garbage answers (fail-open)', () => {
    expect(parseRanking(undefined, new Set(['a.ts']))).toBeUndefined()
    expect(parseRanking('   ', new Set(['a.ts']))).toBeUndefined()
    expect(parseRanking('I cannot rank these files', new Set(['a.ts']))).toBeUndefined()
  })
  it('appends unmentioned nodes in their original order (existence intact)', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(mergeRanking(nodes, ['c'])).toEqual([{ id: 'c' }, { id: 'a' }, { id: 'b' }])
    expect(mergeRanking(nodes, undefined)).toEqual(nodes)
  })
})

describe('cost gate (R-10)', () => {
  it('does not call when everything fits or there is a single node', () => {
    expect(sideChannelGate(true, 500)).toBe(false)
    expect(sideChannelGate(false, 1)).toBe(false)
    expect(sideChannelGate(false, 2)).toBe(true)
  })
})

describe('node summaries (SC8: samples ride with identifiers)', () => {
  it('search summaries carry path, count, and one content line', () => {
    const text = ['a.ts:1: alpha config', 'a.ts:2: beta', 'b.ts:7: gamma'].join('\n')
    const nodes = searchNodeSummaries(text)
    expect(nodes).toHaveLength(2)
    const a = nodes.find(node => node.id === 'a.ts')!
    expect(a.count).toBe(2)
    expect(a.sample).toContain('alpha config')
  })
  it('document summaries carry heading, mass, and the first content line (not only titles)', () => {
    const text = [
      '# Guide',
      'Intro sentence everyone should read.',
      '## Configuration',
      ...Array.from({ length: 20 }, (_, i) => `config line ${String(i)}`),
    ].join('\n')
    const sections = documentSectionSummaries(text)
    expect(sections).toHaveLength(2)
    const config = sections.find(section => section.id === 'Configuration')!
    expect(config.level).toBe(2)
    expect(config.chars).toBeGreaterThan(100)
    expect(config.sample).toContain('config line 0')
  })
  it('the rank prompt embeds query, reasoning, and samples (AD11 intent carrier)', () => {
    const nodes: RankedNode[] = [{ id: 'a.ts', detail: '2 hits', sample: 'alpha config line' }]
    const prompt = buildRankUserPrompt(nodes, 'find loading config', 'the user wants the config loader')
    expect(prompt).toContain('query: find loading config')
    expect(prompt).toContain('reasoning: the user wants the config loader')
    expect(prompt).toContain('a.ts | 2 hits | alpha config line')
  })
})

describe('S1a ranked search fold', () => {
  const rows = [
    ...Array.from({ length: 40 }, (_, i) => `fat.ts:${String(i + 1)}: fat row ${String(i)}`),
    ...Array.from({ length: 40 }, (_, i) => `star.ts:${String(i + 1)}: star row ${String(i)}`),
  ]

  it('ranked file fills L2 first while L1 stays complete (existence lossless)', () => {
    const tight = input(rows.join('\n'), 1_500)
    const mechanical = reduceFreshToolResult(tight)!
    const ranked = reduceFreshToolResult(tight, { files: ['star.ts'] })!
    expect(ranked.reducer).toBe('search-by-file')
    // L1 locator sets survive untouched for both files.
    const locatorOf = (text: string, path: string): string | undefined =>
      text.split('\n').find(line => line.startsWith(`## ${path}`))
    for (const text of [mechanical.text, ranked.text]) {
      expect(locatorOf(text, 'fat.ts')!.match(/L\d+/gu)).toHaveLength(40)
      expect(locatorOf(text, 'star.ts')!.match(/L\d+/gu)).toHaveLength(40)
    }
    // Ranking only changes which rows the quota shows first.
    const countRows = (text: string, path: string): number =>
      text.split('\n').filter(line => line.startsWith(`${path}:`)).length
    expect(countRows(ranked.text, 'star.ts')).toBeGreaterThanOrEqual(countRows(mechanical.text, 'star.ts'))
  })

  it('counter-proof: no ranking reproduces the mechanical output byte-for-byte', () => {
    const tight = input(rows.join('\n'), 1_500)
    const mechanical = reduceFreshToolResult(tight)!.text
    expect(reduceFreshToolResult(tight, {})!.text).toBe(mechanical)
    expect(reduceFreshToolResult(tight, { files: [] })!.text).toBe(mechanical)
  })

  it('an LM ranking with unknown paths changes nothing', () => {
    const tight = input(rows.join('\n'), 1_500)
    const mechanical = reduceFreshToolResult(tight)!.text
    expect(reduceFreshToolResult(tight, { files: ['nope.ts'] })!.text).toBe(mechanical)
  })
})

describe('S1b ranked document fold', () => {
  function doc(): string {
    const parts: string[] = ['# Guide', 'Intro line.']
    for (const [name, size] of [['Small', 6] as const, ['Target Section', 40] as const, ['Appendix', 30] as const]) {
      parts.push(`## ${name}`)
      parts.push(...Array.from({ length: size }, (_, i) => `${name} body line ${String(i)} with ordinary prose.`))
    }
    return parts.join('\n')
  }

  function docInput(budget: number): ReducerInput {
    return { ...input(doc(), budget), toolName: 'mcp_fetch' }
  }

  it('selected section keeps full content; unselected keep heading plus first line', () => {
    const budget = 4_000
    const ranked = reduceFreshToolResult(docInput(budget), { sections: ['Target Section'] })
    expect(ranked).not.toBeNull()
    expect(ranked!.reducer).toBe('doc-skeleton')
    const text = ranked!.text
    // All headings survive (existence is never the channel's to remove).
    for (const heading of ['Guide', 'Small', 'Target Section', 'Appendix']) {
      expect(text).toContain(heading)
    }
    // Selected: full content fits. Unselected: first line only.
    expect(text).toContain('Target Section body line 39')
    expect(text).not.toContain('Appendix body line 29')
    expect(text).toContain('Appendix body line 0')
    expect(codePointLength(text)).toBeLessThanOrEqual(budget)
  })

  it('fills the ranked section partially when the budget cannot hold it whole', () => {
    const tight = reduceFreshToolResult(docInput(1_600), { sections: ['Target Section'] })!
    expect(codePointLength(tight.text)).toBeLessThanOrEqual(1_600)
    // More than the first-line floor of the ranked section survives.
    expect(tight.text.split('\n').filter(line => line.startsWith('Target Section body line')).length).toBeGreaterThan(1)
    // Unselected sections still show their first line (mechanical floor).
    expect(tight.text).toContain('Appendix body line 0')
  })

  it('counter-proof: no ranking reproduces the mechanical skeleton byte-for-byte', () => {
    const budget = 1_600
    const mechanical = reduceFreshToolResult(docInput(budget))!.text
    expect(reduceFreshToolResult(docInput(budget), { sections: [] })!.text).toBe(mechanical)
  })
})

describe('S1 orchestrator', () => {
  it('makes exactly ONE call and applies the ranking', async () => {
    const calls = { count: 0 }
    const channel = stubChannel('b.ts, a.ts', calls)
    const outcome = await rankNodes(
      [
        { id: 'a.ts', detail: '3 hits', sample: 'alpha' },
        { id: 'b.ts', detail: '9 hits', sample: 'beta' },
      ],
      new Set(['a.ts', 'b.ts']),
      'find the loader',
      'wants config loading',
      channel,
      AbortSignal.timeout(1_000),
    )
    expect(calls.count).toBe(1)
    expect(outcome.ranking).toEqual(['b.ts', 'a.ts'])
    expect(outcome.audit.ok).toBe(true)
  })
  it('falls back with an audit record when the channel returns nothing', async () => {
    const calls = { count: 0 }
    const outcome = await rankNodes(
      [
        { id: 'a.ts', detail: '3 hits', sample: 'alpha' },
        { id: 'b.ts', detail: '9 hits', sample: 'beta' },
      ],
      new Set(['a.ts', 'b.ts']),
      'find the loader',
      undefined,
      stubChannel(undefined, calls),
      AbortSignal.timeout(1_000),
    )
    expect(outcome.ranking).toBeUndefined()
    expect(outcome.audit.ok).toBe(false)
    expect(outcome.audit.reason).toContain('falling back')
  })
  it('gate stays closed for a single node or an empty query (zero calls)', async () => {
    const calls = { count: 0 }
    const outcome = await rankNodes(
      [{ id: 'a.ts', detail: '3 hits', sample: 'alpha' }],
      new Set(['a.ts']),
      'find the loader',
      undefined,
      stubChannel('a.ts', calls),
      AbortSignal.timeout(1_000),
    )
    expect(calls.count).toBe(0)
    expect(outcome.ranking).toBeUndefined()
  })
})
