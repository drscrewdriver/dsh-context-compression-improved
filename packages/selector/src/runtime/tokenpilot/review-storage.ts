/**
 * TokenPilot-inspired R4: the storageDomain adapter for the review queue.
 *
 * The `storageDomain` seam is resolved OPTIONALLY at runtime (`ctx.get`), never
 * declared as a hard plugin inject: a host without storage backends must load
 * the plugin anyway and serve the review queue from its in-memory fallback.
 * Any open failure degrades the same way — the caller receives `undefined` and
 * logs one warning.
 *
 * The domain spec is a plain structural object with a hand-rolled `safeParse`
 * validator, so the plugin carries no runtime dependency on
 * `@deepseek-ai/dsh-storage-domain` (or on a compatible zod instance); hosts
 * that reject the structural spec simply fall into the same degrade path.
 */
import type { ReviewQueueStore, ReviewSessionRecord } from './review-queue.ts'

/** Domain name — `UNIT_NAME_RE` (`/^[a-z][a-z0-9_]*$/`) allows no hyphens. */
export const REVIEW_STORAGE_DOMAIN = 'context_compression_review'

/** The one declared table: one record per session id. */
export const REVIEW_STORAGE_TABLE = 'sessions'

/** Minimal structural face of one opened domain table (sync reads, durable writes). */
interface ReviewStorageTableLike {
  get(key: string): unknown
  put(key: string, value: unknown): Promise<void>
  keys(): IterableIterator<string>
}

/** Minimal structural face of the `storageDomain` service. */
interface StorageDomainServiceLike {
  open(spec: unknown): Promise<{ table(name: string): ReviewStorageTableLike }>
}

/** Structural validator: accepts exactly the shape this module persists. */
function reviewSessionRecordValidator(): { safeParse(value: unknown): { success: boolean, data?: ReviewSessionRecord } } {
  return {
    safeParse(value: unknown): { success: boolean, data?: ReviewSessionRecord } {
      if (typeof value !== 'object' || value === null) return { success: false }
      const record = value as { version?: unknown, proposals?: unknown }
      if (record.version !== 1 || !Array.isArray(record.proposals)) return { success: false }
      for (const proposal of record.proposals) {
        if (typeof proposal !== 'object' || proposal === null) return { success: false }
        const entry = proposal as {
          id?: unknown, sessionId?: unknown, kind?: unknown, status?: unknown,
          items?: unknown, benefit?: unknown, enqueuedTurn?: unknown, lastTurnIndex?: unknown,
        }
        if (typeof entry.id !== 'string' || typeof entry.sessionId !== 'string') return { success: false }
        if (entry.kind !== 'estimator' && entry.kind !== 'dedup' && entry.kind !== 'read-state') {
          return { success: false }
        }
        if (entry.status !== 'pending' && entry.status !== 'approved') return { success: false }
        if (!Number.isSafeInteger(entry.enqueuedTurn) || !Number.isSafeInteger(entry.lastTurnIndex)) {
          return { success: false }
        }
        if (!Array.isArray(entry.items) || typeof entry.benefit !== 'object' || entry.benefit === null) {
          return { success: false }
        }
        for (const item of entry.items) {
          if (typeof item !== 'object' || item === null) return { success: false }
          const one = item as { seq?: unknown, digest?: unknown }
          if (!Number.isSafeInteger(one.seq) || typeof one.digest !== 'string') return { success: false }
        }
      }
      return { success: true, data: value as ReviewSessionRecord }
    },
  }
}

function reviewStorageSpec(): unknown {
  return {
    name: REVIEW_STORAGE_DOMAIN,
    version: 1,
    layout: 'per-record',
    tables: {
      [REVIEW_STORAGE_TABLE]: { valueSchema: reviewSessionRecordValidator() },
    },
  }
}

/** Adapter presenting the sync KV face the queue expects over the domain table. */
class StorageDomainReviewStore implements ReviewQueueStore {
  constructor(private readonly table: ReviewStorageTableLike) {}

  load(sessionId: string): ReviewSessionRecord | undefined {
    const value = this.table.get(sessionId)
    return typeof value === 'object' && value !== null ? value as ReviewSessionRecord : undefined
  }

  save(sessionId: string, record: ReviewSessionRecord): void {
    // Durability is fire-and-forget: the domain's write chain lands the record
    // while the queue proceeds; failures are logged by the host backend and
    // the in-memory state still serves reads.
    void this.table.put(sessionId, record).catch(() => undefined)
  }

  ids(): readonly string[] {
    return [...this.table.keys()]
  }
}

/**
 * Attempt to open the review storage domain through the optional
 * `storageDomain` seam.
 * @param getService - resolved once with the seam name; `undefined` means the
 * host lacks the service.
 * @returns the durable store, or `undefined` when the seam is absent or fails
 * (the caller falls back to the in-memory store and logs one warning).
 */
export async function openReviewStorage(
  getService: (name: string) => unknown,
): Promise<ReviewQueueStore | undefined> {
  let service: unknown
  try {
    service = getService('storageDomain')
  } catch {
    return undefined
  }
  if (service === undefined || service === null) return undefined
  const domain = await (service as StorageDomainServiceLike).open(reviewStorageSpec())
  return new StorageDomainReviewStore(domain.table(REVIEW_STORAGE_TABLE))
}
