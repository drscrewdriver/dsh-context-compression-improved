/**
 * Shallow-read tool surface (plan cci-sedimentation-triage, Phase 4.5).
 *
 * Registers the upgrade-discard primitives next to the existing retrieve tool:
 * - `context_compression_probe`   — O(1) header sample → recommended shallow view
 * - `context_compression_shallow` — the map: classified shallow view + checkpoint
 * - `context_compression_discard` — drops one side of a shallow/full pair,
 *   guarded so the MAP only dies under full coverage; the checkpoint line
 *   always survives (R11).
 *
 * The decision core is exported pure (`buildShallowView`, `parseReadCoverage`,
 * registry helpers) so the guard arithmetic is unit-testable without a host;
 * `installShallowTools` only adapts those to `defineTool`.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionSeq as SessionSeqBrand } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PTC_BINDING_NOTE, RUNTIME_TOOL_NAMES } from './tool-names.ts'
import {
  buildShallowFooter,
  classifyShallowSample,
  evaluateDiscardGuard,
  normalizeToolPath,
  renderCheckpointLine,
  shallowFingerprint,
  type ReadPairSide,
} from './triage/shallow.ts'
import { skeletonFromRead } from './triage/masks.ts'
import { sessionEvents } from './session-events.ts'
import { getSavingsLedger } from './savings.ts'
import { tailTrimMessage } from './tail-trim.ts'
import type { ShallowCheckpoint } from './triage/types.ts'

const PROBE_SAMPLE_BYTES = 2_048
const SHALLOW_MAX_BYTES = 2_000_000
const REF_PATTERN = /^session:\/\/([^/]+)\/event\/(\d+)$/

/** Live shallow maps per session, keyed by normalized path. */
export interface ShallowEntry {
  readonly seq: number
  readonly checkpoint: ShallowCheckpoint
  readonly bodyTokens: number
  discarded: boolean
}

const registry = new WeakMap<object, Map<string, ShallowEntry>>()

export function shallowRegistryFor(session: object): Map<string, ShallowEntry> {
  let map = registry.get(session)
  if (map === undefined) {
    map = new Map()
    registry.set(session, map)
  }
  return map
}

/** The live (undiscarded) map for a path, if any — footer pairing source. */
export function liveShallowFor(session: object, rawPath: string): ShallowEntry | undefined {
  const entry = shallowRegistryFor(session).get(normalizeToolPath(rawPath))
  return entry !== undefined && !entry.discarded ? entry : undefined
}

