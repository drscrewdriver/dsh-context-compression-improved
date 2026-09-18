/**
 * TokenPilot-inspired E1 unit coverage: pure estimator helpers. The channels
 * themselves are integration-level (host/direct transports) and are covered
 * by the fail-open contract — every malformed answer resolves to no verdicts.
 */
import { describe, expect, it } from 'vitest'
import {
  backoffCooldownMs,
  buildEstimatorUserPrompt,
  isCoolingDown,
  parseEstimatorAnswer,
  parseEstimatorAnswerDetailed,
} from '../../../src/runtime/tokenpilot/estimator.ts'

describe('tokenpilot estimator helpers', () => {
  it('parses well-formed verdict arrays, tolerating surrounding prose', () => {
    expect(parseEstimatorAnswer('[{"seq":12,"expired":true},{"seq":13,"expired":false}]')).toEqual([
      { seq: 12, expired: true },
      { seq: 13, expired: false },
    ])
    expect(parseEstimatorAnswer('Verdicts: [{"seq":7,"expired":true}] done')).toEqual([
      { seq: 7, expired: true },
    ])
  })

  it('yields no verdicts for malformed answers', () => {
    expect(parseEstimatorAnswer('')).toEqual([])
    expect(parseEstimatorAnswer('no json here')).toEqual([])
    expect(parseEstimatorAnswer('[{"seq":"12","expired":true}]')).toEqual([])
    expect(parseEstimatorAnswer('[{"seq":12}]')).toEqual([])
    expect(parseEstimatorAnswer('not json [')).toEqual([])
  })

  it('reads the optional expectedRemainingTurns from the extended object form', () => {
    const answer = parseEstimatorAnswerDetailed(
      'Result: {"expectedRemainingTurns":7.9,"items":[{"seq":3,"expired":false}]} end',
    )
    expect(answer.verdicts).toEqual([{ seq: 3, expired: false }])
    // Fractional estimates floor to whole turns.
    expect(answer.expectedRemainingTurns).toBe(7)
  })

  it('stays Ŝ-less for legacy arrays and malformed turn fields', () => {
    const legacy = parseEstimatorAnswerDetailed('Verdicts: [{"seq":7,"expired":true}] done')
    expect(legacy.verdicts).toEqual([{ seq: 7, expired: true }])
    expect(legacy.expectedRemainingTurns).toBeUndefined()
    const malformed = parseEstimatorAnswerDetailed('{"expectedRemainingTurns":"soon","items":[{"seq":1,"expired":true}]}')
    expect(malformed.verdicts).toEqual([{ seq: 1, expired: true }])
    expect(malformed.expectedRemainingTurns).toBeUndefined()
    // Negative estimates are rejected like any other non-numeric field.
    const negative = parseEstimatorAnswerDetailed('{"expectedRemainingTurns":-2,"items":[{"seq":1,"expired":true}]}')
    expect(negative.expectedRemainingTurns).toBeUndefined()
    expect(negative.verdicts).toEqual([{ seq: 1, expired: true }])
  })

  it('builds a path-only user prompt without file content', () => {
    const prompt = buildEstimatorUserPrompt([
      { seq: 4, path: 'src/a.ts', turn: 2 },
      { seq: 9, path: 'docs/b.md', turn: 3 },
    ])
    expect(prompt).toContain('"seq":4')
    expect(prompt).toContain('"path":"src/a.ts"')
    expect(prompt).not.toMatch(/content/i)
  })

  it('backs off exponentially with a five-minute cap', () => {
    expect(backoffCooldownMs(0)).toBe(1_000)
    expect(backoffCooldownMs(1)).toBe(1_000)
    expect(backoffCooldownMs(2)).toBe(2_000)
    expect(backoffCooldownMs(3)).toBe(4_000)
    expect(backoffCooldownMs(20)).toBe(300_000)
  })

  it('treats missing failure state as never cooling down', () => {
    expect(isCoolingDown(undefined, Date.now())).toBe(false)
    expect(isCoolingDown({ failures: 1, cooldownUntil: Date.now() - 1 }, Date.now())).toBe(false)
    expect(isCoolingDown({ failures: 1, cooldownUntil: Date.now() + 60_000 }, Date.now())).toBe(true)
  })
})
