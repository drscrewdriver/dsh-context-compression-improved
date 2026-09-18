// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewOverlay } from '../src/client/ReviewOverlay.tsx'
import type { SettingsScopeLike } from '../src/client/review-scope.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const QUEUE_ROUTE = '/api/dsh-context-compression-improved/review-queue'
const DECIDE_ROUTE = '/api/dsh-context-compression-improved/review-decide'

const PROPOSAL = {
  sessionId: 's1',
  id: 'abc123def456',
  kind: 'read-state',
  items: [{ seq: 6, tokensBefore: 2401, tokensAfter: 134 }],
  benefit: { recoveredTokens: 400, paybackTurns: 2.25, expectedSaving: 312 },
}

function scopeStub(reviewMode: boolean): SettingsScopeLike {
  return {
    getSnapshot: () => ({
      status: 'ready',
      value: { presetOptions: { reviewMode } },
    }),
    subscribe: () => () => {},
  }
}

type FetchCall = { input: string | URL | Request, init?: RequestInit | undefined }

function stubFetch(responses: Array<{ match: (input: string) => boolean, body: unknown, status?: number }>): {
  calls: FetchCall[]
} {
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init })
    const url = String(input)
    const match = responses.find(entry => entry.match(url))
    return {
      ok: (match?.status ?? 200) < 400,
      status: match?.status ?? 200,
      json: async () => match?.body,
    } as Response
  }))
  return { calls }
}

const queueBody = {
  ok: true,
  total: 1,
  pending: [PROPOSAL],
  summary: { autoApplied: 2, reviewApplied: 1, expired: 3, voided: 0 },
}

describe('review overlay (client)', () => {
  it('renders the pending list and the four-state summary row', async () => {
    stubFetch([{ match: url => url.includes(QUEUE_ROUTE), body: queueBody }])
    render(<ReviewOverlay scope={scopeStub(true)} t={key => key} />)

    await waitFor(() => { expect(screen.getByText('review.badge 1')).toBeDefined() })
    fireEvent.click(screen.getByText('review.badge 1'))
    expect(screen.getByText('review.title')).toBeDefined()
    expect(screen.getByText(/review.summary.autoApplied: 2/)).toBeDefined()
    expect(screen.getByText(/review.summary.expired: 3/)).toBeDefined()
    // Estimated saving is labelled as an estimate.
    expect(screen.getByText(/review.row.estimated/)).toBeDefined()
  })

  it('posts the three decisions through the decide route and refreshes', async () => {
    const { calls } = stubFetch([
      { match: url => url.includes(QUEUE_ROUTE), body: queueBody },
      { match: url => url.includes(DECIDE_ROUTE), body: { ok: true } },
    ])
    render(<ReviewOverlay scope={scopeStub(true)} t={key => key} />)
    await waitFor(() => { expect(screen.getByText('review.badge 1')).toBeDefined() })
    fireEvent.click(screen.getByText('review.badge 1'))

    fireEvent.click(screen.getByText('review.action.approve'))
    await waitFor(() => {
      expect(calls.some(call => String(call.input) === DECIDE_ROUTE && call.init?.method === 'POST')).toBe(true)
    })
    const posted = JSON.parse(String(calls.find(call => call.init?.method === 'POST')?.init?.body))
    expect(posted).toEqual({ sessionId: 's1', proposalId: 'abc123def456', decision: 'approved' })

    fireEvent.click(screen.getByText('review.action.reject'))
    await waitFor(() => {
      expect(calls.some(call => String(call.input) === DECIDE_ROUTE
        && JSON.parse(String(call.init?.body)).decision === 'rejected')).toBe(true)
    })
    fireEvent.click(screen.getByText('review.action.ignore'))
    await waitFor(() => {
      expect(calls.some(call => String(call.input) === DECIDE_ROUTE
        && JSON.parse(String(call.init?.body)).decision === 'ignored')).toBe(true)
    })
  })

  it('renders nothing while nothing is pending', async () => {
    stubFetch([{ match: url => url.includes(QUEUE_ROUTE), body: { ok: true, total: 0, pending: [] } }])
    const { container } = render(<ReviewOverlay scope={scopeStub(true)} t={key => key} />)
    await waitFor(() => {
      expect((container.querySelector('.dsh-cc-review-badge'))).toBeNull()
    })
  })

  it('renders nothing while review mode is off', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<ReviewOverlay scope={scopeStub(false)} t={key => key} />)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(container.querySelector('.dsh-cc-review-badge')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