/** Pure view builder shared by the shallow tool and tests. */
export function buildShallowView(
  text: string,
  method: ReturnType<typeof classifyShallowSample>['method'],
  rawPath: string,
  seq: number,
): { readonly body: string; readonly checkpoint: ShallowCheckpoint | null } {
  const lines = text.replace(/\n+$/, '').split('\n')
  const checkpointBase = {
    path: normalizeToolPath(rawPath),
    coverage: `${lines.length} lines`,
    ref: `event/${seq}`,
    fingerprint: shallowFingerprint(text),
  }
  if (method === 'code-skeleton') {
    const verdict = skeletonFromRead(text, seq, rawPath)
    if (verdict !== null && verdict.kind === 'skeleton') {
      const body = `${verdict.lines.join('\n')}\n[… body elided: ${verdict.totalLines - verdict.lines.length} lines / ${verdict.elidedChars} chars]`
      return { body, checkpoint: verdict.checkpoint ?? { ...checkpointBase } }
    }
    // zero-hit code: honest head/tail instead of an empty skeleton
    return headTailView(lines, checkpointBase)
  }
  if (method === 'json-skeleton') {
    try {
      const parsed: unknown = JSON.parse(text)
      const keys: string[] = []
      collectJsonKeys(parsed, '', keys, 40)
      if (keys.length === 0) return headTailView(lines, checkpointBase)
      return { body: `${keys.join('\n')}\n[… ${lines.length} lines of JSON values elided]`, checkpoint: { ...checkpointBase } }
    } catch {
      return headTailView(lines, checkpointBase)
    }
  }
  if (method === 'csv-header') {
    const header = lines.slice(0, 3).join('\n')
    return { body: `${header}\n[… ${Math.max(0, lines.length - 3)} data rows elided]`, checkpoint: { ...checkpointBase } }
  }
  if (method === 'toc-lines') {
    const headings = lines.filter(line => /^#{1,6} |^\s*\*\*\w/.test(line)).slice(0, 60)
    if (headings.length === 0) return headTailView(lines, checkpointBase)
    return { body: `${headings.join('\n')}\n[… ${lines.length} lines under the outline elided]`, checkpoint: { ...checkpointBase } }
  }
  return headTailView(lines, checkpointBase)
}

function headTailView(
  lines: string[],
  base: ShallowCheckpoint,
): { body: string; checkpoint: ShallowCheckpoint } {
  const head = lines.slice(0, 20)
  const tail = lines.slice(-10)
  const middle = Math.max(0, lines.length - head.length - tail.length)
  return {
    body: [...head, ...(middle > 0 ? [`[… ${middle} lines elided]`] : []), ...tail].join('\n'),
    checkpoint: base,
  }
}

function collectJsonKeys(node: unknown, prefix: string, out: string[], cap: number): void {
  if (out.length >= cap) return
  if (Array.isArray(node)) {
    out.push(`${prefix}[] (${node.length})`)
    if (node.length > 0) collectJsonKeys(node[0], `${prefix}[]`, out, cap)
    return
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (out.length >= cap) return
      const at = `${prefix}.${key}`.replace(/^\./, '')
      if (value !== null && typeof value === 'object') collectJsonKeys(value, at, out, cap)
      else out.push(at)
    }
  }
}

/** Coverage of a host `read` call from its arguments JSON (pairing input). */
export function parseReadCoverage(argsJson: string): ReadPairSide['coverage'] {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>
  } catch {
    return { kind: 'slice', from: 1, to: 0 } // matches nothing
  }
  const offset = typeof args.offset === 'number' && Number.isSafeInteger(args.offset) ? Math.max(0, args.offset) : 0
  const limit = typeof args.limit === 'number' && Number.isSafeInteger(args.limit) ? args.limit : undefined
  if (limit === undefined && offset === 0) return { kind: 'full' }
  const from = offset + 1
  const to = limit === undefined ? Number.MAX_SAFE_INTEGER : offset + limit
  return { kind: 'slice', from, to }
}

/**
 * Register probe/shallow/discard. Reachability and the pairing registry are
 * in-process truth; every tool call stays inside the caller's own session.
 */
