/**
 * Pure session-scanning functions extracted from ToolResultPruner.
 *
 * Every function here has ZERO `this` dependency — they receive all inputs
 * as explicit arguments and only read session events.
 *
 * @module dsh-context-compression-improved/pruner/session
 */

import type { Session } from '@deepseek-ai/dsh-session'
import { sessionEvents } from '../runtime/session-events.ts'
import { deepSeekV4TokenizerForModel } from '../deepseek-v4-tokenizer.ts'
import type { SnapshotCandidate, PlannedReplacement, HistoryPlanOutcome } from './types.ts'

/** Check whether the session currently has an open (unterminated) turn. */
function hasOpenTurn(session: Session): boolean {
  let open = false
  for (const event of sessionEvents(session)) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return open
}

/** Walk the tool-result source chain to find the root result seq. */
function rootToolResultSeq(session: Session, seq: number): number {
  const events = sessionEvents(session)
  let current = seq
  const seen = new Set<number>()
  while (!seen.has(current)) {
    seen.add(current)
    const event = events[current]
    if (event?.type !== 'tool/result' || typeof event.surfaceOp !== 'object') return current
    const previous = event.sourceEventSeqs?.[0]
    if (previous === undefined) return current
    current = previous
  }
  return seq
}

/** Build a session:// event reference string for a given seq. */
function sourceRef(session: Session, seq: number): string {
  return `session://${session.id}/event/${String(seq)}`
}

/** Find the latest completed step number for a given turn. */
function latestCompletedToolStep(session: Session, turn: number): number | undefined {
  let latest: number | undefined
  for (const event of sessionEvents(session)) {
    if (event.type === 'step/end' && event.data.turn === turn) latest = event.data.step
  }
  return latest
}

/** Routed provider/model when the durable request header names one route. */
function routeAuditFact(session: Session): { provider: string, model: string } | undefined {
  const header = session.requestHeader()?.config
  if (header === undefined || header.provider.length === 0 || header.model.length === 0) return undefined
  return { provider: header.provider, model: header.model }
}

/** Bundled tokenizer identity for one route, when the route is eligible. */
function tokenizerAuditFact(route: { provider: string, model: string }): { tokenizer: { repository: string, revision: string } } {
  // Reuse the measurement eligibility boundary: a DeepSeek model id routed
  // through another provider never used the bundled tokenizer.
  const eligible = route.provider === 'deepseek' || route.provider === 'deepseek-official'
  const identity = eligible ? deepSeekV4TokenizerForModel(route.model)?.countText('') : undefined
  if (identity?.kind === 'exact-tokenizer') {
    return { tokenizer: { repository: identity.tokenizerId, revision: identity.tokenizerRevision } }
  }
  return { tokenizer: { repository: 'unavailable', revision: 'unavailable' } }
}

/** Check whether a snapshot candidate represents an error result. */
function isError(candidate: SnapshotCandidate): boolean {
  // 0.1.7-rc.2: tool results are first-class `tool`-role messages — `isError`
  // moved from the result block onto the message itself.
  const message = candidate.event.data.message as { isError?: boolean }
  return message.isError === true || candidate.event.data.error !== undefined
}

/** Wrap a plan list into a HistoryPlanOutcome. */
function historyOutcome(plans: readonly PlannedReplacement[]): HistoryPlanOutcome {
  return { kind: 'planned', plans: [...plans] }
}

export {
  hasOpenTurn,
  rootToolResultSeq,
  sourceRef,
  latestCompletedToolStep,
  routeAuditFact,
  tokenizerAuditFact,
  isError,
  historyOutcome,
}
