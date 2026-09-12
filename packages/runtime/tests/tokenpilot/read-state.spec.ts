/**
 * TokenPilot-inspired R2/R3 unit coverage: superseded-read classification and
 * clustered omission summaries.
 */
import { describe, expect, it } from 'vitest'
import {
  clusterOmittedLines,
  isSupersededRead,
  toolCallPath,
} from '../../src/tokenpilot/read-state.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function callEvent(seq: number, name: string, args: Record<string, unknown>): SessionEvent {
  return { seq, type: 'tool/call', data: { name, arguments: JSON.stringify(args) } } as unknown as SessionEvent
}

function resultEvent(seq: number): SessionEvent {
  return { seq, type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'x' }] } } } as unknown as SessionEvent
}

describe('tokenpilot read-state helpers', () => {
  it('parses paths from path and file_path argument keys', () => {
    expect(toolCallPath('{"path":"a.ts"}')).toBe('a.ts')
    expect(toolCallPath('{"file_path":"b.ts"}')).toBe('b.ts')
    expect(toolCallPath('not json')).toBeUndefined()
    expect(toolCallPath('{"path":42}')).toBeUndefined()
  })

  it('marks a read superseded only by a later write-style call on the same path', () => {
    const events: SessionEvent[] = [
      resultEvent(1),
      callEvent(2, 'read', { path: 'src/a.ts' }),
      callEvent(3, 'bash', { command: 'echo write src/a.ts' }),
      callEvent(4, 'edit', { path: 'src/other.ts' }),
    ]
    expect(isSupersededRead(events, 2, 'src/a.ts')).toBe(false)
    const events2: SessionEvent[] = [...events, callEvent(5, 'file_edit', { path: 'src/a.ts' })]
    expect(isSupersededRead(events2, 2, 'src/a.ts')).toBe(true)
    expect(isSupersededRead(events, 2, undefined)).toBe(false)
    // Mutations before the read never supersede it.
    const events3: SessionEvent[] = [callEvent(0, 'edit', { path: 'src/a.ts' }), resultEvent(1), callEvent(2, 'read', { path: 'src/a.ts' })]
    expect(isSupersededRead(events3, 2, 'src/a.ts')).toBe(false)
  })

  it('clusters omitted lines into an error/warn/info census', () => {
    const text = [
      'ok line',
      'Error: bad thing',
      'warning: careful',
      'another ok',
      'FATAL: worse',
      'warn: also',
    ].join('\n')
    expect(clusterOmittedLines(text, 6)).toBe('6 lines omitted (2 error, 2 warn, 2 info)')
    expect(clusterOmittedLines('fine', 1)).toBe('1 lines omitted (1 info)')
    expect(clusterOmittedLines('fine', 0)).toBeUndefined()
  })
})
