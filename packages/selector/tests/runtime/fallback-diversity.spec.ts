/**
 * Fallback path diversity: reducer chain never retries the same failing path.
 *
 * Plan: cci-longterm-refactor v0.13.1 (F15 — fallback diversity, live-compact #54 lesson)
 *
 * live-compact #54: `disableLongRead` blocked recursion but not retry —
 * same input hit the same failing path again next turn, spinning forever.
 *
 * CCI's structural defense: the reducer chain in `reduceFresh()` tries
 * multiple candidates IN ORDER within ONE pass. If candidate N fails
 * (returns null), candidate N+1 takes over. The pruner's snapshot is rebuilt
 * fresh each turn, and the chain is deterministic — the same candidate that
 * fell from "skeleton" to "head/tail" will ALWAYS follow the same path because
 * the chain composition is based on toolClass/size, not mutable state.
 *
 * This test validates the invariant: within one reduceFresh() call, a failing
 * reducer returns null and the next reducer gets a chance (not the same one again).
 *
 * @module dsh-context-compression-improved/tests/runtime/fallback-diversity
 */
import { describe, expect, it } from 'vitest'
import { reduceFreshToolResult } from '../../src/runtime/reducers.ts'

function makeInput(overrides: Partial<Parameters<typeof reduceFreshToolResult>[0]> = {}): Parameters<typeof reduceFreshToolResult>[0] {
  const longText = Array.from({ length: 200 }, (_, i) => `line ${i}: some content here`).join('\n')
  return {
    toolName: 'read_file',
    argumentsText: JSON.stringify({ path: '/some/file.ts' }),
    text: longText,
    budgetChars: 4096,
    sourceRef: 'session://test/event/1',
    isError: false,
    ...overrides,
  } as Parameters<typeof reduceFreshToolResult>[0]
}

describe('F15: reducer chain fallback diversity', () => {
  it('read-class tool + long text: produces output (not stuck in null loop)', () => {
    const result = reduceFreshToolResult(makeInput())
    // read_file on a large file should get SOME reduction (head/tail or skeleton)
    expect(result).not.toBeNull()
    expect(result!.text.length).toBeLessThan(makeInput().text.length)
  })

  it('error content is never skeletonized (different path taken)', () => {
    const errText = 'Traceback (most recent call last):\n  File "test.py", line 42\n  ValueError: something went wrong'
    const result = reduceFreshToolResult(makeInput({ text: errText, isError: true, budgetChars: 512 }))
    // Errors either pass through (null = keep full) or get a specific reducer
    // They should NOT be reduced to skeleton with elided lines
    if (result !== null) {
      // If reduced, error-specific content should be preserved
      expect(result.text).toContain('ValueError')
    }
  })

  it('same input always produces same reducer (deterministic chain)', () => {
    const input = makeInput()
    const first = reduceFreshToolResult(input)
    const second = reduceFreshToolResult(input)
    // Deterministic: same input → same output (no state, no "disable" flag)
    expect(first?.reducer).toBe(second?.reducer)
    expect(first?.text).toBe(second?.text)
  })

  it('short content below budget: returns null (no reduction needed)', () => {
    const result = reduceFreshToolResult(makeInput({ text: 'tiny', budgetChars: 8192 }))
    // Below budget = nothing to cut = null (not an error, just skip)
    expect(result).toBeNull()
  })

  it('empty content: returns null safely', () => {
    const result = reduceFreshToolResult(makeInput({ text: '' }))
    expect(result).toBeNull()
  })
})
