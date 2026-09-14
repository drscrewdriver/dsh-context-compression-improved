/**
 * TokenPilot-inspired E1: lightweight zero-shot estimator channel.
 *
 * A small auxiliary model (TokenPilot uses a Qwen3.5-35B-A3B-class estimator)
 * judges residual utility of oversized historical reads: "will the model still
 * reference this file state?" Verdicts are advisory — they only extend the
 * rule-only superseded classification and never block or roll back a landed
 * rewrite. Any failure is fail-open.
 *
 * Channels: `''` (off — every consumer stays on rule-only fallbacks), `host`
 * (the Harness `llm` service with the user's configured providers), `direct`
 * (native OpenAI-compatible HTTP endpoint). The API key lives in session
 * settings only and is never logged or audited.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PresetOptionsSettings } from '../types.ts'

/** The minimal face of the Harness `llm` service this module consumes. */
export interface HostLlmLike {
  stream(request: {
    provider: string
    model: string
    messages: readonly { readonly role: 'user', readonly content: readonly { readonly type: 'text', readonly text: string }[] }[]
    system?: string
    temperature?: number
    reasoningEffort?: string
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<{ readonly type: string, readonly text?: string }>
}

/** One sampled historical read offered to the estimator. */
export interface EstimatorSample {
  readonly seq: number
  readonly path: string
  readonly turn: number
}

/** One estimator verdict for a sampled read. */
export interface EstimatorVerdict {
  readonly seq: number
  readonly expired: boolean
}

/** Per-session estimator failure bookkeeping for exponential backoff. */
export interface EstimatorFailures {
  failures: number
  cooldownUntil: number
}

/** Exponential backoff with a 5-minute cap: 1s, 2s, 4s, … */
export function backoffCooldownMs(failures: number): number {
  return Math.min(5 * 60_000, 1_000 * 2 ** Math.max(0, failures - 1))
}

export function isCoolingDown(state: EstimatorFailures | undefined, now: number): boolean {
  return state !== undefined && state.cooldownUntil > now
}

export function buildEstimatorSystemPrompt(): string {
  return [
    'You are a session residual-utility estimator.',
    'For each numbered historical file read, decide whether the live agent is likely to',
    'reference that exact file state again later in the session. Reads whose file was',
    'already rewritten, or whose task has visibly moved on, are expired.',
    'Answer with ONLY a JSON array: [{"seq":<number>,"expired":<boolean>}].',
  ].join(' ')
}

export function buildEstimatorUserPrompt(samples: readonly EstimatorSample[]): string {
  const lines = samples.map(sample =>
    `{"seq":${String(sample.seq)},"path":${JSON.stringify(sample.path)},"turn":${String(sample.turn)}}`)
  return lines.join('\n')
}

/** Parse the estimator answer; anything malformed yields no verdicts. */
export function parseEstimatorAnswer(text: string): EstimatorVerdict[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(parsed)) return []
    const verdicts: EstimatorVerdict[] = []
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as { seq?: unknown, expired?: unknown }
      if (typeof record.seq !== 'number' || typeof record.expired !== 'boolean') continue
      verdicts.push({ seq: record.seq, expired: record.expired })
    }
    return verdicts
  } catch {
    return []
  }
}

/** One channel-bound estimator. `ask` resolves undefined on any failure. */
export class Estimator {
  constructor(
    private readonly ctx: Context,
    private readonly options: PresetOptionsSettings,
  ) {}

  get enabled(): boolean {
    return this.options.estimatorMode === 'host' || this.options.estimatorMode === 'direct'
  }

  async ask(system: string, user: string, signal: AbortSignal): Promise<string | undefined> {
    const timeoutMs = this.options.estimatorTimeoutMs ?? 3_000
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal2 = typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : timeout
    try {
      if (this.options.estimatorMode === 'host') return await this.askHost(system, user, signal2)
      if (this.options.estimatorMode === 'direct') return await this.askDirect(system, user, signal2)
      return undefined
    } catch {
      return undefined
    }
  }

  private async askHost(system: string, user: string, signal: AbortSignal): Promise<string | undefined> {
    let llm: HostLlmLike | undefined
    try {
      llm = this.ctx.get('llm' as never) as HostLlmLike | undefined
    } catch {
      return undefined
    }
    if (llm?.stream === undefined) return undefined
    const provider = this.options.estimatorProvider ?? ''
    const model = this.options.estimatorModel ?? ''
    if (provider.length === 0 || model.length === 0) return undefined
    let text = ''
    const stream = llm.stream({
      provider,
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
      system,
      temperature: 0,
      reasoningEffort: 'off',
      maxTokens: 256,
      signal,
    })
    for await (const chunk of stream) {
      if ((chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') && typeof chunk.text === 'string') {
        text += chunk.text
      } else if (chunk.type === 'finish' && chunk.text === undefined) {
        break
      }
    }
    return text.trim().length > 0 ? text : undefined
  }

  private async askDirect(system: string, user: string, signal: AbortSignal): Promise<string | undefined> {
    const baseUrl = this.options.estimatorBaseUrl
    if (baseUrl === undefined || baseUrl.length === 0) return undefined
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.options.estimatorApiKey !== undefined && this.options.estimatorApiKey.length > 0) {
      headers.authorization = `Bearer ${this.options.estimatorApiKey}`
    }
    const model = this.options.estimatorModel ?? ''
    if (model.length === 0) return undefined
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: 256,
      }),
      signal,
    })
    if (!response.ok) return undefined
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const text = payload.choices?.[0]?.message?.content
    return typeof text === 'string' && text.trim().length > 0 ? text : undefined
  }
}
