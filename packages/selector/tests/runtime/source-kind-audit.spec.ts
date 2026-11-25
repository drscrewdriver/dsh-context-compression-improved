/**
 * Source-kind audit: all message publications use plugin-specific source kind.
 *
 * Plan: cci-longterm-refactor v0.13.1 (F16 — source.kind audit)
 *
 * Verifies the invariant: every createUserMessage call within this plugin
 * carries source.kind === 'dsh-context-compression' (modern hosts) or
 * source.kind === 'plugin' with plugin === 'dsh-context-compression-improved'
 * (legacy hosts). Messages must NEVER use kind: 'user' — dsh-ops #1040 lesson:
 * host treats kind:'user' as a real user bubble, polluting chat history.
 *
 * @module dsh-context-compression-improved/tests/runtime/source-kind-audit
 */
import { describe, expect, it } from 'vitest'
import { compressionMessageSource } from '../../src/compat/tool-result.ts'
import { createUserMessage } from '../../src/compat/llm-messages.ts'

describe('F16: compressionMessageSource returns plugin-specific kind', () => {
  it('modern host: kind is dsh-context-compression', () => {
    // Default (no generation arg) should be modern
    const source = compressionMessageSource('modern')
    expect(source).toEqual({ kind: 'dsh-context-compression' })
  })

  it('legacy host: kind is plugin with correct plugin id', () => {
    const source = compressionMessageSource('legacy')
    expect(source).toEqual({
      kind: 'plugin',
      plugin: 'dsh-context-compression-improved',
    })
  })

  it('neither path returns kind: "user"', () => {
    const modern = compressionMessageSource('modern')
    const legacy = compressionMessageSource('legacy')
    expect(modern.kind).not.toBe('user')
    expect(legacy.kind).not.toBe('user')
  })
})

describe('F16: createUserMessage preserves source.kind from input', () => {
  it('message carries the plugin-specific source through creation', () => {
    const content = [{ type: 'text' as const, text: 'test skeleton footer' }]
    const source = compressionMessageSource('modern')
    const message = createUserMessage({
      content,
      source: source as { kind: 'dsh-context-compression' },
    })
    expect(message.role).toBe('user') // role is always 'user' for message type
    expect((message as any).source.kind).toBe('dsh-context-compression')
    expect((message as any).source.kind).not.toBe('user')
  })

  it('legacy source also passes through', () => {
    const content = [{ type: 'text' as const, text: 'test tail-trim stub' }]
    const source = compressionMessageSource('legacy')
    const message = createUserMessage({
      content,
      source: source as any,
    })
    expect((message as any).source.kind).toBe('plugin')
    expect((message as any).source.plugin).toBe('dsh-context-compression-improved')
  })
})

describe('F16: static audit — no hard-coded kind:"user" in src', () => {
  it('compressionMessageSource is the single source of truth for message sources', () => {
    // This test is a structural invariant check:
    // If anyone adds a new createUserMessage() call with a raw literal
    // like `source: { kind: 'user' }`, the TypeScript type system should
    // reject it (MessageSourceMap has no 'user' key registered by this plugin).
    // The compressionMessageSource() factory is the ONLY sanctioned way.
    //
    // Note: Full grep-based enforcement is the ESLint rule (task_13.1.2).
    // This test just validates the factory function itself is correct.
    const source = compressionMessageSource()
    expect(['dsh-context-compression', 'plugin']).toContain(source.kind)
  })
})
