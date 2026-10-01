import { describe, expect, it } from 'vitest'
import {
  INTENT_GATE_FLOOR_FRACTION,
  INTENT_GATE_GROWTH_TOKENS,
  evaluateIntentGate,
  shouldRunIntentFold,
} from '../../src/runtime/tokenpilot/intent-gate.ts'

const BASE = {
  enabled: true,
  override: undefined,
  liveTokens: 100_000,
  contextWindow: 200_000,
  baselineTokens: 0,
} as const

describe('intent growth gate', () => {
  it('passes when every condition holds strictly', () => {
    expect(shouldRunIntentFold({ ...BASE })).toBe(true)
  })

  it('is disabled when the frozen setting is off', () => {
    const out = evaluateIntentGate({ ...BASE, enabled: false })
    expect(out.decision).toBe(false)
    expect(out.reason).toBe('disabled')
  })

  it('override off wins over everything, including a passing numeric profile', () => {
    const out = evaluateIntentGate({ ...BASE, override: 'off' })
    expect(out.decision).toBe(false)
    expect(out.reason).toBe('override-off')
  })

  it('override on does NOT bypass the numeric gates', () => {
    expect(shouldRunIntentFold({ ...BASE, override: 'on', liveTokens: 1_000 })).toBe(false)
  })

  it('unknown context window fails closed toward no-window', () => {
    const out = evaluateIntentGate({ ...BASE, contextWindow: undefined })
    expect(out.decision).toBe(false)
    expect(out.reason).toBe('no-window')
  })

  it('floor boundary is exclusive: exactly at 45% does not trigger', () => {
    const atFloor = BASE.contextWindow * INTENT_GATE_FLOOR_FRACTION
    expect(shouldRunIntentFold({ ...BASE, liveTokens: atFloor })).toBe(false)
    expect(shouldRunIntentFold({ ...BASE, liveTokens: atFloor + 1 })).toBe(true)
  })

  it('growth boundary is exclusive: exactly at the threshold does not trigger', () => {
    const baseline = 90_000
    const atGrowth = baseline + INTENT_GATE_GROWTH_TOKENS
    expect(shouldRunIntentFold({ ...BASE, liveTokens: atGrowth, baselineTokens: baseline })).toBe(false)
    expect(shouldRunIntentFold({ ...BASE, liveTokens: atGrowth + 1, baselineTokens: baseline })).toBe(true)
  })

  it('non-finite or negative counters fail closed', () => {
    expect(shouldRunIntentFold({ ...BASE, liveTokens: Number.NaN })).toBe(false)
    expect(shouldRunIntentFold({ ...BASE, liveTokens: Number.POSITIVE_INFINITY })).toBe(false)
    expect(shouldRunIntentFold({ ...BASE, baselineTokens: -1 })).toBe(false)
  })
})
