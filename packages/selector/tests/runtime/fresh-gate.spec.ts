import { describe, expect, it } from 'vitest'
import { freshBelowTrigger } from '../../src/pruner.ts'
import { charsForTokens } from '../../src/runtime/config.ts'
import type { SnapshotCandidate } from '../../src/pruner/types.ts'
import type { CompressionPolicy } from '../../src/runtime/types.ts'

const TRIGGER = 4_096
const policy = { freshTriggerTokens: TRIGGER } as unknown as CompressionPolicy

const exact = (tokens: number, characterPressure: number): SnapshotCandidate =>
  ({ count: { kind: 'exact-tokenizer', tokens }, characterPressure }) as unknown as SnapshotCandidate
const unavailable = (characterPressure: number): SnapshotCandidate =>
  ({ count: { kind: 'unavailable', reason: 'no tokenizer' }, characterPressure }) as unknown as SnapshotCandidate
const estimate = (characterPressure: number): SnapshotCandidate =>
  ({ count: { kind: 'tokenizer-estimate', tokens: 999_999 }, characterPressure }) as unknown as SnapshotCandidate

describe('freshBelowTrigger (real-token fresh gate with char fallback)', () => {
  it('exact tokenizer: triggers on CJK where the 4.0 char estimate would NOT', () => {
    // 8,000 chars is below charsForTokens(4096)=16,384, but 5,000 real tokens
    // is above the 4,096 trigger → must trigger (return false = not below).
    expect(charsForTokens(TRIGGER)).toBe(16_384)
    expect(freshBelowTrigger(exact(5_000, 8_000), policy)).toBe(false)
  })

  it('exact tokenizer: below trigger when real tokens do not exceed it', () => {
    expect(freshBelowTrigger(exact(3_000, 20_000), policy)).toBe(true)
    expect(freshBelowTrigger(exact(TRIGGER, 20_000), policy)).toBe(true) // boundary: <= is below
  })

  it('unavailable (local Qwen): falls back to the char basis, byte-for-byte old behavior', () => {
    for (const chars of [10_000, 16_384, 20_000, 40_000]) {
      expect(freshBelowTrigger(unavailable(chars), policy)).toBe(chars <= charsForTokens(TRIGGER))
    }
    expect(freshBelowTrigger(unavailable(20_000), policy)).toBe(false) // > 16,384 → triggers
    expect(freshBelowTrigger(unavailable(10_000), policy)).toBe(true) // <= 16,384 → skipped
  })

  it('tokenizer-estimate is NOT treated as exact; uses the char fallback', () => {
    // tokens field is huge but kind !== 'exact-tokenizer', so the char basis decides.
    expect(freshBelowTrigger(estimate(10_000), policy)).toBe(true)
    expect(freshBelowTrigger(estimate(20_000), policy)).toBe(false)
  })
})
