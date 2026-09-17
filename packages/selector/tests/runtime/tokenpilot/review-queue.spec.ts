import { describe, expect, it } from 'vitest'
import {
  MemoryReviewStore,
  ReviewQueue,
  type ReviewQueueStore,
} from '../../../src/runtime/tokenpilot/review-queue.ts'
import type { ProposalSkeleton } from '../../../src/runtime/tokenpilot/proposal.ts'

const ITEM = {
  seq: 7,
  component: 'history',
  kind: 'read-state',
  tokensBefore: 1400,
  tokensAfter: 1000,
  digest: 'ab'.repeat(32),
} as const

function skeleton(overrides: Partial<ProposalSkeleton> = {}): ProposalSkeleton {
  return {
    id: overrides.id ?? 'proposal00001',
    kind: overrides.kind ?? 'read-state',
    items: overrides.items ?? [ITEM],
    benefit: overrides.benefit ?? {
      recoveredTokens: 400,
      penaltyTokens: 900,
      paybackTurns: 2.25,
    },
  }
}

/** Failing store: every seam failure degrades to memory, never throws. */

function makeQueue(timeoutTurns = 6, store: ReviewQueueStore = new MemoryReviewStore()): ReviewQueue {
  return new ReviewQueue(store, { timeoutTurns })
}

