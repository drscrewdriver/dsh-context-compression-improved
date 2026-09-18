/**
 * TokenPilot-inspired R4 integration coverage: the human-gated review pipeline
 * on published Harness APIs. Mirrors the public-runtime harness (real
 * Session/log, exact tokenizer, host settings) and pins the four acceptance
 * behaviors from the phase-1 spec: approved proposals execute as one merged
 * batch at the turn boundary with evidence-built receipts; tampered content
 * voids instead of deleting; expired proposals never execute; review-off
 * behavior stays byte-identical to the automatic path.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  ToolCallId as CallId,
  createMessage,
  createUserMessage,
  createToolResultMessage,
  freezeMessage,
} from '@deepseek-ai/dsh-llm'
import SessionStore, {
  Session,
  SessionId,
  SessionSeq,
  canonicalHeader,
} from '@deepseek-ai/dsh-session'
import {
  SettingsProvider,
  type SettingsNamespace,
} from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as SelectorHost from '../../../src/index.ts'
import { sessionEvents } from '../../../src/runtime/session-events.ts'
import ToolResultPruner, {
  CONTEXT_COMPRESSION_SETTINGS_NAMESPACE,
} from '../../../src/pruner.ts'
import { measureForCompaction } from '../../../src/runtime/measurement.ts'
import {
  COMPRESSION_AUDIT_PREFIX,
  type CompressionAuditRecord,
  type CompressionRewriteAuditRecord,
  type ReviewOutcomeAuditRecord,
} from '../../../src/runtime/audit.ts'

const MODEL = 'deepseek-v4-flash'

class TestSettings extends SettingsProvider {
  readonly writable = true
  private readonly stored: Record<string, unknown> = {}

  protected override load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.stored))
  }

  protected override persist(namespace: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.stored[namespace] = structuredClone(section)
    return Promise.resolve()
  }
}

async function runtimeContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore).await()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(ToolRuntime).await()
  await ctx.plugin(SessionProjectionRegistry).await()
  await ctx.plugin(TokenMeter).await()
  return ctx
}

function captureAudit(ctx: Context): { records(): CompressionAuditRecord[] } {
  const info = vi.spyOn(ctx.logger, 'info').mockImplementation(() => ctx.logger)
  return {
    records: () => info.mock.calls.flatMap((call) => {
      const line = String(call[0])
      return line.startsWith(COMPRESSION_AUDIT_PREFIX)
        ? [JSON.parse(line.slice(COMPRESSION_AUDIT_PREFIX.length)) as CompressionAuditRecord]
        : []
    }),
  }
}

function rewrites(records: readonly CompressionAuditRecord[]): CompressionRewriteAuditRecord[] {
  return records.filter((record): record is CompressionRewriteAuditRecord => record.kind === 'rewrite')
}

function reviewEvents(records: readonly CompressionAuditRecord[]): ReviewOutcomeAuditRecord[] {
  return records.filter((record): record is ReviewOutcomeAuditRecord => record.kind === 'review-outcome')
}

const nsBrand = (value: string): SettingsNamespace => value as unknown as SettingsNamespace

function appendToolTurn(
  session: Session,
  turn: number,
  text: string,
  closeTurn: boolean,
): { readonly assistantSeq: number; readonly resultSeq: number } {
  const callId = CallId(`call-${String(turn)}`)
  session.append('turn/start', { turn })
  if (session.requestHeader() === undefined) {
    session.append('request/header', {
      reason: 'initial',
      header: canonicalHeader({ config: { provider: 'deepseek', model: MODEL } }),
    })
  }
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `user turn ${String(turn)}` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn, step: 1 })
  const assistant = session.append('assistant/message', {
    stream: [],
    turn,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: callId, name: 'bash', arguments: '{}' }],
      source: { kind: 'model', provider: 'deepseek', model: MODEL },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/call', { turn, step: 1, callId, name: 'bash', arguments: '{}' })
  const result = session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  if (closeTurn) session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return { assistantSeq: assistant.seq, resultSeq: result.seq }
}

/** Rewrite one surface tool result in place, the way land() publishes a replacement. */
function tamperResult(session: Session, seq: number, text: string): void {
  const event = sessionEvents(session).find(entry => entry.seq === seq)
  if (event?.type !== 'tool/result') throw new Error(`seq ${String(seq)} is not a tool result`)
  const message = event.data.message
  // The session accepts a surface replacement only when every non-content
  // field stays identical, so freeze the original message and swap the blocks.
  session.append('tool/result', {
    ...event.data,
    message: freezeMessage({
      ...message,
      content: [{ ...message.content[0], content: [{ type: 'text', text }] }],
    }),
  }, {
    surfaceOp: { op: 'replace', startSeq: SessionSeq(seq), endSeq: SessionSeq(seq) },
    sourceEventSeqs: [SessionSeq(seq)],
  })
}

