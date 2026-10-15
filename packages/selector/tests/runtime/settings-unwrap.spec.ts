import { describe, expect, it } from 'vitest'
import { unwrapSettingsEntry } from '../../src/pruner.ts'
import { parseContextCompressionSettings } from '../../src/runtime/config.ts'

// The desktop 0.2.0 host hands back the whole entry config `{ settings: <subtree> }`;
// the parser only understands the subtree. Regression guard for the fail-open-to-off
// bug that silently disabled fresh/aggregate on the desktop (0 compression).
const SUBTREE = {
  profile: 'tokenpilot-inspired',
  custom: {
    version: 3,
    unit: 'tokens',
    fresh: { enabled: true, trigger: 8192, target: 3072 },
    aggregate: { enabled: true, trigger: 32768, target: 12288 },
    history: { enabled: true, trigger: 500000, keepRecentToolCalls: 10, keepRecentTokens: 64000, minReclaim: 96000 },
    prefixPolicy: 'pressure-break',
    tailTrim: { enabled: false, trigger: 700000 },
  },
  autoCompact: { thresholdPercent: 80 },
  codeSkeleton: { enabled: true },
  intentSummary: { enabled: true },
  monitorPanel: { enabled: true },
  presetOptions: { estimatorMode: 'host', estimatorProvider: 'local-35', estimatorModel: 'Qwen3.6-35B-A3B' },
}

describe('unwrapSettingsEntry (0.2.0 host config wrapper)', () => {
  it('descends a single {settings:<obj>} wrapper when the root has no profile', () => {
    expect(unwrapSettingsEntry({ settings: SUBTREE })).toBe(SUBTREE)
  })

  it('leaves a bare subtree (root already has profile) untouched', () => {
    expect(unwrapSettingsEntry(SUBTREE)).toBe(SUBTREE)
  })

  it('leaves non-object and array values untouched', () => {
    expect(unwrapSettingsEntry(undefined)).toBe(undefined)
    expect(unwrapSettingsEntry(null)).toBe(null)
    expect(unwrapSettingsEntry('x')).toBe('x')
    const arr = [1, 2]
    expect(unwrapSettingsEntry(arr)).toBe(arr)
  })

  it('does NOT descend when `settings` is not an object (keeps exotic rejection intact)', () => {
    const exotic = { settings: 'not-an-object' }
    expect(unwrapSettingsEntry(exotic)).toBe(exotic)
  })

  it('round-trips the wrapped desktop value where the bare parse would throw', () => {
    // The exact desktop failure: wrapped shape → parse throws "missing its
    // complete shape" → activeSettings fails open to profile:'off'. After the
    // one-level unwrap the same value parses to tokenpilot-inspired (fresh on).
    const wrapped = { settings: SUBTREE }
    expect(() => parseContextCompressionSettings(wrapped)).toThrow(/complete shape|plain/)
    const parsed = parseContextCompressionSettings(unwrapSettingsEntry(wrapped) as never)
    expect(parsed.profile).toBe('tokenpilot-inspired')
    expect(parsed.presetOptions?.estimatorMode).toBe('host')
  })
})
