import { describe, expect, it } from 'vitest'
import { resolveConfig, resolvePolicy } from '../../src/pruner.ts'

/** task_4 (G2): the read input cap is in CHARACTERS while the fresh trigger is
 *  in TOKENS. At the conservative 4.0 chars/token upper bound, a cap at or
 *  below `freshTriggerTokens × 4.0` truncates every read result below the
 *  trigger and silently silences the fresh path — so `resolvePolicy` must
 *  reject that combination at startup. 32k fails (32,000 < 8192×4.0 = 32,768);
 *  the deployed 50k cap passes; unset stays untouched. */
describe('readInputCapChars invariant', () => {
  it('throws when the cap would sit below the fresh trigger (32k vs 8192×4.0)', () => {
    const config = resolveConfig({ readInputCapChars: 32_000 })
    expect(() => resolvePolicy(config, 'balanced')).toThrow(
      'context compression policy: read input cap would silence the fresh path',
    )
  })

  it('accepts the deployed 50k cap', () => {
    const config = resolveConfig({ readInputCapChars: 50_000 })
    const policy = resolvePolicy(config, 'balanced')
    expect(policy.readInputCapChars).toBe(50_000)
  })

  it('leaves the policy untouched when the cap is not set', () => {
    const policy = resolvePolicy(resolveConfig({}), 'balanced')
    expect(policy.readInputCapChars).toBeUndefined()
  })

  it('keeps profiles without a configured cap byte-identical (no field on the resolved object)', () => {
    const policy = resolvePolicy(resolveConfig({}), 'balanced')
    expect(Object.hasOwn(policy, 'readInputCapChars')).toBe(false)
  })
})
