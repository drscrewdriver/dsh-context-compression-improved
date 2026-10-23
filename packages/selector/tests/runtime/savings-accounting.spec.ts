/**
 * 记账口径修复三件套集成 spec(T11 offset 收敛 + T12 翻负折叠 + T13 驱逐保护)。
 *
 * 全链数值断言:收敛→翻负→驱逐;每步与 snapshot() 对账
 * (net = gross − offsets,exact/estimated 两列独立,永不合并)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { SavingsLedger } from '../../src/runtime/savings.ts'

/** 对照基线:原文 a=5000,骨架 b=800,毛节省声称 a−b=4200(精确口径)。 */
const A = 5_000
const B = 800
const CLAIM = A - B

function freshSaving(ledger: SavingsLedger, sessionId = 's1', sourceSeq = 7, replacementSeq = 100): void {
  ledger.recordSaving({
    sessionId,
    component: 'fresh',
    tokensBefore: A,
    tokensAfter: B,
    basis: 'exact-tokenizer',
    sourceSeq,
    replacementSeq,
  })
}

/** 账本自洽检查:两 basis 列都满足 net = gross − offsets。 */
function expectReconciled(snapshot: ReturnType<SavingsLedger['snapshot']>): void {
  expect(snapshot.net.exact).toBe(snapshot.gross.exact - snapshot.offsets.exact)
  expect(snapshot.net.estimated).toBe(snapshot.gross.estimated - snapshot.offsets.estimated)
}

describe('记账收敛(T11:offset 带 sourceSeq,离面即停罚)', () => {
  let ledger: SavingsLedger
  beforeEach(() => {
    ledger = new SavingsLedger()
  })

  it('构造:召回→继续压缩老化出面→净值回升(全文重读罚不再永不过期)', () => {
    const original = 'const x = compute()\n'.repeat(600)
    ledger.recordSaving({
      sessionId: 's1',
      component: 'fresh',
      tokensBefore: A,
      tokensAfter: B,
      basis: 'exact-tokenizer',
      sourceSeq: 7,
      replacementSeq: 100,
      originalText: original,
    })
    // 全文重读事件 seq=40 进面:命中配对,负项挂在"重读事件自身"的存活面上。
    ledger.noteFullText({
      sessionId: 's1',
      seq: 40,
      text: original,
      measure: () => ({ tokens: A, basis: 'exact-tokenizer' }),
    })
    // 重读在面:罚生效,net = 4200 − 5000 = −800(与旧行为等值)。
    ledger.observeActive('s1', new Set([100, 40]))
    const pressed = ledger.snapshot('s1')
    expect(pressed.offsets.exact).toBe(A)
    expect(pressed.net.exact).toBe(-B)
    expectReconciled(pressed)
    // 重读文本被后续压缩老化出面 → 停罚,净值回升到毛节省。
    ledger.observeActive('s1', new Set([100]))
    const rebound = ledger.snapshot('s1')
    expect(rebound.offsets.exact).toBe(0)
    expect(rebound.net.exact).toBe(CLAIM)
    expectReconciled(rebound)
  })

  it('无 sourceSeq 的 offset 流水保持原样(永久;retrieve 未退化路径不受影响)', () => {
    freshSaving(ledger)
    ledger.recordOffset({ sessionId: 's1', component: 'retrieve', tokens: 300, basis: 'characters' })
    ledger.observeActive('s1', new Set([100]))
    const snap = ledger.snapshot('s1')
    expect(snap.offsets.estimated).toBe(300)
    expectReconciled(snap)
  })

  it('saving 条目照旧按 replacementSeq 收敛(回归不变)', () => {
    freshSaving(ledger)
    ledger.observeActive('s1', new Set([101]))
    expect(ledger.snapshot('s1').gross.exact).toBe(0)
  })
})

