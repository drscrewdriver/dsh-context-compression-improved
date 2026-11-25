/**
 * F13: Injected-source whitelist filtering tests.
 *
 * @module dsh-context-compression-improved/tests/runtime/injected-kinds
 */
import { describe, expect, it } from 'vitest'
import { isInjectedMessage, isRealUserBoundary, INJECTED_SOURCE_KINDS } from '../../src/runtime/injected-kinds.ts'

describe('F13: INJECTED_SOURCE_KINDS whitelist', () => {
  it('contains at least 5 known injection kinds', () => {
    expect(INJECTED_SOURCE_KINDS.size).toBeGreaterThanOrEqual(5)
    expect(INJECTED_SOURCE_KINDS.has('time-context')).toBe(true)
    expect(INJECTED_SOURCE_KINDS.has('tool-jobs')).toBe(true)
    expect(INJECTED_SOURCE_KINDS.has('skill-catalog')).toBe(true)
    expect(INJECTED_SOURCE_KINDS.has('dsh-context-compression')).toBe(true)
    expect(INJECTED_SOURCE_KINDS.has('dsh-ops-ptc')).toBe(true)
  })
})

describe('F13: isInjectedMessage', () => {
  it('returns true for injected user/message events', () => {
    expect(isInjectedMessage({ type: 'user/message', data: { source: { kind: 'time-context' } } })).toBe(true)
    expect(isInjectedMessage({ type: 'user/message', data: { source: { kind: 'dsh-ops-ptc' } } })).toBe(true)
  })

  it('returns false for real user messages (no source)', () => {
    expect(isInjectedMessage({ type: 'user/message', data: {} })).toBe(false)
  })

  it('returns false for non-user events', () => {
    expect(isInjectedMessage({ type: 'tool/result', data: { source: { kind: 'time-context' } } })).toBe(false)
    expect(isInjectedMessage({ type: 'agent/step' })).toBe(false)
  })

  it('returns false for user/message with unknown source kind', () => {
    expect(isInjectedMessage({ type: 'user/message', data: { source: { kind: 'something-new' } } })).toBe(false)
  })
})

describe('F13: isRealUserBoundary', () => {
  it('returns true for user/message without source (old host compat)', () => {
    expect(isRealUserBoundary({ type: 'user/message', data: {} })).toBe(true)
  })

  it('returns true for user/message with non-injected source', () => {
    expect(isRealUserBoundary({ type: 'user/message', data: { source: { kind: 'user-typed' } } })).toBe(true)
  })

  it('returns false for injected user/message', () => {
    expect(isRealUserBoundary({ type: 'user/message', data: { source: { kind: 'skill-catalog' } } })).toBe(false)
  })

  it('returns false for non-user events', () => {
    expect(isRealUserBoundary({ type: 'tool/result' })).toBe(false)
  })
})

describe('F13: mixed event stream simulation', () => {
  const events = [
    { type: 'user/message', data: { source: { kind: 'time-context' } } },
    { type: 'user/message', data: {} }, // real user
    { type: 'tool/result', data: {} },
    { type: 'user/message', data: { source: { kind: 'dsh-context-compression' } } },
    { type: 'tool/result', data: {} },
    { type: 'user/message', data: { source: { kind: 'tool-jobs' } } },
    { type: 'user/message', data: {} }, // real user
    { type: 'tool/result', data: {} },
  ]

  it('correctly identifies 2 real user boundaries out of 8 events', () => {
    const real = events.filter(isRealUserBoundary)
    expect(real).toHaveLength(2)
  })

  it('correctly identifies 3 injected messages out of 8 events', () => {
    const injected = events.filter(isInjectedMessage)
    expect(injected).toHaveLength(3)
  })

  it('injected + real = total user/message count (no double-counting)', () => {
    const allUser = events.filter(e => e.type === 'user/message')
    const injected = events.filter(isInjectedMessage)
    const real = events.filter(isRealUserBoundary)
    expect(injected.length + real.length).toBe(allUser.length)
  })
})