describe('review queue', () => {
  it('moves a proposal through enqueue → pending → approved', () => {
    const queue = makeQueue()
    expect(queue.enqueue('s1', skeleton(), 3)).toBe(true)
    expect(queue.listPending('s1')).toHaveLength(1)
    expect(queue.listPending('s1')[0]!.items[0]!.digest).toBe(ITEM.digest)
    expect(queue.decide('s1', 'proposal00001', 'approved')).toEqual({ ok: true })
    expect(queue.listPending('s1')).toHaveLength(0)
    expect(queue.listApproved('s1')).toHaveLength(1)
  })

  it('supports every decision and keeps sessions isolated', () => {
    const queue = makeQueue()
    queue.enqueue('s1', skeleton({ id: 'p-rejected000' }), 1)
    queue.enqueue('s2', skeleton({ id: 'p-ignored0000' }), 1)
    expect(queue.decide('s1', 'p-rejected000', 'rejected')).toEqual({ ok: true })
    expect(queue.decide('s2', 'p-ignored0000', 'ignored')).toEqual({ ok: true })
    expect(queue.listPending('s1')).toHaveLength(0)
    expect(queue.listPending('s2')).toHaveLength(0)
    expect(queue.listApproved('s1')).toHaveLength(0)
  })

  it('re-enqueue of identical content refreshes patience without duplicating', () => {
    const queue = makeQueue()
    expect(queue.enqueue('s1', skeleton(), 2)).toBe(true)
    expect(queue.enqueue('s1', skeleton(), 5)).toBe(false)
    const pending = queue.listPending('s1')
    expect(pending).toHaveLength(1)
    // Patience clock restarted at the re-enqueue turn.
    expect(pending[0]!.lastTurnIndex).toBe(5)
    expect(pending[0]!.enqueuedTurn).toBe(2)
  })

  it('decide is idempotent and reports unknown or already-decided ids', () => {
    const queue = makeQueue()
    queue.enqueue('s1', skeleton(), 1)
    expect(queue.decide('s1', 'proposal00001', 'approved')).toEqual({ ok: true })
    expect(queue.decide('s1', 'proposal00001', 'approved')).toEqual({ ok: false, reason: 'not-pending' })
    expect(queue.decide('s1', 'missing-proposal', 'rejected')).toEqual({ ok: false, reason: 'unknown-proposal' })
    expect(queue.listApproved('s1')).toHaveLength(1)
  })

  it('expires only pending proposals past the timeout window at the turn boundary', () => {
    const queue = makeQueue(6)
    queue.enqueue('s1', skeleton({ id: 'p-pending-old0' }), 1)
    queue.enqueue('s1', skeleton({ id: 'p-pending-new0' }), 9)
    queue.enqueue('s1', skeleton({ id: 'p-approved-00' }), 1)
    queue.decide('s1', 'p-approved-00', 'approved')
    // Turn 8: the turn-1 pending proposal is 7 turns stale (> 6) → expired;
    // the approved one never expires and the turn-9 one is still fresh.
    const expired = queue.expireTurn('s1', 8)
    expect(expired.map(entry => entry.id)).toEqual(['p-pending-old0'])
    expect(expired[0]!.status).toBe('expired')
    expect(queue.listPending('s1').map(entry => entry.id)).toEqual(['p-pending-new0'])
    expect(queue.listApproved('s1').map(entry => entry.id)).toEqual(['p-approved-00'])
  })

  it('keeps proposals exactly at the timeout boundary', () => {
    const queue = makeQueue(6)
    queue.enqueue('s1', skeleton(), 1)
    // 6 - 1 = 5 ≤ 6 → still pending.
    expect(queue.expireTurn('s1', 6)).toHaveLength(0)
    expect(queue.listPending('s1')).toHaveLength(1)
    // 7 - 1 = 6 ≤ 6 → still pending.
    expect(queue.expireTurn('s1', 7)).toHaveLength(0)
    // 8 - 1 = 7 > 6 → expired.
    expect(queue.expireTurn('s1', 8)).toHaveLength(1)
  })

  it('retires approved proposals with their receipt exactly once', () => {
    const queue = makeQueue()
    queue.enqueue('s1', skeleton({ id: 'p-apply-me000' }), 1)
    queue.decide('s1', 'p-apply-me000', 'approved')
    const settled = queue.recordReceipt('s1', 'p-apply-me000', {
      status: 'applied',
      estimatedTokens: 400,
      appliedTokens: 380,
      updatedAt: '2026-09-18T00:00:00.000Z',
    })
    expect(settled).toBeDefined()
    expect(settled!.receipt.appliedTokens).toBe(380)
    expect(settled!.items).toHaveLength(1)
    // Retired: a second receipt for the same id misses.
    expect(queue.recordReceipt('s1', 'p-apply-me000', {
      status: 'applied',
      estimatedTokens: 400,
      updatedAt: '2026-09-18T00:00:01.000Z',
    })).toBeUndefined()
    expect(queue.listApproved('s1')).toHaveLength(0)
  })

  it('refuses a receipt for a proposal that is not approved', () => {
    const queue = makeQueue()
    queue.enqueue('s1', skeleton(), 1)
    expect(queue.recordReceipt('s1', 'proposal00001', {
      status: 'applied',
      estimatedTokens: 400,
      updatedAt: '2026-09-18T00:00:00.000Z',
    })).toBeUndefined()
  })

  it('never throws when the store seam fails (fail-open degrade)', () => {
    // When the storageDomain seam is unavailable the wiring layer may hand the
    // queue a store whose calls throw; the queue must degrade to no-durability
    // behavior without ever breaking the compression pipeline.
    const throwing: ReviewQueueStore = {
      load: () => { throw new Error('seam unavailable') },
      save: () => { throw new Error('seam unavailable') },
    }
    const queue = new ReviewQueue(throwing, { timeoutTurns: 6 })
    expect(queue.enqueue('s1', skeleton(), 1)).toBe(true)
    expect(queue.listPending('s1')).toEqual([])
    expect(queue.expireTurn('s1', 3)).toEqual([])
    expect(queue.decide('s1', 'proposal00001', 'approved')).toEqual({ ok: false, reason: 'unknown-proposal' })
    expect(queue.recordReceipt('s1', 'proposal00001', {
      status: 'deferred',
      reasonCode: 'review_receipt_digest_invalid',
      estimatedTokens: 400,
      updatedAt: '2026-09-18T00:00:00.000Z',
    })).toBeUndefined()
  })

  it('persists across calls through the store (memory store roundtrip)', () => {
    const shared = new MemoryReviewStore()
    const writer = makeQueue(6, shared)
    const reader = makeQueue(6, shared)
    writer.enqueue('s1', skeleton(), 1)
    expect(reader.listPending('s1')).toHaveLength(1)
    reader.decide('s1', 'proposal00001', 'approved')
    expect(writer.listApproved('s1')).toHaveLength(1)
  })
})