describe('翻负折叠(T12:foldRecall 同 basis 折叠 a−(b+R),下限 −b)', () => {
  let ledger: SavingsLedger
  beforeEach(() => {
    ledger = new SavingsLedger()
  })

  it('全量召回:源条目分项贡献 = −b,净额与现行 offset 流水行为等值', () => {
    freshSaving(ledger)
    expect(ledger.foldRecall('s1', 7, A, 'exact-tokenizer')).toBe(true)
    const snap = ledger.snapshot('s1')
    expect(snap.gross.exact).toBe(0)
    expect(snap.offsets.exact).toBe(B)
    expect(snap.net.exact).toBe(-B) // 与现行为 4200−5000 = −800 等值
    expectReconciled(snap)
    // 负效果骨架:分项里该源条目以负值呈现(供 Phase 6 分项显示)。
    const row = snap.perComponent.find(
      r => r.kind === 'saving' && r.component === 'fresh' && r.basis === 'exact-tokenizer',
    )
    expect(row?.tokens).toBe(-B)
  })

  it('部分召回:贡献 = a−(b+R),净额等值于旧流水口径', () => {
    freshSaving(ledger)
    const R = 1_000
    expect(ledger.foldRecall('s1', 7, R, 'exact-tokenizer')).toBe(true)
    const snap = ledger.snapshot('s1')
    expect(snap.gross.exact).toBe(A - (B + R)) // 4200−1000
    expect(snap.offsets.exact).toBe(0)
    expect(snap.net.exact).toBe(CLAIM - R)
    expectReconciled(snap)
  })

  it('多次召回累计 R,下限 −b 不再下探', () => {
    freshSaving(ledger)
    expect(ledger.foldRecall('s1', 7, 3_000, 'exact-tokenizer')).toBe(true)
    expect(ledger.snapshot('s1').net.exact).toBe(CLAIM - 3_000) // 1200
    expect(ledger.foldRecall('s1', 7, 3_000, 'exact-tokenizer')).toBe(true)
    const floored = ledger.snapshot('s1')
    expect(floored.net.exact).toBe(-B) // max(1200−3000, −800)
    expect(ledger.foldRecall('s1', 7, 9_999, 'exact-tokenizer')).toBe(true)
    expect(ledger.snapshot('s1').net.exact).toBe(-B) // 不再下探
    expectReconciled(floored)
  })

  it('跨 basis 不折叠:退化为带 sourceSeq 的收敛 offset,exact 列不被污染', () => {
    freshSaving(ledger)
    // 精确口径源条目遭遇 chars/4 召回:禁折叠(口径分列永不合并)。
    expect(ledger.foldRecall('s1', 7, 900, 'characters')).toBe(false)
    const snap = ledger.snapshot('s1')
    expect(snap.gross.exact).toBe(CLAIM) // 精确列合计与折叠前自洽
    expect(snap.offsets.exact).toBe(0)
    expect(snap.offsets.estimated).toBe(900)
    expectReconciled(snap)
    // 退化条目带 sourceSeq=7(根源事件必在面外):下一次收敛即停罚。
    ledger.observeActive('s1', new Set([100]))
    const after = ledger.snapshot('s1')
    expect(after.offsets.estimated).toBe(0)
    expect(after.net.exact).toBe(CLAIM)
    expectReconciled(after)
  })

  it('未找到源条目(已离面/无配对键)同样退化为收敛 offset 流水', () => {
    expect(ledger.foldRecall('s1', 999, 500, 'characters')).toBe(false)
    const snap = ledger.snapshot('s1')
    expect(snap.offsets.estimated).toBe(500)
    // 无效入参不入账
    expect(ledger.foldRecall('s1', 999, 0, 'characters')).toBe(false)
    expect(ledger.foldRecall('s1', 999, Number.NaN, 'characters')).toBe(false)
    expect(ledger.snapshot('s1').offsets.estimated).toBe(500)
  })

  it('投影播种条目无 sourceSeq 配对键 → 不折叠,走退化 offset 流水', () => {
    ledger.seedProjected('s2', {
      savings: [{ component: 'projection', tokens: 1_000, basis: 'exact-tokenizer', at: Date.now(), replacementSeq: 50 }],
      offsets: [],
      registry: [],
    })
    expect(ledger.foldRecall('s2', 50, 400, 'exact-tokenizer')).toBe(false)
    const snap = ledger.snapshot('s2')
    expect(snap.gross.exact).toBe(1_000)
    expect(snap.offsets.exact).toBe(400)
    expectReconciled(snap)
  })

  it('递进压缩同根源:折最新条目,下限 −b 用最新骨架', () => {
    // 第一次压 a=5000 → b1=1500(src 7, rep 100),第二次压 b1 → b2=800(同 src, rep 101)
    ledger.recordSaving({ sessionId: 's1', component: 'fresh', tokensBefore: A, tokensAfter: 1_500, basis: 'exact-tokenizer', sourceSeq: 7, replacementSeq: 100 })
    ledger.recordSaving({ sessionId: 's1', component: 'aggregate', tokensBefore: 1_500, tokensAfter: B, basis: 'exact-tokenizer', sourceSeq: 7, replacementSeq: 101 })
    expect(ledger.foldRecall('s1', 7, 4_000, 'exact-tokenizer')).toBe(true)
    const snap = ledger.snapshot('s1')
    // 全链声称 (5000−1500)+(1500−800)=4200;最新条目 700−4000 → 下限 −800,旧条目不动。
    expect(snap.gross.exact).toBe(3_500)
    expect(snap.offsets.exact).toBe(800)
    expect(snap.net.exact).toBe(2_700)
    expectReconciled(snap)
  })
})

