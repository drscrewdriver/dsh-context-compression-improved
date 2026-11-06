/**
 * T1.1/T1.3/T1.5 red tests: line-A signal rules (plan cci-sedimentation-triage).
 * Base block signals are the five structural variants; the line pool is
 * DECOUPLED from block classification so soft-failure blocks (exit 0 with
 * error lines in the body) still land verbatim lines — the round-1 62.4%
 * recall regression anchor.
 */
import { describe, expect, it } from 'vitest'
import {
  blockFailureVerdict,
  linePool,
  mergeExtraPatterns,
} from '../../src/runtime/triage/signals.ts'

describe('blockFailureVerdict (base structural set, T1.1)', () => {
  it('flags the five structural failure signals', () => {
    expect(blockFailureVerdict('[stderr] something broke\nexit code tail', false).hard).toBe(true)
    expect(blockFailureVerdict('ran tests\n[exit code: 1]', false).hard).toBe(true)
    expect(blockFailureVerdict('ran build\n[Command finished with exit code 2]', false).hard).toBe(true)
    expect(blockFailureVerdict('exit_code=7', false).hard).toBe(true)
    expect(blockFailureVerdict('{"stdout":"boom","exitCode":1}', false).hard).toBe(true)
    expect(blockFailureVerdict('anything', true).hard).toBe(true)
  })

  it('exit code 0 forms are NOT hard failures', () => {
    expect(blockFailureVerdict('ok output\n[exit code: 0]', false).hard).toBe(false)
    expect(blockFailureVerdict('[Command finished with exit code 0]', false).hard).toBe(false)
    expect(blockFailureVerdict('exit_code=0', false).hard).toBe(false)
    expect(blockFailureVerdict('{"stdout":"fine","exitCode":0}', false).hard).toBe(false)
  })

  it('records which rule ids fired for audit', () => {
    const verdict = blockFailureVerdict('boom\n[exit code: 3]', false)
    expect(verdict.ruleIds).toContain('sig:exit-code-bracket')
  })
})

describe('linePool (verbatim capture, decoupled from block class, T1.3)', () => {
  it('captures the classic failure line family', () => {
    const text = [
      'normal narration line',
      'Error: cannot resolve module X',
      'Exception: in thread "main"',
      'Traceback (most recent call last):',
      'FAILED tests/foo.py::test_bar',
      'panic: runtime error: nil pointer',
      'AssertionError: expected 1 to be 2',
    ].join('\n')
    const pool = linePool(text, { seq: 42, role: 'tool', hardFailure: false })
    const captured = pool.map(line => line.text)
    expect(captured).toHaveLength(6)
    expect(captured.every(line => !line.startsWith('normal narration'))).toBe(true)
    expect(pool.every(line => line.seq === 42 && line.role === 'tool')).toBe(true)
  })

  it('soft-failure anchor: exit 0 block with error lines still yields pool lines (round-1 regression)', () => {
    const soft = 'npm test output\nError: 1 test failed\n[exit code: 0]'
    expect(blockFailureVerdict(soft, false).hard).toBe(false)
    const pool = linePool(soft, { seq: 7, role: 'tool', hardFailure: false })
    expect(pool.map(line => line.text)).toContain('Error: 1 test failed')
  })

  it('caps lines at 240 codepoints plus the ellipsis marker and marks truncation', () => {
    const long = `Error: ${'x'.repeat(300)}`
    const pool = linePool(long, { seq: 1, role: 'tool', hardFailure: true })
    const line = pool[0]
    if (line === undefined) throw new Error('expected one pooled line')
    expect(line.text.length).toBeLessThanOrEqual(245)
    expect(Array.from(line.text.replace(/ …$/, '')).length).toBe(240)
    expect(line.truncated).toBe(true)
  })

  it('dedupes identical lines within one block', () => {
    const text = 'Error: dup\nError: dup\nFAILED a\nFAILED a'
    expect(linePool(text, { seq: 2, role: 'tool', hardFailure: true })).toHaveLength(2)
  })

  it('carries ruleId and hardFailure onto every line', () => {
    const pool = linePool('Error: boom', { seq: 3, role: 'assistant', hardFailure: true })
    const line = pool[0]
    if (line === undefined) throw new Error('expected one pooled line')
    expect(line.ruleId).toBe('line:failure-classic')
    expect(line.hardFailure).toBe(true)
  })
})

describe('mergeExtraPatterns (append-only slot, T1.5)', () => {
  it('default extras capture TOOL_TIMEOUT / killed / OOM / assert-context lines', () => {
    const patterns = mergeExtraPatterns([])
    const text = [
      'Error: tool call timed out after 25000ms',
      'process was killed by OOM killer',
      'expected value to be truthy but got: false',
    ].join('\n')
    const pool = linePool(text, { seq: 9, role: 'tool', hardFailure: true, extraPatterns: patterns })
    // line 1 already hits the classic family; lines 2-3 must be captured by extras.
    expect(pool.some(line => line.text.startsWith('process was killed'))).toBe(true)
    expect(pool.some(line => line.text.startsWith('expected value'))).toBe(true)
  })

  it('clearing user extras keeps base + default extras alive — the base is never removable (M3)', () => {
    const cleared = mergeExtraPatterns([])
    const pool = linePool('FAILED a\nKilled', { seq: 1, role: 'tool', hardFailure: true, extraPatterns: cleared })
    expect(pool.map(line => line.text)).toEqual(['FAILED a', 'Killed'])
    const withUser = mergeExtraPatterns(['npm ERR!'])
    const pool2 = linePool('npm ERR! code 1', { seq: 1, role: 'tool', hardFailure: false, extraPatterns: withUser })
    expect(pool2).toHaveLength(1)
  })

  it('user extras are additive only: base lines still match without them', () => {
    const patterns = mergeExtraPatterns(['zzz-nothing-matches-this'])
    const pool = linePool('Error: classic', { seq: 1, role: 'tool', hardFailure: false, extraPatterns: patterns })
    expect(pool).toHaveLength(1)
  })

  it('invalid regex entries are skipped, never thrown (profiles rejects upstream)', () => {
    const patterns = mergeExtraPatterns(['(unclosed', 'valid\\d+'])
    const pool = linePool('valid123', { seq: 1, role: 'tool', hardFailure: false, extraPatterns: patterns })
    expect(pool).toHaveLength(1)
    const line = pool[0]
    if (line === undefined) throw new Error('expected one pooled line')
    expect(line.ruleId).toContain('ext:user:')
  })
})
