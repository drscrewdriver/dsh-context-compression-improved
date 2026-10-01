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
  return {
    ok: true,
    startedAt: new Date().toISOString(),
    gross: { exact: 10_000, estimated: 0 },
    offsets: { exact: 1_200, estimated: 0 },
    net: { exact: 8_800, estimated: 0 },
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
    initMonitorFab(makeDeps({ snapshots: [snapshotPatch({ net: { exact: -800, estimated: 0 } })] }))
    await waitFor(() => (document.getElementById(FAB_ID) as HTMLElement).classList.contains('lit'))
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

  it('position persists across drag-free re-init via localStorage', () => {
    localStorage.setItem('dsh.cci.monitor.pos', JSON.stringify({ x: 40, y: 60 }))
    initMonitorFab(makeDeps())
    const fab = document.getElementById(FAB_ID) as HTMLElement
    expect(fab.style.left).toBe('40px')
    expect(fab.style.top).toBe('60px')
  })
})