export function installShallowTools(ctx: Context): void {
  const OUTPUT = {
    schema: { type: 'string' as const },
    render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
  }

  ctx.systemPrompt.section({
    name: 'tool:context-compression-shallow',
    order: 115,
    text: `Before reading a large unknown file, call ${RUNTIME_TOOL_NAMES.PROBE} with its path to pick the right shallow view, then ${RUNTIME_TOOL_NAMES.SHALLOW} to get the map (declaration/outline/keys + checkpoint line) instead of the full body. `
      + `After a full read supersedes a live map, or a map's body is no longer needed, ${RUNTIME_TOOL_NAMES.DISCARD} frees it — the checkpoint line always remains and ${RUNTIME_TOOL_NAMES.RETRIEVE} can still recover the body. `
      + 'Never reconstitute discarded output from memory or guesswork; use the ref. '
      + PTC_BINDING_NOTE,
  })

  ctx.tools.register(defineTool({
    name: RUNTIME_TOOL_NAMES.PROBE,
    description: `Read at most the first ${PROBE_SAMPLE_BYTES} bytes of a file and return the recommended shallow view method with reasons. ${PTC_BINDING_NOTE}`,
    parameters: {
      path: { type: 'string', required: true, description: 'File path to probe.' },
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const handle = await fs.open(args.path, 'r')
      try {
        const buffer = Buffer.alloc(PROBE_SAMPLE_BYTES)
        const { bytesRead } = await handle.read(buffer, 0, PROBE_SAMPLE_BYTES, 0)
        const stat = await handle.stat()
        const verdict = classifyShallowSample(
          buffer.subarray(0, bytesRead).toString('utf8'),
          path.extname(args.path),
          stat.size,
        )
        return `${verdict.method} | ${verdict.reason} | size ${stat.size} B`
      } finally {
        await handle.close()
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: RUNTIME_TOOL_NAMES.SHALLOW,
    description: 'Return a shallow view (declaration skeleton / JSON keys / outline / csv header + head/tail) of a file plus its permanent checkpoint line. Cheaper than a full read; pairs with discard and retrieve. ' + PTC_BINDING_NOTE,
    parameters: {
      path: { type: 'string', required: true, description: 'File path to view shallowly.' },
      method: { type: 'string', description: `Override the classified view: json-skeleton | code-skeleton | csv-header | toc-lines | head-tail.` },
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error(`${RUNTIME_TOOL_NAMES.SHALLOW} requires an agent session`)
      const stat = await fs.stat(args.path)
      if (stat.size > SHALLOW_MAX_BYTES) {
        throw new Error(`${RUNTIME_TOOL_NAMES.SHALLOW}: file is ${stat.size} B, above the ${SHALLOW_MAX_BYTES} B shallow cap; read slices instead`)
      }
      const text = await fs.readFile(args.path, 'utf8')
      const method = (args.method ?? classifyShallowSample(
        text.slice(0, PROBE_SAMPLE_BYTES), path.extname(args.path), stat.size,
      ).method) as ReturnType<typeof classifyShallowSample>['method']
      const events = sessionEvents(exec.agent.session as never)
      const seq = events.length
      const { body, checkpoint } = buildShallowView(text, method, args.path, seq)
      if (checkpoint !== null) {
        shallowRegistryFor(exec.agent.session).set(checkpoint.path, {
          seq,
          checkpoint,
          bodyTokens: Math.ceil((body.length + checkpoint.path.length) / 4),
          discarded: false,
        })
        return `${body}\n\n${renderCheckpointLine(checkpoint)}`
      }
      return body
    },
  }))

  ctx.tools.register(defineTool({
    name: RUNTIME_TOOL_NAMES.DISCARD,
    description: 'Free one side of a shallow/full read pair from the context: the live shallow map (only when a covering full read spans it) or a full read whose map suffices. The checkpoint line always remains; retrieve can recover bodies by ref. ' + PTC_BINDING_NOTE,
    parameters: {
      ref: { type: 'string', required: true, description: 'session://<current-session-id>/event/<seq> of the shallow map to discard.' },
      covering_ref: { type: 'string', description: 'event ref of the full read that supersedes the map (required to discard the map).' },
    },
    output: OUTPUT,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error(`${RUNTIME_TOOL_NAMES.DISCARD} requires an agent session`)
      const session = exec.agent.session
      const match = REF_PATTERN.exec(args.ref)
      if (match === null || match[1] !== String(session.id)) {
        throw new Error(`${RUNTIME_TOOL_NAMES.DISCARD}: ref must be session://<current-session-id>/event/<seq>`)
      }
      const targetSeq = Number(match[2])
      const registryMap = shallowRegistryFor(session)
      const entry = [...registryMap.values()].find(candidate => candidate.seq === targetSeq)
      if (entry === undefined) {
        throw new Error(`${RUNTIME_TOOL_NAMES.DISCARD}: ${args.ref} is not a live shallow map of this session (only ${RUNTIME_TOOL_NAMES.SHALLOW} results are discardable here)`)
      }
      if (entry.discarded) return `${renderCheckpointLine(entry.checkpoint)} (already discarded)`
      const coveringRef = args.covering_ref
      if (coveringRef === undefined) {
        throw new Error(`${RUNTIME_TOOL_NAMES.DISCARD}: discarding the map requires covering_ref of the full read that supersedes it`)
      }
      const coveringMatch = REF_PATTERN.exec(coveringRef)
      if (coveringMatch === null || coveringMatch[1] !== String(session.id)) {
        throw new Error(`${RUNTIME_TOOL_NAMES.DISCARD}: covering_ref must be in the current session`)
      }
      const events = sessionEvents(session as never) as unknown as ReadonlyArray<Record<string, unknown>>
      const coveringEvent = events[Number(coveringMatch[2])]
      if (coveringEvent?.type !== 'tool/result') {
        throw new Error(`${RUNTIME_TOOL_NAMES.DISCARD}: covering_ref does not cite a tool/result`)
      }
      const coveringMessage = (coveringEvent.data as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined
      const coveringArgs = typeof coveringMessage?.toolCallId === 'string'
        ? findCallArgs(events, coveringMessage.toolCallId)
        : undefined
      const covering: ReadPairSide = {
        seq: Number(coveringMatch[2]),
        path: coveringArgs?.path ?? '',
        coverage: coveringArgs === undefined
          ? { kind: 'slice', from: 1, to: 0 }
          : parseReadCoverage(coveringArgs.argsJson),
      }
      const mapSide: ReadPairSide = {
        seq: entry.seq,
        path: entry.checkpoint.path,
        coverage: { kind: 'full' }, // a map stands for the whole file outline
      }
      const guard = evaluateDiscardGuard({ map: mapSide, covering })
      if (!guard.allowed) {
        throw new Error(`${RUNTIME_TOOL_NAMES.DISCARD}: refused (${guard.reason}) — the map covers the whole file and the cited read does not supersede it`)
      }
      const message = tailTrimMessage(renderCheckpointLine(entry.checkpoint))
      session.append('user/message', message as never, {
        surfaceOp: { op: 'replace', startSeq: entry.seq as SessionSeqBrand, endSeq: entry.seq as SessionSeqBrand },
        sourceEventSeqs: [entry.seq as SessionSeqBrand],
      })
      entry.discarded = true
      // 记账隔离（T4.9）：模型发起的弃对节省单列 component，不与插件发起压缩混算。
      getSavingsLedger().recordSaving({
        sessionId: String(session.id),
        component: 'shallow-discard',
        tokensBefore: entry.bodyTokens,
        tokensAfter: Math.ceil(renderCheckpointLine(entry.checkpoint).length / 4),
        basis: 'characters',
        sourceSeq: entry.seq,
        replacementSeq: entry.seq,
        originalText: `${entry.checkpoint.path} shallow body`,
      })
      return buildShallowFooter(entry.checkpoint, 0) + `\n[discarded] ${renderCheckpointLine(entry.checkpoint)}`
    },
  }))
}

/** Find the arguments JSON + file path of the call owning a tool/result. */
function findCallArgs(
  events: ReadonlyArray<Record<string, unknown>>,
  callId: string,
): { path: string; argsJson: string } | undefined {
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const message = (event.data as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined
    const blocks = Array.isArray(message?.content) ? message.content : []
    for (const raw of blocks) {
      const block = raw as Record<string, unknown> | null
      if (block !== null && block.type === 'tool-call' && block.id === callId) {
        const argsJson = typeof block.arguments === 'string'
          ? block.arguments
          : JSON.stringify(block.arguments ?? {})
        let filePath: string
        try {
          const parsed = JSON.parse(argsJson) as Record<string, unknown>
          filePath = typeof parsed.file_path === 'string' ? parsed.file_path : typeof parsed.path === 'string' ? parsed.path : ''
        } catch {
          filePath = ''
        }
        return { path: filePath, argsJson }
      }
    }
  }
  return undefined
}
