/**
 * TokenPilot-inspired R4: the human-gated review queue.
 *
 * One durable session record per session holds every live proposal (pending or
 * approved). Records carry metadata only — ids, seqs, digests, token counts,
 * statuses, and reason codes — never message content, mirroring the upstream
 * Cleaner persistence rule. The store face is a minimal KV pair so the queue
 * is host-agnostic: the runtime wiring attempts the `storageDomain` seam and
 * degrades to an in-memory Map (restart-lossy, acceptable for a short-lived
 * pending queue) whenever the seam is absent or fails.
 *
 * The human-side status set is `pending / approved / rejected / ignored /
 * expired`, orthogonal to the execution-side receipt states
 * (`applied / deferred`) recorded when an approved batch actually lands.
 */
import type { ProposalKind, ProposalSkeleton } from './proposal.ts'

/** Human-side proposal status. */
export type ReviewProposalStatus = 'pending' | 'approved' | 'rejected' | 'ignored' | 'expired'

/** Execution-side receipt built only from real mutation evidence (never estimated). */
export interface ReviewReceipt {
  readonly status: 'applied' | 'deferred'
  /** Reason code for deferred receipts, aligned with the upstream naming. */
  readonly reasonCode?: string
  /** Predicted recovery from the benefit model at enqueue time. */
  readonly estimatedTokens: number
  /** Measured recovery of the landed mutation; present only on applied. */
  readonly appliedTokens?: number
  /** Canonical ISO timestamp of the execution evidence. */
  readonly updatedAt: string
}

/** One queued proposal: persisted metadata, never content. */
export interface ReviewProposalRecord {
  readonly id: string
  readonly sessionId: string
  readonly kind: ProposalKind
  readonly items: readonly {
    readonly seq: number
    readonly component: string
    readonly kind: ProposalKind
    readonly tokensBefore: number
    readonly tokensAfter: number
    readonly digest: string
  }[]
  readonly benefit: {
    readonly recoveredTokens: number
    readonly penaltyTokens: number
    readonly paybackTurns?: number
    readonly expectedSaving?: number
  }
  status: ReviewProposalStatus
  readonly enqueuedTurn: number
  lastTurnIndex: number
}

/** Whole-session record: one durable KV value per session. */
export interface ReviewSessionRecord {
  readonly version: 1
  readonly proposals: readonly ReviewProposalRecord[]
}

/** A settled proposal: the live record plus its execution receipt. */
export interface ReviewReceiptRecord extends ReviewProposalRecord {
  readonly receipt: ReviewReceipt
}

/** Minimal KV face the queue persists through. */
export interface ReviewQueueStore {
  load(sessionId: string): ReviewSessionRecord | undefined
  save(sessionId: string, record: ReviewSessionRecord): void
  /** Session ids with live records; optional (aggregate reads degrade to none). */
  ids?(): readonly string[]
}

/** In-memory store: the fail-open fallback when no durable seam is available. */
export class MemoryReviewStore implements ReviewQueueStore {
  private readonly sessions = new Map<string, ReviewSessionRecord>()

  load(sessionId: string): ReviewSessionRecord | undefined {
    return this.sessions.get(sessionId)
  }

  save(sessionId: string, record: ReviewSessionRecord): void {
    this.sessions.set(sessionId, record)
  }

  ids(): readonly string[] {
    return [...this.sessions.keys()]
  }
}

export interface ReviewQueueOptions {
  /** Pending proposals older than this many turns (since lastTurnIndex) expire. */
  readonly timeoutTurns: number
}

/** Decision outcomes for one decide call. */
export type DecideOutcome =
  | { readonly ok: true }
  | { readonly ok: false, readonly reason: 'unknown-proposal' | 'not-pending' }

export class ReviewQueue {
  constructor(
    private readonly store: ReviewQueueStore,
    private readonly options: ReviewQueueOptions,
  ) {}

  /**
   * Fail-open store access: a throwing seam must never break the compression
   * pipeline. Reads degrade to "no stored record"; writes degrade to losing
   * durability for that call (the store itself is expected to warn).
   */
  private safeLoad(sessionId: string): ReviewSessionRecord | undefined {
    try {
      return this.store.load(sessionId)
    } catch {
      return undefined
    }
  }

