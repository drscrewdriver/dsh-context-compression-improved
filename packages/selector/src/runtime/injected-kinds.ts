/**
 * Injected-source whitelist: identifies host-injected messages that must NOT
 * be treated as real user boundaries when determining turns, spans, or
 * working-set protection.
 *
 * Plan: cci-longterm-refactor v0.13.2 (F13 — live-compact #69 lesson)
 *
 * DSH host injects user/message events with a specific source.kind for
 * time-context, tool-jobs, skill-catalog, etc. These are NOT user turns and
 * must not affect span boundary decisions.
 *
 * @module dsh-context-compression-improved/runtime/injected-kinds
 */

/**
 * Source kinds that represent host-injected content, NOT real user messages.
 * Any event whose data.source.kind is in this set is an injection and must
 * be skipped by all boundary/turn detection logic.
 */
export const INJECTED_SOURCE_KINDS: ReadonlySet<string> = new Set([
  'time-context',
  'tool-jobs',
  'skill-catalog',
  'dsh-context-compression',
  'dsh-ops-ptc',
  'compaction-basic',
  'dsh-agent-presets',
])

/**
 * Determine whether an event represents a real user message (not injected).
 *
 * An event is a "real user boundary" if:
 * - type is 'user/message', AND
 * - its source.kind (if present) is NOT in INJECTED_SOURCE_KINDS
 *
 * Events without a source field are treated as real user messages
 * (backward-compatible with older hosts that don't tag sources).
 */
export function isRealUserBoundary(event: {
  type?: unknown
  data?: { source?: { kind?: unknown } }
}): boolean {
  if (event.type !== 'user/message') return false
  const kind = event.data?.source?.kind
  if (typeof kind !== 'string') return true // no source = real user (old host compat)
  return !INJECTED_SOURCE_KINDS.has(kind)
}

/**
 * Check if a message event is a plugin injection (non-user boundary).
 * Returns true for injected messages that should be skipped.
 */
export function isInjectedMessage(event: {
  type?: unknown
  data?: { source?: { kind?: unknown } }
}): boolean {
  if (event.type !== 'user/message') return false
  const kind = event.data?.source?.kind
  if (typeof kind !== 'string') return false // no source = not injected
  return INJECTED_SOURCE_KINDS.has(kind)
}
