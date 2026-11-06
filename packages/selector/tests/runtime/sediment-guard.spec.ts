/**
 * T3.10/T3.11 red tests: PTC downgrade guard (plan cci-sedimentation-triage).
 */
import { describe, expect, it } from 'vitest'
import {
  FeedbackLoop,
  detectPtcMode,
  effectiveSedimentMode,
  readStateBlind,
} from '../../src/runtime/sediment-guard.ts'
import { DEFAULT_SEDIMENT_SETTINGS } from '../../src/runtime/config.ts'

describe('detectPtcMode (registration truth, T3.10)', () => {
  it('recognizes both omnibus names', () => {
    expect(detectPtcMode(name => name === 'run_code')).toBe(true)
    expect(detectPtcMode(name => name === 'code_run')).toBe(true)
    expect(detectPtcMode(() => false)).toBe(false)
  })
})

describe('readStateBlind (WRITE_TOOLS blindness probe)', () => {
  it('blind only in PTC with observed calls and zero regex hits', () => {
    expect(readStateBlind(true, 0, 40)).toBe(true)
    expect(readStateBlind(true, 3, 40)).toBe(false)
    expect(readStateBlind(true, 0, 0)).toBe(false) // nothing observed yet
    expect(readStateBlind(false, 0, 40)).toBe(false) // non-PTC keeps aging
  })
})

describe('FeedbackLoop (T3.11, K=5 boundary shape)', () => {
  it('arms after K consecutive negative nets, disarms on positive immediately', () => {
    const loop = new FeedbackLoop(5)
    for (let index = 0; index < 4; index += 1) {
      expect(loop.observe({ grossSaved: 100, recallOffset: 300 }).conservative).toBe(false)
    }
    expect(loop.observe({ grossSaved: 100, recallOffset: 300 }).conservative).toBe(true)
    expect(loop.observe({ grossSaved: 500, recallOffset: 100 }).conservative).toBe(false)
  })
  it('zero net neither arms nor disarms the streak', () => {
    const loop = new FeedbackLoop(2)
    loop.observe({ grossSaved: 100, recallOffset: 150 })
    loop.observe({ grossSaved: 0, recallOffset: 0 })
    expect(loop.observe({ grossSaved: 100, recallOffset: 150 }).conservative).toBe(true)
  })
})

describe('effectiveSedimentMode (composition)', () => {
  const ON = { ...DEFAULT_SEDIMENT_SETTINGS, enabled: true }
  const ok = { conservative: false, reason: 'ok' }

  it('disabled settings short-circuit everything', () => {
    expect(effectiveSedimentMode({ ...ON, enabled: false }, true, true, ok).enabled).toBe(false)
  })
  it('PTC + blind read-state turns aging off and tightens the guard', () => {
    const mode = effectiveSedimentMode(ON, true, true, ok)
    expect(mode.agingAllowed).toBe(false)
    expect(mode.rewriteGuardRatio).toBeGreaterThanOrEqual(5)
    expect(mode.reason).toBe('ptc-blind-aging-off')
  })
  it('feedback conservative dominates even in non-PTC sessions', () => {
    const mode = effectiveSedimentMode(ON, false, false, { conservative: true, reason: 'net-negative-x5' })
    expect(mode.agingAllowed).toBe(false)
    expect(mode.reason).toContain('conservative')
  })
  it('normal session keeps aging allowed and the configured ratio', () => {
    const mode = effectiveSedimentMode(ON, false, false, ok)
    expect(mode.agingAllowed).toBe(true)
    expect(mode.rewriteGuardRatio).toBe(ON.rewriteGuardRatio)
    expect(mode.reason).toBe('normal')
  })
})
