/**
 * Fold narrative router (plan cci-sedimentation-triage, Phase 4).
 *
 * Narrative tier 2 only: called when the turn's closing body fails the
 * qualification gate, to write a short connective summary of the residual
 * spans. Transport is the existing SideChannel (fail-open, audited, per-call
 * AbortSignal) — this module adds the LAN-specific policy:
 *
 * - tier table (findings F4): ≤2K → Strata (hot decode ~157tps), 2~8K →
 *   local-35 (stable cold prefill), >8K → refuse (the 30s cold-prefill wall
 *   and the 1:15 rewrite economics both say no);
 * - queue depth 1: one fold in flight per router; a busy router SKIPS rather
 *   than stacking (concurrent prefill on one endpoint is the tensor-coexist
 *   crash-line pattern from prior measurements);
 * - retries 0: a failed fold leaves the card mechanical-only (M22 tier 3),
 *   never re-enters the next turn's budget;
 * - input hygiene (S4): pool lines and skeleton lines are physically absent
 *   from the prompt — the fold never sees what it must not paraphrase, and
 *   the prompt states that omitted output must not be reconstituted.
 */
import type { Context } from '@deepseek-ai/cordis'
import { SideChannel, type SideChannelAudit } from './tokenpilot/sidechannel.ts'
import type { SedimentSettings } from './types.ts'
import type { NarrativeSpan, VerbatimLine, MaskVerdict } from './triage/types.ts'

export type FoldTier = 'strata' | 'local35' | 'skip'

/** Tier limits in tokens of fold INPUT (spans + template). */
export const FOLD_TIER_LIMITS = Object.freeze({ strataMax: 2_048, local35Max: 8_192 })

/** Per-tier timeout budgets (ms): sized for cold prefill, not warm round-trips. */
export const FOLD_TIMEOUT_MS = Object.freeze({ strata: 8_000, local35: 12_000, large: 15_000 })

/** Output budget (plan F4: 400 tok hard cap). */
export const FOLD_MAX_TOKENS = 400

/** Tier decision over the fold input size. */
export function foldTier(inputTokens: number): FoldTier {
  if (inputTokens > FOLD_TIER_LIMITS.local35Max) return 'skip'
  return inputTokens <= FOLD_TIER_LIMITS.strataMax ? 'strata' : 'local35'
}

const FOLD_SYSTEM = 'You are writing a short connective narrative for a durable context card. '
  + 'Summarize ONLY the material given below: what was attempted and what was concluded, in 2-6 bullets. '
  + 'The card already contains verbatim error lines, file manifests, and code skeletons that were DELIBERATELY withheld from you. '
  + 'Never restate, guess, or reconstitute withheld output; never add facts not present in the material. '
  + 'Output only the bullets.'

export interface FoldPrompt {
  readonly system: string
  readonly user: string
  readonly inputTokens: number
}

/** Rough meter aligned with the replay corpus estimator (CJK-aware). */
function foldTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  return Math.ceil(cjk / 1.5 + (text.length - cjk) / 4)
}

/**
 * Assemble the fold prompt from residual narrative only. Lines that appear
 * in the protection pool or any mask section are excluded BY CONSTRUCTION
 * (S4): the caller passes triage output, and the spans entering the prompt
 * are the residual ones.
 */
export function buildFoldPrompt(
  spans: readonly NarrativeSpan[],
  protectedLines: readonly VerbatimLine[],
  masks: readonly MaskVerdict[],
): FoldPrompt | null {
  const protectedText = new Set(protectedLines.map(line => line.text))
  const maskText = masks.flatMap(mask => (mask.kind === 'skeleton' ? [...mask.lines] : []))
  const body = spans
    .filter(span => !protectedText.has(span.text) && !maskText.includes(span.text))
    .map(span => `[${span.role}] ${span.text}`)
    .join('\n')
  if (body.trim() === '') return null
  const user = `Material to fold (turn narrative residue):\n${body}`
  return { system: FOLD_SYSTEM, user, inputTokens: foldTokens(user) }
}

export interface FoldOutcome {
  readonly text?: string
  readonly audit: SideChannelAudit
}

/**
 * One fold channel per pruner instance family; queue depth 1 per session id.
 * `fold` never throws and never retries; undefined text = tier-3 mechanical card.
 */
export class FoldRouter {
  private readonly busy = new Set<string>()

  constructor(
    private readonly ctx: Context,
    private readonly settings: SedimentSettings,
  ) {}

  /** True while a fold call for that session is in flight. */
  isBusy(sessionId: string): boolean {
    return this.busy.has(sessionId)
  }

  async fold(sessionId: string, prompt: FoldPrompt, signal: AbortSignal): Promise<FoldOutcome> {
    const tier = foldTier(prompt.inputTokens)
    if (tier === 'skip') {
      return { audit: { ok: false, latencyMs: 0, reason: 'fold-input-over-8k-refused' } }
    }
    if (this.settings.foldMode === undefined || this.settings.foldMode === '') {
      return { audit: { ok: false, latencyMs: 0, reason: 'fold-unconfigured' } }
    }
    if (this.busy.has(sessionId)) {
      return { audit: { ok: false, latencyMs: 0, reason: 'fold-busy-skip' } }
    }
    this.busy.add(sessionId)
    try {
      const endpoint = tier === 'strata'
        ? { provider: this.settings.foldStrataProvider, model: this.settings.foldStrataModel }
        : { provider: this.settings.foldLocal35Provider, model: this.settings.foldLocal35Model }
      if (endpoint.provider === undefined || endpoint.model === undefined) {
        return { audit: { ok: false, latencyMs: 0, reason: `fold-endpoint-missing:${tier}` } }
      }
      const timeoutMs = tier === 'strata' ? FOLD_TIMEOUT_MS.strata
        : prompt.inputTokens > FOLD_TIER_LIMITS.strataMax ? FOLD_TIMEOUT_MS.large : FOLD_TIMEOUT_MS.local35
      const channel = new SideChannel(
        this.ctx,
        {
          estimatorMode: this.settings.foldMode,
          estimatorProvider: endpoint.provider,
          estimatorModel: endpoint.model,
          ...(this.settings.foldBaseUrl === undefined ? {} : { estimatorBaseUrl: this.settings.foldBaseUrl }),
          ...(this.settings.foldBaseUrlKey === undefined ? {} : { estimatorApiKey: this.settings.foldBaseUrlKey }),
        },
        { timeoutMs, maxTokens: FOLD_MAX_TOKENS },
      )
      const result = await channel.askAudited({ system: prompt.system, user: prompt.user, signal })
      return result
    } finally {
      this.busy.delete(sessionId)
    }
  }
}
