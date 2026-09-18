/**
 * TokenPilot-inspired side channel (Phases 10–13).
 *
 * The S1 relevance filters (S1a search nodes, S1b document sections) ride the
 * SAME transports the estimator uses — `host` (the Harness `llm` service) or
 * `direct` (OpenAI-compatible HTTP) — with `maxTokens: 256`,
 * `temperature: 0`, `reasoningEffort: 'off'`. No second provider/model
 * configuration surface exists; failures are fail-open (`undefined`, never a
 * throw) and the mechanical fold is always the fallback.
 *
 * Layer rules: the side channel only changes SELECTION and ORDER; it never
 * rewrites content and never removes a node's existence (L1 locators and
 * section headings always survive). Every call is cost-gated: if everything
 * fits the budget the channel is not called at all.
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

/** Audit record of one side-channel call (Phase 13). All fields optional-safe. */
export interface SideChannelAudit {
  readonly ok: boolean
  readonly latencyMs: number
  /** host|direct plus the resolved provider/model identity. */
  readonly channel?: string
  /** L2 coverage: content shown N of node content total M. */
  readonly coverage?: { readonly shown: number, readonly total: number }
  readonly reason?: string
}

export interface SideChannelRequest {
  readonly system: string
  readonly user: string
  readonly signal: AbortSignal
}

/** One bound side channel. `ask` resolves `undefined` on ANY failure. */
export class SideChannel {
  constructor(
    private readonly ctx: Context,
    private readonly options: PresetOptionsSettings,
  ) {}

  get enabled(): boolean {
    return this.options.estimatorMode === 'host' || this.options.estimatorMode === 'direct'
  }

  async ask(request: SideChannelRequest): Promise<string | undefined> {
    const timeoutMs = this.options.estimatorTimeoutMs ?? 3_000
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any([request.signal, timeout]) : timeout
    try {
      if (this.options.estimatorMode === 'host') return await this.askHost(request.system, request.user, signal)
      if (this.options.estimatorMode === 'direct') return await this.askDirect(request.system, request.user, signal)
      return undefined
    } catch {
      return undefined
    }
  }

  /** Failure-open wrapper that also records one audit record per call. */
  async askAudited(request: SideChannelRequest): Promise<{ text?: string, audit: SideChannelAudit }> {
    const now = Date.now()
    const text = await this.ask(request)
    const audit: SideChannelAudit = {
      ok: text !== undefined,
      latencyMs: Date.now() - now,
      ...this.identity() !== undefined ? { channel: this.identity()! } : {},
      ...(text === undefined ? { reason: 'channel returned no content (timeout, non-2xx, parse failure, or reasoning ate the 256-token budget)' } : {}),
    }
    return { ...(text === undefined ? {} : { text }), audit }
  }

  identity(): string | undefined {
    if (this.options.estimatorMode === 'direct') {
      return `direct:${this.options.estimatorModel ?? ''}`
    }
    if (this.options.estimatorMode === 'host') {
      const route = this.resolveHostRoute()
      return route === undefined ? 'host' : `host:${route.provider}/${route.model}`
    }
    return undefined
  }

  /**
   * Host-route resolution matching this version line's estimator semantics:
   * an explicitly configured provider/model pair, nothing else.
   */
  private resolveHostRoute(): { provider: string, model: string } | undefined {
    const provider = this.options.estimatorProvider ?? ''
    const model = this.options.estimatorModel ?? ''
    if (provider.length > 0 && model.length > 0) return { provider, model }
    return undefined
  }