  private safeSave(sessionId: string, record: ReviewSessionRecord): void {
    try {
      this.store.save(sessionId, record)
    } catch {
      // Durability lost for this write; the queue stays functional in memory.
    }
  }

  private sessionRecord(sessionId: string): ReviewSessionRecord {
    return this.safeLoad(sessionId) ?? { version: 1, proposals: [] }
  }

  /**
   * Queue one classified proposal. A repeated classification of the same
   * content re-does nothing but refresh the patience clock, so re-enqueue
   * cannot duplicate a live proposal.
   * @returns `false` when an identical live proposal already exists.
   */
  enqueue(sessionId: string, skeleton: ProposalSkeleton, turnIndex: number): boolean {
    const record = this.sessionRecord(sessionId)
    const existing = record.proposals.find(entry => entry.id === skeleton.id)
    if (existing !== undefined && existing.status !== 'expired') {
      existing.lastTurnIndex = turnIndex
      this.safeSave(sessionId, record)
      return false
    }
    const proposal: ReviewProposalRecord = {
      id: skeleton.id,
      sessionId,
      kind: skeleton.kind,
      items: skeleton.items.map(item => ({ ...item })),
      benefit: { ...skeleton.benefit },
      status: 'pending',
      enqueuedTurn: turnIndex,
      lastTurnIndex: turnIndex,
    }
    this.safeSave(sessionId, {
      version: 1,
      // Expired duplicates are dropped: the fresh skeleton re-enters as pending.
      proposals: [...record.proposals.filter(entry => entry.id !== skeleton.id), proposal],
    })
    return true
  }

  /** Live pending proposals of one session, oldest enqueue first. */
  listPending(sessionId: string): readonly ReviewProposalRecord[] {
    return this.sessionRecord(sessionId).proposals
      .filter(entry => entry.status === 'pending')
      .sort((left, right) => left.enqueuedTurn - right.enqueuedTurn)
  }

  /** Approved proposals waiting for the next turn-boundary batch. */
  listApproved(sessionId: string): readonly ReviewProposalRecord[] {
    return this.sessionRecord(sessionId).proposals
      .filter(entry => entry.status === 'approved')
      .sort((left, right) => left.enqueuedTurn - right.enqueuedTurn)
  }

  /**
   * Transition one pending proposal. Idempotent: deciding an unknown id or a
   * non-pending proposal changes nothing and reports the miss.
   */
  decide(sessionId: string, id: string, decision: 'approved' | 'rejected' | 'ignored'): DecideOutcome {
    const record = this.sessionRecord(sessionId)
    const proposal = record.proposals.find(entry => entry.id === id)
    if (proposal === undefined) return { ok: false, reason: 'unknown-proposal' }
    if (proposal.status !== 'pending') return { ok: false, reason: 'not-pending' }
    proposal.status = decision
    this.safeSave(sessionId, record)
    return { ok: true }
  }

  /**
   * Expire every pending proposal whose patience has run out at this turn
   * boundary. Expired proposals are removed from the store (the summary view
   * aggregates them from the audit log instead).
   * @returns the expired proposals, for the caller's audit emission.
   */
  expireTurn(sessionId: string, turnIndex: number): readonly ReviewProposalRecord[] {
    const record = this.sessionRecord(sessionId)
    const keep: ReviewProposalRecord[] = []
    const expired: ReviewProposalRecord[] = []
    for (const proposal of record.proposals) {
      if (proposal.status === 'pending' && turnIndex - proposal.lastTurnIndex > this.options.timeoutTurns) {
        expired.push({ ...proposal, status: 'expired' })
        continue
      }
      keep.push(proposal)
    }
    if (expired.length > 0) this.safeSave(sessionId, { version: 1, proposals: keep })
    return expired
  }

  /**
   * Settle an approved proposal with its execution receipt and retire it from
   * the live store. The caller is responsible for auditing the receipt; the
   * queue only records which proposal left and why.
   */
  recordReceipt(sessionId: string, id: string, receipt: ReviewReceipt): ReviewReceiptRecord | undefined {
    const record = this.sessionRecord(sessionId)
    const proposal = record.proposals.find(entry => entry.id === id)
    if (proposal === undefined || proposal.status !== 'approved') return undefined
    this.safeSave(sessionId, {
      version: 1,
      proposals: record.proposals.filter(entry => entry.id !== id),
    })
    return { ...proposal, receipt }
  }
}
