import { describe, expect, it, vi } from 'vitest'
import {
  COMPRESSION_AUDIT_PREFIX,
  emitCompressionAudit,
  formatCompressionAudit,
} from '../../src/runtime/audit.ts'
import type { CompressionAuditRecord, CompressionRewriteAuditRecord } from '../../src/runtime/audit.ts'

const custom = {
  version: 3 as const,
  unit: 'tokens' as const,
  fresh: { enabled: true, trigger: 8_192, target: 3_072 },
  aggregate: { enabled: true, trigger: 32_768, target: 12_288 },
  history: {
    enabled: true,
    trigger: 500_000,
    keepRecentToolCalls: 10,
    keepRecentTokens: 64_000,
    minReclaim: 96_000,
  },
  prefixPolicy: 'pressure-break' as const,
  tailTrim: { enabled: true, trigger: 700_000 },
}

describe('context-compression audit records', () => {
  it('formats one complete frozen-policy record without model-visible content', () => {
    const record: CompressionAuditRecord = {
      schemaVersion: 1,
      kind: 'policy-frozen',
      sessionId: 'audit-session',
      settingsSource: 'host-settings',
      settings: {
        profile: 'custom',
        custom,
        autoCompact: { thresholdPercent: 80 },
        codeSkeleton: { enabled: false },
      },
      deploymentConfig: {
        profile: 'balanced',
        headChars: 4_096,
        tailChars: 1_024,
      },
    }

    const line = formatCompressionAudit(record)

    expect(line).toBe(`${COMPRESSION_AUDIT_PREFIX}${JSON.stringify(record)}`)
    expect(JSON.parse(line.slice(COMPRESSION_AUDIT_PREFIX.length))).toEqual(record)
    expect(line).not.toContain('prompt')
    expect(line).not.toContain('toolArguments')
    expect(line).not.toContain('toolResult')
    expect(line).not.toContain('apiKey')
  })

  it('keeps component provenance and exact token arithmetic on rewrite records', () => {
    const record: CompressionAuditRecord = {
      schemaVersion: 1,
      kind: 'rewrite',
      sessionId: 'history-session',
      profile: 'cache-strict',
      component: 'history',
      stage: 'pressure',
      reducer: 'historical-tool-result-aging',
      historyMode: 'capacity-pressure',
      manifestEventType: 'compaction/prune',
      manifestSeq: 41,
      replacementSeq: 42,
      sourceSeqs: [12],
      tokensBefore: 600_100,
      tokensAfter: 100,
      tokensRemoved: 600_000,
      tokenizerId: 'mock-tokenizer',
      tokenizerRevision: 'r1',
      measurementBasis: 'exact-tokenizer',
    }

    const parsed = JSON.parse(
      formatCompressionAudit(record).slice(COMPRESSION_AUDIT_PREFIX.length),
    ) as CompressionAuditRecord

    expect(parsed).toEqual(record)
    expect(parsed.kind === 'rewrite' && parsed.tokensRemoved)
      .toBe(record.tokensBefore - record.tokensAfter)
  })

  // task_4c/G7: the elided-line count rides the rewrite audit record (optional,
  // JSON round-trip) so the compress→retrieve M/N ratio is computable from
  // session logs alone; records without reducer telemetry omit the field.
  it('round-trips elidedLines on rewrite records and omits it when absent', () => {
    const withTelemetry: CompressionAuditRecord = {
      schemaVersion: 1,
      kind: 'rewrite',
      sessionId: 'telemetry-session',
      profile: 'balanced',
      component: 'fresh',
      stage: 'fresh',
      reducer: 'hypa-code-skeleton',
      manifestEventType: 'compaction/prune',
      manifestSeq: 7,
      replacementSeq: 8,
      sourceSeqs: [6],
      tokensBefore: 20_000,
      tokensAfter: 3_000,
      tokensRemoved: 17_000,
      tokenizerId: 'mock-tokenizer',
      tokenizerRevision: 'r1',
      measurementBasis: 'exact-tokenizer',
      elidedLines: 412,
    }
    const parsed = JSON.parse(
      formatCompressionAudit(withTelemetry).slice(COMPRESSION_AUDIT_PREFIX.length),
    ) as CompressionRewriteAuditRecord
    expect(parsed.elidedLines).toBe(412)

    const { elidedLines: _omitted, ...placeholderRecord } = withTelemetry
    void _omitted
    const withoutTelemetry: CompressionAuditRecord = {
      ...placeholderRecord,
      reducer: 'error-evidence-placeholder',
    }
    expect('elidedLines' in withoutTelemetry).toBe(false)
    const parsedWithout = JSON.parse(
      formatCompressionAudit(withoutTelemetry).slice(COMPRESSION_AUDIT_PREFIX.length),
    ) as CompressionRewriteAuditRecord
    expect(parsedWithout.elidedLines).toBeUndefined()
  })

  it('publishes exactly one single-line info message', () => {
    const info = vi.fn()
    const record: CompressionAuditRecord = {
      schemaVersion: 1,
      kind: 'native-auto-compact',
      sessionId: 'native-session',
      manifestEventType: 'compaction/summary',
      manifestSeq: 9,
      reducer: 'llm-summary',
      provider: 'mock',
      model: 'mock',
      tokensBefore: 1_024,
      tokensAfter: null,
    }

    emitCompressionAudit({ info }, record)

    expect(info).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledWith(formatCompressionAudit(record))
    expect(String(info.mock.calls[0]?.[0])).not.toContain('\n')
  })

  it('does not let logger failure roll back an already committed rewrite', () => {
    const record: CompressionAuditRecord = {
      schemaVersion: 1,
      kind: 'native-auto-compact',
      sessionId: 'native-session',
      manifestEventType: 'compaction/summary',
      manifestSeq: 9,
      reducer: 'llm-summary',
      provider: 'mock',
      model: 'mock',
      tokensBefore: 1_024,
      tokensAfter: null,
    }

    expect(() => {
      emitCompressionAudit({
        info: () => {
          throw new Error('logger unavailable')
        },
      }, record)
    }).not.toThrow()
  })

  it('keeps reduction-advice records free of content, digests, and keys', () => {
    const record: CompressionAuditRecord = {
      schemaVersion: 1,
      kind: 'reduction-advice',
      sessionId: 'advice-session',
      profile: 'tokenpilot-inspired',
      band: 'high-impact',
      stage: 'fresh',
      itemSeqs: [7, 9],
      pricedCandidates: 2,
      maxTokensBefore: 9_200,
      tokensBefore: 12_400,
      tokensAfter: 3_100,
      recoveredTokens: 9_300,
      penaltyTokens: 0,
      paybackTurns: 0,
      turnIndex: 12,
    }

    const line = formatCompressionAudit(record)
    const parsed = JSON.parse(line.slice(COMPRESSION_AUDIT_PREFIX.length)) as CompressionAuditRecord
    expect(parsed).toEqual(record)
    // Only ids, enums, and numbers: no digests, no content fields.
    expect(line).not.toContain('digest')
    expect(line).not.toContain('"content"')
    expect(line).not.toContain('"text"')
    expect(line).not.toContain('apiKey')
  })

  it('describes an advised batch without any gate vocabulary', () => {
    // The band can be the model's worst opinion — `not-worth-it` — and the
    // record still only DESCRIBES a batch that landed: the retired review
    // gate's decision vocabulary cannot be expressed any more.
    const record: CompressionAuditRecord = {
      schemaVersion: 1,
      kind: 'reduction-advice',
      sessionId: 'advice-session',
      profile: 'tokenpilot-inspired',
      band: 'not-worth-it',
      stage: 'history',
      itemSeqs: [3],
      pricedCandidates: 1,
      maxTokensBefore: 5_000,
      tokensBefore: 5_000,
      tokensAfter: 4_000,
      recoveredTokens: 1_000,
      penaltyTokens: 3_600,
      paybackTurns: 36,
      expectedSaving: 0,
    }
    const line = formatCompressionAudit(record)
    const parsed = JSON.parse(line.slice(COMPRESSION_AUDIT_PREFIX.length)) as CompressionAuditRecord
    expect(parsed).toEqual(record)
    for (const gone of ['proposalId', 'proposalKind', 'decision', 'receipt', '"event"', 'reasonCode']) {
      expect(line).not.toContain(gone)
    }
  })

  it('keeps advisor-outcome records free of prompts, keys, and content', () => {
    const record: CompressionAuditRecord = {
      schemaVersion: 1,
      kind: 'advisor-outcome',
      sessionId: 'advisor-session',
      phase: 'decay',
      ok: true,
      sampledCount: 16,
      decay: 0.42,
      weightedChars: 57_688,
      turnIndex: 12,
      latencyMs: 0,
    }

    const line = formatCompressionAudit(record)
    const parsed = JSON.parse(line.slice(COMPRESSION_AUDIT_PREFIX.length)) as CompressionAuditRecord
    expect(parsed).toEqual(record)
    // Only enums and numbers: never the todo snapshot, assistant text, prompts, or keys.
    expect(line).not.toContain('prompt')
    expect(line).not.toContain('"content"')
    expect(line).not.toContain('"text"')
    expect(line).not.toContain('apiKey')
    expect(line).not.toContain('todo')
  })

  it('carries failure reason codes and the LLM channel on advisor-outcome records', () => {
    const record: CompressionAuditRecord = {
      schemaVersion: 1,
      kind: 'advisor-outcome',
      sessionId: 'advisor-session',
      phase: 'scoring',
      channel: 'direct',
      ok: false,
      sampledCount: 0,
      turnIndex: 3,
      reason: 'no-direct-endpoint',
      latencyMs: 4,
    }
    const parsed = JSON.parse(
      formatCompressionAudit(record).slice(COMPRESSION_AUDIT_PREFIX.length),
    ) as CompressionAuditRecord
    expect(parsed).toEqual(record)
  })
})