  private async askHost(system: string, user: string, signal: AbortSignal): Promise<string | undefined> {
    let llm: HostLlmLike | undefined
    try {
      llm = this.ctx.get('llm' as never) as HostLlmLike | undefined
    } catch {
      return undefined
    }
    if (llm?.stream === undefined) return undefined
    const route = this.resolveHostRoute()
    if (route === undefined) return undefined
    let text = ''
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
      system,
      temperature: 0,
      reasoningEffort: 'off',
      maxTokens: 256,
      signal,
    })
    for await (const chunk of stream) {
      // reasoningEffort 'off' is a request, not a guarantee: if reasoning still
      // eats the 256-token budget, `content` stays empty and the caller falls
      // back to the mechanical fold (text.trim() check below).
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
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

/**
 * Rank-then-cut (TS4): ONE call sorts and filters. The prompt carries the
 * query, the main LLM's reasoning summary (the intent lives there — AD11),
 * and per-node summaries with identifier + count + ONE content sample.
 */
export function buildRankSystemPrompt(kind: 'search' | 'document'): string {
  const what = kind === 'search' ? 'files' : 'document sections'
  return [
    'You rank session artifacts by relevance to an agent query.',
    `You are given numbered ${what} with a short sample each.`,
    `Answer with ONLY the identifiers of the ${what} that matter, most relevant first,`,
    'as a comma-separated list. Omit identifiers you consider irrelevant.',
    'Never invent identifiers; never add commentary.',
  ].join(' ')
}

export function parseRanking(text: string | undefined, validIds: ReadonlySet<string>): string[] | undefined {
  if (text === undefined || text.trim().length === 0) return undefined
  const ranked: string[] = []
  const seen = new Set<string>()
  for (const token of text.split(/[\s,;]+/)) {
    const id = token.replace(/[^\w./:#-]/gu, '')
    if (id.length === 0 || !validIds.has(id) || seen.has(id)) continue
    seen.add(id)
    ranked.push(id)
  }
  return ranked.length > 0 ? ranked : undefined
}

/** Nodes mentioned by the LM keep their rank; the rest are appended in order (SC-existence). */
export function mergeRanking<T extends { readonly id: string }>(nodes: readonly T[], ranking: readonly string[] | undefined): readonly T[] {
  if (ranking === undefined) return nodes
  const byId = new Map(nodes.map(node => [node.id, node]))
  const ordered: T[] = []
  for (const id of ranking) {
    const node = byId.get(id)
    if (node !== undefined) ordered.push(node)
  }
  for (const node of nodes) {
    if (!ordered.includes(node)) ordered.push(node)
  }
  return ordered
}

/** Cost gate (R-10): call only when something must be dropped and there is more than one node. */
export function sideChannelGate(fitsBudget: boolean, nodeCount: number): boolean {
  return !fitsBudget && nodeCount > 1
}

/** One node face offered to the rank prompt: id + count/mass + ONE content sample. */
export interface RankedNode { readonly id: string, readonly detail: string, readonly sample: string }

export function buildRankUserPrompt(
  nodes: readonly RankedNode[],
  query: string,
  reasoningSummary: string | undefined,
): string {
  const lines = [
    ...(query.trim().length > 0 ? [`query: ${query.trim().slice(0, 300)}`] : []),
    ...(reasoningSummary !== undefined && reasoningSummary.trim().length > 0
      ? [`reasoning: ${reasoningSummary.trim().slice(0, 300)}`] : []),
    ...nodes.map(node => `${node.id} | ${node.detail} | ${node.sample.replace(/\s+/gu, ' ')}`),
  ]
  return lines.join('\n')
}

export interface RankOutcome {
  /** Ranked ids the LM returned; `undefined` on any failure (fail-open). */
  readonly ranking?: readonly string[]
  readonly audit: SideChannelAudit
}

/**
 * S1 orchestrator: gate → ONE channel call → parse → merge. Every failure
 * path (gate closed, channel undefined, garbage answer) resolves with
 * `ranking: undefined`, which the mechanical fold reproduces byte-for-byte.
 */
export async function rankNodes(
  nodes: readonly RankedNode[],
  validIds: ReadonlySet<string>,
  query: string,
  reasoningSummary: string | undefined,
  channel: Pick<SideChannel, 'ask' | 'askAudited' | 'identity'>,
  signal: AbortSignal,
): Promise<RankOutcome> {
  if (nodes.length <= 1 || query.trim().length === 0) {
    return { audit: { ok: false, latencyMs: 0, reason: 'gate closed: single node or empty query' } }
  }
  const { text, audit } = await channel.askAudited({
    system: buildRankSystemPrompt('search'),
    user: buildRankUserPrompt(nodes, query, reasoningSummary),
    signal,
  })
  const ranking = parseRanking(text, validIds)
  return {
    ...(ranking === undefined ? {} : { ranking }),
    audit: ranking === undefined
      ? { ...audit, ok: false, reason: 'unparseable or empty ranking; falling back to the mechanical fold' }
      : audit,
  }
}
