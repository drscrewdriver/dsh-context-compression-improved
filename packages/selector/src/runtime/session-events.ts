/** Public Session event-log compatibility across Harness 0.1.x releases. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Read one immutable Session event snapshot.
 *
 * Harness rc.2 exposed `events`; Alpha 5 replaced it with the public
 * `snapshotEvents()` method. Prefer the new API when present and retain the
 * old accessor as the compatibility fallback for already-supported hosts.
 */
export function sessionEvents(session: Session): readonly SessionEvent[] {
  const snapshot = (session as unknown as {
    snapshotEvents?: () => readonly SessionEvent[]
  }).snapshotEvents
  if (typeof snapshot === 'function') return snapshot.call(session)
  return (session as unknown as { events?: readonly SessionEvent[] }).events ?? []
}

/**
 * Resolve one surface-node seq to its event. 0.1.5 surface nodes are
 * positional and may replace earlier ranges, so a node's seq is not
 * guaranteed to equal the snapshot array index: always resolve by seq.
 */
export function eventBySeq(
  events: readonly SessionEvent[],
  seq: number | bigint | { valueOf(): number },
): SessionEvent | undefined {
  return events[Number(seq)]
}