async function reviewSetup(ctx: Context, reviewMode: boolean): Promise<void> {
  await ctx.plugin(TestSettings).await()
  await ctx.plugin(SelectorHost).await()
  await ctx.settings.update(nsBrand(CONTEXT_COMPRESSION_SETTINGS_NAMESPACE), {
    profile: 'tokenpilot-inspired',
    ...(reviewMode
      ? { presetOptions: { reviewMode: true, reviewHighImpactTokens: 1 } }
      : {}),
  })
  await ctx.plugin(ToolResultPruner, {
    profile: 'tokenpilot-inspired',
    freshTriggerTokens: 100_000,
    freshTargetTokens: 90_000,
    aggregateTriggerTokens: 100_000,
    aggregateTargetTokens: 90_000,
    historyTriggerTokens: 400,
    historyKeepRecentToolCalls: 0,
    historyKeepRecentTokens: 1,
    historyMinReclaimTokens: 1,
  }).await()
}

/** One aged old result plus one protected recent result, with an open turn. */
function reviewSession(ctx: Context, id: string, oldText: string): {
  session: Session
  oldResultSeq: number
} {
  const _pruner = ctx.toolResultPruner
  const session = Session.create(SessionId(id))
  const old = appendToolTurn(session, 1, oldText, true)
  appendToolTurn(session, 2, 'newest protected result', true)
  const total = measureForCompaction(ctx, session).totalTokens
  session.append('request/context', {
    provider: 'deepseek',
    model: MODEL,
    contextWindow: Math.floor(total / 0.6),
  })
  session.append('turn/start', { turn: 3 })
  return { session, oldResultSeq: old.resultSeq }
}

