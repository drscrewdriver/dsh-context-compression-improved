/**
 * 压缩监控浮动球(FAB)客户端单测——骨架来自 pm `d29bcb1^` 撤下的
 * longtask-fab(计划 cci-monitor-fab task_3.1-3.4),数据层为注入依赖,
 * 本文件自断言消费侧行为。真实时钟 + initialDelayMs=1,不用假时钟
 * (jsdom × fake-timers 的 async advance 有已知坑)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initMonitorFab, type MonitorFabDeps, type MonitorSnapshotPayload } from '../src/client/monitor-fab.ts'

const FAB_ID = 'dsh-cci-monitor-fab'

function snapshotPatch(patch: Partial<MonitorSnapshotPayload> = {}): MonitorSnapshotPayload {
  // 单一来源纪律:Δ 三行只认 sessionTotals(DRS 投影下发);默认夹具与
  // 顶层 gross/offsets/net 同值,专测「无下发 = –」的用例显式置 undefined。
  const totals = {
    gross: { exact: 10_000, estimated: 0 },
    offsets: { exact: 1_200, estimated: 0 },
    net: { exact: 8_800, estimated: 0 },
  }
  return {
    ok: true,
    startedAt: new Date().toISOString(),
    gross: { exact: 10_000, estimated: 0 },
    offsets: { exact: 1_200, estimated: 0 },
    net: { exact: 8_800, estimated: 0 },
    sessionTotals: totals,
    usage: { requests: 5, cacheHitRate: 0.812 },
    pricing: { currency: 'USD', actualCost: '0.12', estimatedSavedCost: '1.30' },
    intent: { override: undefined, observedEnabled: false, gate: { floorFraction: 0.45, growthTokens: 50_000 }, lastFold: undefined },
    recentOffsets: [{ component: 'fresh', tokens: 1_200 }],
    sessionScope: null,
    ...patch,
  }
}

function makeDeps(patch: Partial<MonitorFabDeps> & { snapshots?: MonitorSnapshotPayload[] } = {}): MonitorFabDeps & {
  snapshots: MonitorSnapshotPayload[]
  overrides: Array<{ sessionId: string | undefined, action: 'on' | 'off' | 'clear' }>
} {
  const deps: MonitorFabDeps & {
    snapshots: MonitorSnapshotPayload[]
    overrides: Array<{ sessionId: string | undefined, action: 'on' | 'off' | 'clear' }>
  } = {
    t: (key: string) => key,
    sessionIdOf: () => undefined,
    enabledOf: () => true,
    fetchSnapshot: vi.fn(async () => deps.snapshots[deps.snapshots.length - 1]!),
    applyOverride: vi.fn(async (_sessionId: string | undefined, action: 'on' | 'off' | 'clear') => {
      deps.overrides.push({ sessionId: undefined, action })
    }),
    snapshots: [snapshotPatch()],
    overrides: [],
    initialDelayMs: 1,
  }
  return Object.assign(deps, patch)
}

/** 真实时钟下等条件成立(轮询 1ms 一轮,上限 500ms)。 */
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('monitor fab (body-level overlay)', () => {
  it('mounts idempotently — double init keeps a single FAB', () => {
    const deps = makeDeps()
    initMonitorFab(deps)
    initMonitorFab(deps)
    expect(document.querySelectorAll(`#${FAB_ID}`).length).toBe(1)
  })

  it('enabled gate hides the ball and suppresses polling', async () => {
    const fetchSnapshot = vi.fn(async () => snapshotPatch())
    initMonitorFab(makeDeps({ enabledOf: () => false, fetchSnapshot, initialDelayMs: 5 }))
    const fab = document.getElementById(FAB_ID) as HTMLElement
    await waitFor(() => fab.style.display === 'none')
    expect(fetchSnapshot).not.toHaveBeenCalled()
  })

  it('enabled: ball visible, first tick renders the snapshot', async () => {
    initMonitorFab(makeDeps())
    const fab = document.getElementById(FAB_ID) as HTMLElement
    await waitFor(() => fab.style.display === 'block')
    const net = document.querySelector('[data-net]') as HTMLElement
    expect(net.textContent).toBe('8,800')
    expect(fab.classList.contains('lit')).toBe(false)
  })

  it('negative net lights the ball (负节省警示)', async () => {
    initMonitorFab(makeDeps({ snapshots: [snapshotPatch({
      sessionTotals: { gross: { exact: 0, estimated: 0 }, offsets: { exact: 0, estimated: 0 }, net: { exact: -800, estimated: 0 } },
    })] }))
    await waitFor(() => (document.getElementById(FAB_ID) as HTMLElement).classList.contains('lit'))
  })

  it('单一来源:无 sessionTotals 下发时三行显示 –,不回退 live 账本', async () => {
    const snapshot = snapshotPatch()
    delete (snapshot as { sessionTotals?: unknown }).sessionTotals
    initMonitorFab(makeDeps({ snapshots: [snapshot] }))
    await waitFor(() => (document.querySelector('[data-net]') as HTMLElement | null)?.textContent === '–')
    expect((document.querySelector('[data-gross]') as HTMLElement).textContent).toBe('–')
    expect((document.querySelector('[data-offsets]') as HTMLElement).textContent).toBe('–')
  })

  it('fetch failure flips the stale marker without throwing', async () => {
    initMonitorFab(makeDeps({ fetchSnapshot: vi.fn(async () => { throw new Error('down') }) }))
    await waitFor(() => document.querySelector('[data-stale]')?.classList.contains('show') === true)
  })

  it('override buttons drive applyOverride then refetch', async () => {
    const deps = makeDeps()
    initMonitorFab(deps)
    await waitFor(() => (document.querySelector('[data-overoff]') as HTMLButtonElement)?.disabled === false)
    ;(document.querySelector('[data-overoff]') as HTMLButtonElement).click()
    await waitFor(() => deps.overrides.length === 1)
    expect(deps.overrides).toEqual([{ sessionId: undefined, action: 'off' }])
    await waitFor(() => (deps.fetchSnapshot as ReturnType<typeof vi.fn>).mock.calls.length >= 2)
  })

  it('灾难性遗忘区建议:点亮悬浮球并展示提示行', async () => {
    const deps = makeDeps({
      snapshots: [snapshotPatch({
        net: { exact: 0, estimated: 0 },
        context: { liveTokens: 90_000, contextWindow: 100_000, pct: 0.9 },
        suggestion: { suggest: true, thresholdPct: 0.7, occupancyPct: 0.9 },
      })],
    })
    initMonitorFab(deps)
    await waitFor(() => (document.getElementById(FAB_ID) as HTMLElement).classList.contains('lit'))
    const hint = document.querySelector('[data-hint]') as HTMLElement
    expect(hint.classList.contains('show')).toBe(true)
    expect(hint.textContent).toBe('monitor.panel.suggest')
  })

  it('无建议时提示行隐藏', async () => {
    initMonitorFab(makeDeps())
    await waitFor(() => (document.querySelector('[data-net]') as HTMLElement).textContent !== '')
    expect(document.querySelector('[data-hint]')?.classList.contains('show')).toBe(false)
  })

  it('无抵消记录：recent 行整行隐藏，不再打「尚无压缩记录」误导空态（与组成块矛盾）', async () => {
    initMonitorFab(makeDeps({ snapshots: [snapshotPatch({ recentOffsets: [] })] }))
    await waitFor(() => (document.querySelector('[data-recent]') as HTMLElement | null)?.style.display === 'none')
    expect((document.querySelector('[data-recent]') as HTMLElement).textContent).toBe('')
  })

  it('有抵消记录：recent 行显示 component: tokens', async () => {
    initMonitorFab(makeDeps())
    const el = () => document.querySelector('[data-recent]') as HTMLElement | null
    await waitFor(() => el()?.textContent === 'fresh: 1,200')
    expect(el()?.style.display).toBe('')
  })

  it('浮窗只带当前会话:组成渲染+回填改名+est 规则;生命周期/累计行不存在', async () => {
    initMonitorFab(makeDeps({ snapshots: [snapshotPatch({
      // 服务端 mergeCompositionByComponent 已按路径合并后的形态(合并本身归
      // runtime monitor.spec 管;此处验消费侧行:改名/est 标)
      composition: [
        { component: 'projection', basis: 'mixed', tokens: 303_698, events: 38 },
        { component: 'fresh', basis: 'exact-tokenizer', tokens: 5_000, events: 2 },
      ],
      compositionSession: 'session-33a1d45f-6b3a-40d7-ab0e-373b867bf7d7',
      sessionTotals: { gross: { exact: 310_698, estimated: 0 }, offsets: { exact: 0, estimated: 0 }, net: { exact: 303_698, estimated: 0 } },
    })] }))
    await waitFor(() => (document.querySelector('[data-compwrap]') as HTMLElement)?.style.display === '')
    // Δ 三行优先会话持久口径(sessionTotals),回退 live
    expect((document.querySelector('[data-net]') as HTMLElement).textContent).toBe('303,698')
    expect((document.querySelector('[data-gross]') as HTMLElement).textContent).toBe('310,698')
    // 组成归属会话回带显示(短 id),防止陈旧绑定冒充当前会话
    expect((document.querySelector('[data-compscope]') as HTMLElement).textContent).toBe('monitor.panel.compositionScope 33a1d45f')
    // 全部会话/生命周期的行刻意不上浮窗:总三行 + 累计/省钱都不存在
    expect(document.querySelector('[data-totalnet]')).toBeNull()
    expect(document.querySelector('[data-totalgross]')).toBeNull()
    expect(document.querySelector('[data-totaloff]')).toBeNull()
    expect(document.querySelector('[data-cumul]')).toBeNull()
    expect(document.querySelector('[data-money]')).toBeNull()
    const comp = (document.querySelector('[data-comp]') as HTMLElement).textContent ?? ''
    // 回填投影如实改名(mixed 含精确成分不打 est)
    expect(comp).toContain('monitor.panel.compositionBackfill(projection): +303,698 · 38×')
    expect(comp).toContain('+5,000 · 2×')
  })

  it('「汇总 · Δ最后」两段式:账本有记录三行带 Δ 段(净行取更晚一条),无记录只显汇总', async () => {
    initMonitorFab(makeDeps({
      snapshots: [snapshotPatch({
        sessionTotals: { gross: { exact: 10_000, estimated: 0 }, offsets: { exact: 80, estimated: 0 }, net: { exact: 9_920, estimated: 0 } },
        lastDelta: { saving: { tokens: 400, seq: 12 }, offset: { tokens: 80, seq: 10 } },
      })],
    }))
    await waitFor(() => (document.querySelector('[data-net]') as HTMLElement | null)?.textContent?.includes('Δ') ?? false)
    // 净行 Δ 取账本更晚一条(saving seq12 > offset seq10)→ 带符号 +400
    expect((document.querySelector('[data-net]') as HTMLElement).textContent).toBe('9,920 · Δ+400')
    expect((document.querySelector('[data-gross]') as HTMLElement).textContent).toBe('10,000 · Δ+400')
    expect((document.querySelector('[data-offsets]') as HTMLElement).textContent).toBe('-80 · Δ-80')
    // 账本无 lastDelta:只显汇总,不伪造 Δ 段
    document.body.innerHTML = ''
    localStorage.clear()
    initMonitorFab(makeDeps({ snapshots: [snapshotPatch()] }))
    await waitFor(() => (document.querySelector('[data-net]') as HTMLElement | null)?.textContent === '8,800')
    expect((document.querySelector('[data-gross]') as HTMLElement).textContent).toBe('10,000')
    expect((document.querySelector('[data-offsets]') as HTMLElement).textContent).toBe('-1,200')
  })

  it('position persists across drag-free re-init via localStorage', () => {
    localStorage.setItem('dsh.cci.monitor.pos', JSON.stringify({ x: 40, y: 60 }))
    initMonitorFab(makeDeps())
    const fab = document.getElementById(FAB_ID) as HTMLElement
    expect(fab.style.left).toBe('40px')
    expect(fab.style.top).toBe('60px')
  })
})
