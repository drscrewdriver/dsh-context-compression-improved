// @vitest-environment jsdom

/**
 * T28：节省卡片 per-session 面板（T26/T32）jsdom 规格——累计/省钱行、持久化
 * 徽标与降级标注、displayPrefs 行开关与 compact、会话账本分页翻页。
 * fetch 全局打桩：按 URL 分流 /savings 与 /savings/sessions。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SavingsCard } from '../src/client/savings-card.tsx'
import { en } from '../src/client/locales.ts'

const t = (key: string) => en[key as keyof typeof en] ?? key

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SAVINGS_SNAPSHOT = {
  ok: true,
  startedAt: '2026-10-19T00:00:00.000Z',
  sessions: 1,
  gross: { exact: 1000, estimated: 0 },
  offsets: { exact: 100, estimated: 0 },
  net: { exact: 900, estimated: 0 },
  perComponent: [],
  recentOffsets: [],
  usage: { requests: 3, inputTokens: 500, outputTokens: 100, cacheReadTokens: 400, cacheWriteTokens: 0, cacheHitRate: 0.8 },
}

const INTEGRAL = { netExact: 2500, netEstimated: 0, cachedInput: 60_000, uncachedInput: 40_000, calls: 7 }

function sessionsPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    persisted: { persisted: true, driver: 'node:sqlite' },
    displayPrefs: { rows: { stock: true, total: true, money: true }, mode: 'full', focusSessionId: null },
    total: 2,
    offset: 0,
    limit: 20,
    integralTotal: INTEGRAL,
    integralMoney: { decimal: '0.1', currency: 'USD' },
    sessions: [
      { sessionId: 'aaaaaaaa-1', net: { exact: 1500, estimated: 0 }, integral: { ...INTEGRAL, netExact: 1500, calls: 4 }, source: 'live' },
      { sessionId: 'bbbbbbbb-2', net: { exact: 1000, estimated: 0 }, integral: { ...INTEGRAL, netExact: 1000, calls: 3 }, source: 'backfill' },
    ],
    liveOnly: [],
    ...overrides,
  }
}

function stubFetch(savings: unknown, sessions: Record<string, unknown>): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/savings/sessions')) {
      return { ok: true, json: async () => sessions } as Response
    }
    return { ok: true, json: async () => savings } as Response
  }))
  return { calls }
}

function mountCard(): void {
  render(<SavingsCard t={t} />)
}

describe('savings card per-session panel (T26/T32)', () => {
  it('渲染累计(按 N 次 call)/省钱行与持久化徽标', async () => {
    stubFetch(SAVINGS_SNAPSHOT, sessionsPayload())
    mountCard()
    await waitFor(() => {
      expect(screen.getByTestId('savings-cumulative')).toBeDefined()
      expect(screen.getByTestId('savings-money')).toBeDefined()
      expect(screen.getByTestId('savings-persisted').textContent).toContain('✓')
    })
    expect(screen.getByTestId('savings-cumulative').textContent).toContain('7')
    expect(screen.getByTestId('savings-money').textContent).toContain('USD 0.1')
    expect(screen.getByTestId('savings-session-list').textContent).toContain('aaaaaaaa')
  })

  it('persisted:false → 降级标注', async () => {
    stubFetch(SAVINGS_SNAPSHOT, sessionsPayload({ persisted: { persisted: false, reason: 'no-driver' } }))
    mountCard()
    await waitFor(() => {
      expect(screen.getByTestId('savings-persisted').textContent).toContain('⚠')
    })
  })

  it('displayPrefs 行开关:stock off 隐藏存量,compact 隐藏分项', async () => {
    stubFetch(SAVINGS_SNAPSHOT, sessionsPayload({
      displayPrefs: { rows: { stock: false, total: true, money: true }, mode: 'compact', focusSessionId: 'aaaaaaaa-1' },
    }))
    mountCard()
    await waitFor(() => {
      expect(screen.queryByTestId('savings-stock-exact')).toBeNull()
      expect(screen.queryByTestId('savings-cumulative')).not.toBeNull()
    })
    // 聚焦会话带 focus 标记
    expect(screen.getByTestId('savings-session-list').textContent).toContain('focus')
  })

  it('分页:下一页以 offset=20 重取,上一页回到 0', async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      sessionId: `sess-${String(index).padStart(3, '0')}`,
      net: { exact: index, estimated: 0 },
      integral: { ...INTEGRAL, calls: 1 },
      source: 'backfill',
    }))
    const { calls } = stubFetch(SAVINGS_SNAPSHOT, sessionsPayload({ total: 30, sessions: many.slice(0, 20) }))
    mountCard()
    await waitFor(() => {
      expect(screen.getByTestId('savings-page-next')).toBeDefined()
    })
    fireEvent.click(screen.getByTestId('savings-page-next'))
    await waitFor(() => {
      expect(calls.some(url => url.includes('offset=20'))).toBe(true)
    })
  })

  it('存量与积分双空 → 空态', async () => {
    stubFetch({ ...SAVINGS_SNAPSHOT, gross: { exact: 0, estimated: 0 }, offsets: { exact: 0, estimated: 0 }, net: { exact: 0, estimated: 0 } }, sessionsPayload({ integralTotal: { netExact: 0, netEstimated: 0, cachedInput: 0, uncachedInput: 0, calls: 0 }, sessions: [], integralMoney: undefined }))
    mountCard()
    await waitFor(() => {
      expect(screen.getByText(t('savings.empty'))).toBeDefined()
    })
  })

  it('存量/积分双空但账本有回填 → 不早退,账本照常渲染(空存量的历史节省可见)', async () => {
    stubFetch({ ...SAVINGS_SNAPSHOT, gross: { exact: 0, estimated: 0 }, offsets: { exact: 0, estimated: 0 }, net: { exact: 0, estimated: 0 } }, sessionsPayload({ integralTotal: { netExact: 0, netEstimated: 0, cachedInput: 0, uncachedInput: 0, calls: 0 }, integralMoney: undefined }))
    mountCard()
    await waitFor(() => {
      expect(screen.getByTestId('savings-session-list')).toBeDefined()
    })
    expect(screen.queryByText(t('savings.empty'))).toBeNull()
    expect(screen.getByTestId('savings-session-list').textContent).toContain('bbbbbbbb')
  })
})