describe('tokenpilot review pipeline (host integration)', () => {
  it('withholds high-impact candidates from landing and queues them for review', async () => {
    const ctx = await runtimeContext()
    await reviewSetup(ctx, true)
    const audit = captureAudit(ctx)
    const { session, oldResultSeq } = reviewSession(ctx, 'review-queue-withhold', 'old reviewable evidence '.repeat(600))

    const result = ctx.toolResultPruner.pruneSession(session, { stage: 'pressure' })

    // The old candidate was planned but withheld: nothing landed.
    expect(result.pruned).toHaveLength(0)
    const pending = ctx.toolResultPruner.listReviewProposals(session)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.status).toBe('pending')
    expect(pending[0]!.items[0]!.seq).toBe(oldResultSeq)
    expect(reviewEvents(audit.records()).filter(entry => entry.event === 'enqueue')).toHaveLength(1)
    // And the original content is still on the surface.
    expect(rewrites(audit.records())).toHaveLength(0)
  })

  it('executes an approved proposal at the turn boundary with an evidence-built receipt', async () => {
    const ctx = await runtimeContext()
    await reviewSetup(ctx, true)
    const audit = captureAudit(ctx)
    const { session } = reviewSession(ctx, 'review-apply-e2e', 'old reviewable evidence '.repeat(600))
    ctx.toolResultPruner.pruneSession(session, { stage: 'pressure' })
    const pending = ctx.toolResultPruner.listReviewProposals(session)
    const proposalId = pending[0]!.id

    expect(ctx.toolResultPruner.decideReviewProposal(session, proposalId, 'approved')).toEqual({ ok: true })
    expect(reviewEvents(audit.records()).some(entry => entry.event === 'decide' && entry.decision === 'approved')).toBe(true)

    ctx.toolResultPruner.applyApprovedProposals(session)

    const applied = rewrites(audit.records()).filter(entry => entry.reducer === 'review-approved-whole-result')
    expect(applied).toHaveLength(1)
    expect(applied[0]!.tokensBefore).toBeGreaterThan(applied[0]!.tokensAfter)
    const receipts = reviewEvents(audit.records()).filter(entry => entry.event === 'apply-receipt')
    expect(receipts).toHaveLength(1)
    expect(receipts[0]!.proposalId).toBe(proposalId)
    expect(receipts[0]!.receiptStatus).toBe('applied')
    // The receipt numbers come from the executed mutation, not the estimate.
    expect(receipts[0]!.tokensBefore).toBe(applied[0]!.tokensBefore)
    expect(receipts[0]!.tokensAfter).toBe(applied[0]!.tokensAfter)
    // Retired from the queue: a second apply must not re-execute.
    expect(ctx.toolResultPruner.listReviewProposals(session)).toHaveLength(0)
    const before = sessionEvents(session).length
    ctx.toolResultPruner.applyApprovedProposals(session)
    expect(sessionEvents(session)).toHaveLength(before)
  })

  it('voids a proposal whose content changed between approval and the apply point', async () => {
    const ctx = await runtimeContext()
    await reviewSetup(ctx, true)
    const audit = captureAudit(ctx)
    const { session, oldResultSeq } = reviewSession(ctx, 'review-void-tamper', 'old reviewable evidence '.repeat(600))
    ctx.toolResultPruner.pruneSession(session, { stage: 'pressure' })
    const proposalId = ctx.toolResultPruner.listReviewProposals(session)[0]!.id
    // The user approved; a later step then rewrote the same surface content.
    tamperResult(session, oldResultSeq, 'tampered by a later step')
    expect(ctx.toolResultPruner.decideReviewProposal(session, proposalId, 'approved')).toEqual({ ok: true })

    ctx.toolResultPruner.applyApprovedProposals(session)

    // No deletion: the digest mismatch voided the whole proposal.
    expect(rewrites(audit.records()).some(entry => entry.reducer === 'review-approved-whole-result')).toBe(false)
    const voids = reviewEvents(audit.records()).filter(entry => entry.event === 'apply-void')
    expect(voids).toHaveLength(1)
    expect(voids[0]!.proposalId).toBe(proposalId)
    expect(voids[0]!.reasonCode).toBe('review_receipt_digest_invalid')
    // The tampered content is untouched on the surface.
    const surface = sessionEvents(session).filter(entry => entry.type === 'tool/result')
    const last = surface.at(-1)
    if (last?.type !== 'tool/result') throw new Error('missing surface tool result')
    expect(last.data.message.content[0].content[0]).toMatchObject({ text: 'tampered by a later step' })
  })

  it('expires stale pending proposals and never executes them afterwards', async () => {
    const ctx = await runtimeContext()
    await reviewSetup(ctx, true)
    const audit = captureAudit(ctx)
    const { session } = reviewSession(ctx, 'review-expiry', 'old reviewable evidence '.repeat(600))
    ctx.toolResultPruner.pruneSession(session, { stage: 'pressure' })
    const proposalId = ctx.toolResultPruner.listReviewProposals(session)[0]!.id

    // Within the patience window the proposal survives.
    expect(ctx.toolResultPruner.expireReviewProposals(session, 5)).toHaveLength(0)
    expect(ctx.toolResultPruner.listReviewProposals(session)).toHaveLength(1)
    // Past reviewTimeoutTurns (6) the pending proposal expires at the boundary.
    const expired = ctx.toolResultPruner.expireReviewProposals(session, 8)
    expect(expired.map(entry => entry.id)).toEqual([proposalId])
    expect(reviewEvents(audit.records()).some(entry => entry.event === 'expire')).toBe(true)
    expect(ctx.toolResultPruner.listReviewProposals(session)).toHaveLength(0)

    // An expired proposal cannot be approved and never executes.
    expect(ctx.toolResultPruner.decideReviewProposal(session, proposalId, 'approved'))
      .toEqual({ ok: false, reason: 'unknown-proposal' })
    ctx.toolResultPruner.applyApprovedProposals(session)
    expect(rewrites(audit.records()).some(entry => entry.reducer === 'review-approved-whole-result')).toBe(false)
  })

  it('keeps the automatic path byte-identical when review mode is off', async () => {
    const ctx = await runtimeContext()
    await reviewSetup(ctx, false)
    const audit = captureAudit(ctx)
    const { session } = reviewSession(ctx, 'review-off-identity', 'old reviewable evidence '.repeat(600))

    const result = ctx.toolResultPruner.pruneSession(session, { stage: 'pressure' })

    // History aged exactly as before the review pipeline existed.
    expect(result.pruned).toHaveLength(1)
    expect(rewrites(audit.records()).some(entry => entry.component === 'history')).toBe(true)
    expect(reviewEvents(audit.records())).toHaveLength(0)
    expect(ctx.toolResultPruner.listReviewProposals(session)).toHaveLength(0)
  })
})