describe('驱逐保护(T13:溢出优先淘汰离面/无源,在面 saving 绝不清)', () => {
  let ledger: SavingsLedger
  beforeEach(() => {
    ledger = new SavingsLedger()
  })

  it('850 条 offset 压力下,replacementSeq 在面的 saving 与净值毫发无损', () => {
    freshSaving(ledger) // rep=100, tokens=4200 exact
    ledger.observeActive('s1', new Set([100]))
    for (let i = 0; i < 850; i++) {
      ledger.recordOffset({ sessionId: 's1', component: 'retrieve', tokens: 10, basis: 'characters' })
    }
    const snap = ledger.snapshot('s1')
    expect(snap.gross.exact).toBe(CLAIM) // 活条目绝不清
    // cap 生效:1 条受保护 saving + 最多 799 条可驱逐 offset(FIFO)。
    expect(snap.offsets.estimated).toBe(799 * 10)
    expectReconciled(snap)
  })

  it('全列表都是在面 saving 时允许暂时超 cap,宁胀不误删', () => {
    const live = new Set<number>()
    for (let i = 0; i < 810; i++) {
      live.add(1_000 + i)
      ledger.recordSaving({
        sessionId: 's1',
        component: 'fresh',
        tokensBefore: 100,
        tokensAfter: 20,
        basis: 'exact-tokenizer',
        sourceSeq: i,
        replacementSeq: 1_000 + i,
      })
    }
    // 面信息未知(从未 observeActive)→ 保守保护,一条不丢
    expect(ledger.snapshot('s1').gross.exact).toBe(810 * 80)
    // 面上确认后依然全在面 → 仍不驱逐
    ledger.observeActive('s1', live)
    expect(ledger.snapshot('s1').gross.exact).toBe(810 * 80)
    // 全部离面后下轮溢出写入才恢复 FIFO 驱逐
    ledger.observeActive('s1', new Set([2_000]))
    for (let i = 0; i < 20; i++) {
      ledger.recordOffset({ sessionId: 's1', component: 'retrieve', tokens: 1, basis: 'characters' })
    }
    const snap = ledger.snapshot('s1')
    expect(snap.gross.exact).toBe(0) // 离面条目随收敛扣除(非驱逐路径)
    expect(snap.offsets.estimated).toBeLessThanOrEqual(20)
    expectReconciled(snap)
  })

  it('离面的可追踪 saving 是可驱逐对象,溢出时最先腾位', () => {
    freshSaving(ledger) // rep=100 exact 4200
    ledger.observeActive('s1', new Set([100]))
    // 无源无追踪键的 saving(如 noteFullText 时代的播种)同样可驱逐
    ledger.recordSaving({ sessionId: 's1', component: 'dedupe', tokensBefore: 500, tokensAfter: 100, basis: 'characters', sourceSeq: 9 })
    for (let i = 0; i < 850; i++) {
      ledger.recordOffset({ sessionId: 's1', component: 'retrieve', tokens: 5, basis: 'characters' })
    }
    const snap = ledger.snapshot('s1')
    expect(snap.gross.exact).toBe(CLAIM) // 在面精确条目存活
    expect(snap.gross.estimated).toBe(0) // 无追踪键旧估算条目被驱逐腾位
    expect(snap.offsets.estimated).toBe(799 * 5)
    expectReconciled(snap)
  })
})

describe('三件套全链对账(T14:收敛→翻负→驱逐一条链走通)', () => {
  it('同一会话走完 land→full-read 收敛→retrieve 折叠翻负→压力驱逐,snapshot 自洽', () => {
    const ledger = new SavingsLedger()
    const original = 'payload line\n'.repeat(500)
    // 1) land:压缩 a=5000 → b=800(src 7, rep 100),登记原文配对
    ledger.recordSaving({
      sessionId: 'chain',
      component: 'fresh',
      tokensBefore: A,
      tokensAfter: B,
      basis: 'exact-tokenizer',
      sourceSeq: 7,
      replacementSeq: 100,
      originalText: original,
    })
    // 2) 全文重读(收敛路径):重读事件 40 在面 → 罚生效;出面 → 停罚回升
    ledger.noteFullText({ sessionId: 'chain', seq: 40, text: original, measure: () => ({ tokens: A, basis: 'exact-tokenizer' }) })
    ledger.observeActive('chain', new Set([100, 40]))
    expect(ledger.snapshot('chain').net.exact).toBe(-B)
    ledger.observeActive('chain', new Set([100]))
    expect(ledger.snapshot('chain').net.exact).toBe(CLAIM)
    // 3) retrieve 同 basis 折叠翻负:net → −b,分项现负效果骨架
    expect(ledger.foldRecall('chain', 7, A, 'exact-tokenizer')).toBe(true)
    const folded = ledger.snapshot('chain')
    expect(folded.net.exact).toBe(-B)
    expectReconciled(folded)
    // 4) 压力驱逐:850 条估算流水灌入,在面(折叠后)条目绝不清
    for (let i = 0; i < 850; i++) {
      ledger.recordOffset({ sessionId: 'chain', component: 'retrieve', tokens: 4, basis: 'characters' })
    }
    const pressured = ledger.snapshot('chain')
    expect(pressured.offsets.exact).toBe(B) // 折叠骨架存活(经 offsets 列计入)
    expect(pressured.net.exact).toBe(-B)
    expectReconciled(pressured)
    // 5) 全局快照 perSession 与单会话对账一致
    const global = ledger.snapshot()
    const row = global.perSession.find(r => r.sessionId === 'chain')
    expect(row?.net.exact).toBe(-B)
    expect(row?.net.estimated).toBe(pressured.net.estimated)
  })
})
