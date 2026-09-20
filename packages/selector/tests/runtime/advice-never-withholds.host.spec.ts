/**
 * The retired review gate's replacement, pinned at the host integration level.
 *
 * This spec exists to make the OLD failure impossible to reintroduce: with the
 * exact settings that used to divert 100% of a fresh batch into the human-gated
 * review queue (`reviewMode: true` + a `reviewHighImpactTokens` threshold far
 * below the batch), the batch must LAND, and the benefit model must publish its
 * opinion as a `reduction-advice` audit instead of withholding anything.
 *
 * "缩减不阻断自动处理": advice describes a landing, it never gates one.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  ToolCallId as CallId,
  createMessage,
  createUserMessage,
  createToolResultMessage,
} from '@deepseek-ai/dsh-llm'
import SessionStore, {
  Session,
  SessionId,
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
import * as SelectorHost from '../../src/index.ts'
import ToolResultPruner, {
  CONTEXT_COMPRESSION_SETTINGS_NAMESPACE,
} from '../../src/pruner.ts'
import { measureForCompaction } from '../../src/runtime/measurement.ts'
import {
  COMPRESSION_AUDIT_PREFIX,
  type CompressionAuditRecord,
  type CompressionRewriteAuditRecord,
  type ReductionAdviceAuditRecord,
} from '../../src/runtime/audit.ts'

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

function adviceOf(records: readonly CompressionAuditRecord[]): ReductionAdviceAuditRecord[] {
  return records.filter((record): record is ReductionAdviceAuditRecord => record.kind === 'reduction-advice')
}

const nsBrand = (value: string): SettingsNamespace => value as unknown as SettingsNamespace

function appendToolTurn(session: Session, turn: number, text: string): void {
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
  session.append('assistant/message', {
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
  session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
}

/**
 * The settings that used to withhold everything: review mode ON with a
 * high-impact threshold of 1 token. History pricing is kept production-like
 * (64,000 protected tail tokens) so the batch is only landable through the
 * fresh stage.
 */
async function gatedSettings(ctx: Context): Promise<void> {
  await ctx.plugin(TestSettings).await()
  await ctx.plugin(SelectorHost).await()
  await ctx.settings.update(nsBrand(CONTEXT_COMPRESSION_SETTINGS_NAMESPACE), {
    profile: 'tokenpilot-inspired',
    presetOptions: { reviewMode: true, reviewHighImpactTokens: 1 },
  })
  await ctx.plugin(ToolResultPruner, {
    profile: 'tokenpilot-inspired',
    freshTriggerTokens: 200,
    freshTargetTokens: 100,
    aggregateTriggerTokens: 1_000_000,
    aggregateTargetTokens: 900_000,
    historyTriggerTokens: 400,
    historyKeepRecentToolCalls: 0,
    historyKeepRecentTokens: 64_000,
    historyMinReclaimTokens: 1,
  }).await()
}

function freshSession(ctx: Context, id: string, text: string): Session {
  const session = Session.create(SessionId(id))
  appendToolTurn(session, 1, text)
  const total = measureForCompaction(ctx, session).totalTokens
  session.append('request/context', {
    provider: 'deepseek',
    model: MODEL,
    contextWindow: Math.floor(total / 0.6),
  })
  // Fresh landing publishes a surface replacement, which requires an open turn.
  session.append('turn/start', { turn: 2 })
  return session
}

/** ~36,400 characters. The shipped advice threshold is 4,000 tokens, and this
 *  fixture is repetitive enough that the exact tokenizer packs it denser than
 *  the conservative 4-chars-per-token estimate (an 18,200-character variant
 *  measured under 4,000 tokens), so the volume is doubled to keep the
 *  `high-impact` label deterministic. */
const HIGH_IMPACT_TEXT = 'fresh reviewable evidence '.repeat(1_400)

describe('advice never withholds (retired review gate)', () => {
  it('lands the fresh batch the gate used to divert, and advises instead', async () => {
    const ctx = await runtimeContext()
    await gatedSettings(ctx)
    const audit = captureAudit(ctx)
    const session = freshSession(ctx, 'advice-lands', HIGH_IMPACT_TEXT)

    const result = ctx.toolResultPruner.pruneSession(session, { stage: 'fresh', freshTurn: 1, freshStep: 1 })
    const records = audit.records()

    // 1. The reduction LANDED. Under the retired gate this was the assertion
    //    that failed: the batch was withheld pending human approval.
    expect(result.pruned).toHaveLength(1)
    expect(rewrites(records).some(entry => entry.component === 'fresh')).toBe(true)

    // 2. The benefit model still speaks — as advice about the landing.
    const advice = adviceOf(records)
    expect(advice).toHaveLength(1)
    expect(advice[0]!.stage).toBe('fresh')
    expect(advice[0]!.band).toBe('high-impact')
    expect(advice[0]!.maxTokensBefore).toBeGreaterThanOrEqual(4_000)
    expect(advice[0]!.recoveredTokens).toBeGreaterThan(0)
    // The batch it describes is exactly the batch that landed.
    const landedSeqs = rewrites(records).flatMap(entry => [...entry.sourceSeqs])
    expect(advice[0]!.itemSeqs.every(seq => landedSeqs.includes(seq))).toBe(true)

    // 3. Every advice record describes a landing, never a pending decision.
    expect(advice.length).toBeLessThanOrEqual(rewrites(records).length)
  })

  it('keeps the automatic path identical when no legacy gate key is present', async () => {
    const ctx = await runtimeContext()
    await ctx.plugin(TestSettings).await()
    await ctx.plugin(SelectorHost).await()
    await ctx.settings.update(nsBrand(CONTEXT_COMPRESSION_SETTINGS_NAMESPACE), {
      profile: 'tokenpilot-inspired',
    })
    await ctx.plugin(ToolResultPruner, {
      profile: 'tokenpilot-inspired',
      freshTriggerTokens: 200,
      freshTargetTokens: 100,
      aggregateTriggerTokens: 1_000_000,
      aggregateTargetTokens: 900_000,
      historyTriggerTokens: 400,
      historyKeepRecentToolCalls: 0,
      historyKeepRecentTokens: 64_000,
      historyMinReclaimTokens: 1,
    }).await()
    const audit = captureAudit(ctx)
    const session = freshSession(ctx, 'advice-default', HIGH_IMPACT_TEXT)

    const result = ctx.toolResultPruner.pruneSession(session, { stage: 'fresh', freshTurn: 1, freshStep: 1 })
    expect(result.pruned).toHaveLength(1)
    expect(adviceOf(audit.records())).toHaveLength(1)
  })
})
