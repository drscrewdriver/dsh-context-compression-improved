import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { projectSavingsCore, type SavingsTextCounter } from '../../src/runtime/savings-projection.ts'

/** 假规范化计数器：直接按字符数出精确口径，便于断言。 */
const counter: SavingsTextCounter = text => Object.freeze({
  kind: 'exact-tokenizer',
  tokens: text.length,
  tokenizerId: 'test',
  tokenizerRevision: 'r1',
})

function toolResult(seq: number, time: number, text: string, surfaceOp?: unknown): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    time,
    ...(surfaceOp === undefined ? {} : { surfaceOp }),
    data: { message: { content: [{ type: 'text', text }] } },
  } as unknown as SessionEvent
}

function manifest(seq: number, time: number): SessionEvent {
  return { type: 'compaction/prune', seq, time, data: {} } as unknown as SessionEvent
}

const replace0 = { op: 'replace', startSeq: 0, endSeq: 0 }

describe('savings projection(会话日志投影重建)', () => {
  it('surface 中的替换计为当前生效毛节省；重读原文计负项', () => {
    const original = 'A'.repeat(400)
    const events = [
      toolResult(0, 1, original),
      manifest(1, 2),
      toolResult(2, 3, 'A'.repeat(100), replace0),
      toolResult(3, 4, original), // 全文重读
    ]
    const projection = projectSavingsCore({ events, surfaceNodes: [2], counter })
    expect(projection.savings).toHaveLength(1)
    expect(projection.savings[0]).toMatchObject({ tokens: 300, basis: 'exact-tokenizer', replacementSeq: 2 })
    expect(projection.offsets).toHaveLength(1)
    expect(projection.offsets[0]).toMatchObject({ component: 'full-read', tokens: 400, basis: 'exact-tokenizer' })
    expect(projection.offsets[0]?.note).toContain('#0')
    expect(projection.registry).toHaveLength(1)
    expect(projection.registry[0]).toMatchObject({ claimedTokens: 300, sourceSeq: 0 })
  })

  it('替换离开 surface → 毛节省回落为 0(仪表)', () => {
    const events = [
      toolResult(0, 1, 'A'.repeat(400)),
      toolResult(2, 3, 'A'.repeat(100), replace0),
    ]
    const still = projectSavingsCore({ events, surfaceNodes: [2], counter })
    expect(still.savings).toHaveLength(1)
    const gone = projectSavingsCore({ events, surfaceNodes: [0], counter })
    expect(gone.savings).toHaveLength(0)
  })

  it('每次重读都罚(不再一次性消费)', () => {
    const original = 'B'.repeat(500)
    const events = [
      toolResult(0, 1, original),
      toolResult(2, 3, 'B'.repeat(120), replace0),
      toolResult(3, 4, original),
      toolResult(4, 5, original),
    ]
    const projection = projectSavingsCore({ events, surfaceNodes: [2], counter })
    expect(projection.offsets).toHaveLength(2)
    expect(projection.offsets.every(entry => entry.tokens === 500)).toBe(true)
  })

  it('首次压缩之前的重复读取不算惩罚(必须有"第一次的压缩"才配对)', () => {
    const original = 'C'.repeat(300)
    const events = [
      toolResult(0, 1, original),
      toolResult(1, 2, original), // 压缩前重复：registry 还空，不计
      toolResult(2, 3, 'C'.repeat(80), replace0),
      toolResult(3, 4, original), // 压缩后重读：计
    ]
    const projection = projectSavingsCore({ events, surfaceNodes: [2], counter })
    expect(projection.offsets).toHaveLength(1)
    expect(projection.registry).toHaveLength(1)
  })

  it('空事件流返回空投影', () => {
    const projection = projectSavingsCore({ events: [], surfaceNodes: [1, 2], counter })
    expect(projection).toEqual({ savings: [], offsets: [], registry: [] })
  })
})
