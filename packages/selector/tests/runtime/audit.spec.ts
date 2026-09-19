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

  it('keeps review-outcome records free of proposal content', () => {
    const record: CompressionAuditRecord = {
      schemaVersion: 1,
      kind: 'review-outcome',
      sessionId: 'review-session',
      proposalId: 'a1b2c3d4e5f6',
      proposalKind: 'read-state',
      event: 'apply-receipt',
      receiptStatus: 'applied',
      itemSeqs: [7, 9],
      tokensBefore: 1400,
      tokensAfter: 1000,
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

  it('carries reason codes on void and deferred review events', () => {
    const record: CompressionAuditRecord = {
      schemaVersion: 1,
      kind: 'review-outcome',
      sessionId: 'review-session',
      proposalId: 'b2c3d4e5f6a1',
      proposalKind: 'dedup',
      event: 'apply-void',
      reasonCode: 'review_receipt_digest_invalid',
      itemSeqs: [3],
      tokensBefore: 5000,
      tokensAfter: 4000,
    }
    const parsed = JSON.parse(
      formatCompressionAudit(record).slice(COMPRESSION_AUDIT_PREFIX.length),
    ) as CompressionAuditRecord
    expect(parsed).toEqual(record)
  })
})
