// @vitest-environment jsdom
/**
 * DiagnosticsTab (#385) — drift panel (scan findings + sync), context budget
 * panel (meter + sections + workspace), timeline panel (runs + events), and
 * the attention chips derivation.
 */
import { describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import '../../rtl-settle'
import { actRender } from '../../rtl-settle'
import type { ReactNode } from 'react'
import { TEAM_ATTENTION_HEALTH_REPORT } from './health-report-fixture'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-diagnostics-tab-unused',
  getBakinPaths: () => ({ home: '/tmp/bakin-test-diagnostics-tab-unused' }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

mock.module('@makinbakin/sdk/charts', () => ({
  Sparkline: ({ label }: { label: string }) => <svg aria-label={label} />,
  ChartExplainer: ({ children }: { children: ReactNode }) => <p role="note">{children}</p>,
}))

import { DiagnosticsTab, DiagnosticsChipsView, useAgentAttention } from '../../../plugins/team/components/diagnostics-tab'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: 'request failed' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ROUTES: Record<string, unknown> = {
  '/api/plugins/health/doctor': TEAM_ATTENTION_HEALTH_REPORT,
  '/api/agent-packages/pixel/scan': {
    ok: true,
    packageId: 'pixel',
    scannedAt: '2026-07-05T00:00:00Z',
    findings: [{
      type: 'block-stale',
      severity: 'warn',
      message: 'pixel/AGENTS.md managed block is stale (changed: in-place-edit)',
      agentId: 'pixel',
      file: 'AGENTS.md',
      staleInputs: ['in-place-edit'],
    }],
  },
  '/api/agent-packages/pixel/receipt': {
    ok: true,
    receipt: { agentId: 'pixel', syncedAt: '2026-07-04T00:00:00Z', checkOnly: false, verification: { status: 'ok' } },
  },
  '/api/context-report/pixel': {
    ok: true,
    report: {
      dispatch: {
        task: { sections: [{ source: 'identity-block', bytes: 20_000, approxTokens: 5000 }], totalBytes: 20_000 },
        workflow: { totalBytes: 25_000 },
        dynamicCaps: [{ source: 'lessons', maxBytes: 8000, setting: 'agentPackages.lessonsRetrieval.maxCharacters' }],
        estimatedMaxTaskBytes: 80_000,
      },
      workspace: {
        available: true,
        totalBytes: 40_960,
        files: [{ name: 'AGENTS.md', bytes: 10_240, kind: 'canonical', managedBlockBytes: 4_096 }],
      },
      observed: { label: 'observed', runs: [{ inputTokens: 40_000 }, { inputTokens: 42_000 }] },
    },
  },
  '/api/settings': { dispatch: { contextBudgetBytes: 65_536 } },
  '/api/plugins/team/pixel/timeline': {
    ok: true,
    agent: 'pixel',
    window: '24h',
    events: [
      {
        type: 'run', ts: 2000, runId: 'task:t1:d1', taskId: 't1', taskTitle: 'resize hero images', seq: 1,
        status: 'settled', settleReason: 'turn-ok', startedAt: 2000, settledAt: 194_000, durationMs: 192_000,
        model: 'sonnet-5', inputTokens: 41_000, outputTokens: 2_100, totalTokens: 43_100, costUsdMicros: 40_000,
        logs: [{ ts: '2026-07-05T00:00:10Z', message: 'starting' }], logsTruncated: false,
      },
      {
        type: 'event', ts: 2100, event: 'agent_pkg.lessons_retrieved', severity: 'info',
        message: 'Retrieved 1 lesson(s) for this dispatch', taskId: 't1',
      },
      { type: 'event', ts: 1000, event: 'task.bypass_detected', severity: 'warn', message: 'Bypass detected on t9', taskId: 't9' },
    ],
  },
}

function stubFetch() {
  const fetchMock = mock((url: string) => {
    for (const [prefix, body] of Object.entries(ROUTES)) {
      if (url.startsWith(prefix)) return Promise.resolve(jsonResponse(body))
    }
    return Promise.resolve(jsonResponse({}))
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}


describe('DiagnosticsTab', () => {
  it('renders all three panels from their endpoints', async () => {
    stubFetch()
    await act(async () => {
      render(<DiagnosticsTab agentId="pixel" />)
    })

    // Drift panel: finding + attribution + receipt line
    expect(await screen.findByText('Managed block out of date')).toBeDefined()
    expect(document.querySelector('[data-drift-checklist]')).toBeDefined()
    expect(document.querySelector('[data-drift-checkbox="incomplete"]')).toBeDefined()
    expect(screen.getByText(/Changed inputs:/)).toBeDefined()
    expect(screen.getByText(/verification ok/)).toBeDefined()

    // Context panel: over-budget meter (80000 > 65536) + sections + managed bytes
    await waitFor(() => expect(screen.getByText('over budget')).toBeDefined())
    expect(screen.getByText('identity-block')).toBeDefined()
    expect(screen.getByText(/managed\)/)).toBeDefined()

    // Timeline panel: run row + warn event
    expect(await screen.findByText('resize hero images')).toBeDefined()
    expect(screen.getByText('Completed')).toBeDefined()
    expect(screen.getByText('Duration')).toBeDefined()
    expect(screen.getByText(/Bypass detected/)).toBeDefined()
    expect(screen.getByText(/1 progress log line/)).toBeDefined()
  })

  it('nests related audit evidence inside its dispatch attempt and leaves unrelated events standalone', async () => {
    stubFetch()
    render(<DiagnosticsTab agentId="pixel" />)

    // Runs are entries in the kit Timeline feed now, not standalone articles:
    // the nesting contract is a run entry that CONTAINS its related events,
    // beside a sibling entry for the unrelated one.
    const feed = await screen.findByRole('list', { name: 'Dispatch activity' })
    const entries = within(feed).getAllByRole('listitem')
      .filter((entry) => entry.parentElement === feed)
    expect(entries).toHaveLength(2)

    const [run, standalone] = entries as [HTMLElement, HTMLElement]
    expect(run.textContent).toContain('resize hero images')
    expect(run.textContent).toContain('Attempt 1')
    // Related evidence lives inside the attempt that produced it...
    const nested = within(run).getByRole('list', { name: 'Events during attempt 1' })
    expect(nested.textContent).toContain('Retrieved 1 lesson(s) for this dispatch')
    // ...and an unrelated event stays its own top-level entry.
    expect(standalone.textContent).toContain('Bypass detected on t9')
    expect(within(standalone).queryByRole('list')).toBeNull()
  })

  it('Sync now posts to the sync endpoint and rescans', async () => {
    const fetchMock = stubFetch()
    await act(async () => {
      render(<DiagnosticsTab agentId="pixel" />)
    })
    const syncButton = await screen.findByRole('button', { name: /Sync now/ })
    await act(async () => { fireEvent.click(syncButton) })
    await waitFor(() => {
      const calls = (fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>).map(
        (c) => [c[0], c[1]?.method ?? 'GET'] as const,
      )
      expect(calls.some(([url, method]) => url === '/api/agent-packages/pixel/sync' && method === 'POST')).toBe(true)
    })
  })

  it('turns a hung drift scan into a retryable unavailable state', async () => {
    vi.useFakeTimers()
    try {
      globalThis.fetch = mock((url: string) => {
        if (url === '/api/agent-packages/pixel/scan') {
          // Deliberately ignore AbortSignal to prove the panel timeout itself
          // releases the UI even when a transport never settles.
          return new Promise<Response>(() => {})
        }
        for (const [prefix, body] of Object.entries(ROUTES)) {
          if (url.startsWith(prefix)) return Promise.resolve(jsonResponse(body))
        }
        return Promise.resolve(jsonResponse({}))
      }) as unknown as typeof fetch

      await act(async () => {
        render(<DiagnosticsTab agentId="pixel" />)
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

      expect(screen.getByText('Drift scan unavailable.')).toBeDefined()
      expect(screen.getByRole('button', { name: /Rescan/ }).hasAttribute('disabled')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts an obsolete drift scan and ignores it when the agent changes', async () => {
    let pixelSignal: AbortSignal | undefined
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      if (url === '/api/agent-packages/pixel/scan') {
        pixelSignal = init?.signal as AbortSignal | undefined
        return new Promise<Response>((_resolve, reject) => {
          pixelSignal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        })
      }
      if (url === '/api/agent-packages/enrich/scan') {
        return Promise.resolve(jsonResponse({
          ok: true,
          packageId: 'enrich',
          scannedAt: '2026-07-05T00:00:00Z',
          findings: [{
            type: 'block-stale',
            severity: 'warn',
            message: 'enrich drift marker',
            agentId: 'enrich',
            file: 'AGENTS.md',
          }],
        }))
      }
      if (url === '/api/agent-packages/enrich/receipt') {
        return Promise.resolve(jsonResponse({ ok: true }))
      }
      for (const [prefix, body] of Object.entries(ROUTES)) {
        if (url.startsWith(prefix)) return Promise.resolve(jsonResponse(body))
      }
      return Promise.resolve(jsonResponse({}))
    }) as unknown as typeof fetch

    let __view0!: ReturnType<typeof render>
    await act(async () => {
      __view0 = render(<DiagnosticsTab agentId="pixel" />)
    })
    const { rerender } = __view0
    await waitFor(() => expect(pixelSignal).toBeDefined())

    rerender(<DiagnosticsTab agentId="enrich" />)

    expect(pixelSignal?.aborted).toBe(true)
    expect(await screen.findByText('enrich drift marker')).toBeDefined()
    expect(screen.queryByText(/pixel\/AGENTS\.md managed block is stale/)).toBeNull()
  })

  it('replaces a failed timeline skeleton with an error and recovers on retry', async () => {
    let timelineAttempts = 0
    globalThis.fetch = mock((url: string) => {
      if (url.startsWith('/api/plugins/team/pixel/timeline')) {
        timelineAttempts += 1
        return Promise.resolve(timelineAttempts === 1
          ? errorResponse(503)
          : jsonResponse(ROUTES['/api/plugins/team/pixel/timeline']))
      }
      for (const [prefix, body] of Object.entries(ROUTES)) {
        if (url.startsWith(prefix)) return Promise.resolve(jsonResponse(body))
      }
      return Promise.resolve(jsonResponse({}))
    }) as unknown as typeof fetch

    await act(async () => {
      render(<DiagnosticsTab agentId="pixel" />)
    })

    expect(await screen.findByText('Activity timeline unavailable.')).toBeDefined()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry activity timeline' })) })

    expect(await screen.findByText('resize hero images')).toBeDefined()
    expect(timelineAttempts).toBe(2)
  })

  it('does not present a fallback context budget as configured and can retry settings', async () => {
    let settingsAttempts = 0
    globalThis.fetch = mock((url: string) => {
      if (url === '/api/settings') {
        settingsAttempts += 1
        return Promise.resolve(settingsAttempts === 1
          ? errorResponse(500)
          : jsonResponse(ROUTES['/api/settings']))
      }
      for (const [prefix, body] of Object.entries(ROUTES)) {
        if (url.startsWith(prefix)) return Promise.resolve(jsonResponse(body))
      }
      return Promise.resolve(jsonResponse({}))
    }) as unknown as typeof fetch

    await act(async () => {
      render(<DiagnosticsTab agentId="pixel" />)
    })

    expect(await screen.findByText('Configured budget unavailable.')).toBeDefined()
    expect(screen.queryByText(/of 64\.0 KiB budget/)).toBeNull()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry context budget' })) })
    await waitFor(() => {
      const progress = screen.getByRole('progressbar', { name: 'Estimated per-dispatch context' })
      expect(progress.getAttribute('aria-valuemax')).toBe('65536')
    })
    expect(settingsAttempts).toBe(2)
  })

  it('turns a hung context report into a retryable timeout', async () => {
    vi.useFakeTimers()
    try {
      globalThis.fetch = mock((url: string) => {
        if (url === '/api/context-report/pixel') return new Promise<Response>(() => {})
        for (const [prefix, body] of Object.entries(ROUTES)) {
          if (url.startsWith(prefix)) return Promise.resolve(jsonResponse(body))
        }
        return Promise.resolve(jsonResponse({}))
      }) as unknown as typeof fetch

      await act(async () => {
        render(<DiagnosticsTab agentId="pixel" />)
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

      expect(screen.getByText('Context report unavailable because the request timed out.')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Retry context report' })).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('turns a hung sync request into a visible retryable error', async () => {
    const baseFetch = stubFetch()
    globalThis.fetch = mock((url: string) => {
      if (url === '/api/agent-packages/pixel/sync') return new Promise<Response>(() => {})
      return baseFetch(url)
    }) as unknown as typeof fetch
    await act(async () => {
      render(<DiagnosticsTab agentId="pixel" />)
    })
    const sync = await screen.findByRole('button', { name: /Sync now/ })

    vi.useFakeTimers()
    try {
      await act(async () => { fireEvent.click(sync) })
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

      expect(screen.getByText('Sync timed out. Try again.')).toBeDefined()
      expect(sync.hasAttribute('disabled')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores an obsolete sync response after the selected agent changes', async () => {
    const baseFetch = stubFetch()
    let resolveSync!: (response: Response) => void
    globalThis.fetch = mock((url: string) => {
      if (url === '/api/agent-packages/pixel/sync') {
        return new Promise<Response>((resolve) => { resolveSync = resolve })
      }
      return baseFetch(url)
    }) as unknown as typeof fetch

    let __view1!: ReturnType<typeof render>
    await act(async () => {
      __view1 = render(<DiagnosticsTab agentId="pixel" />)
    })
    const view = __view1
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Sync now/ })) })
    await waitFor(() => expect(resolveSync).toBeDefined())

    view.rerender(<DiagnosticsTab agentId="enrich" />)
    await act(async () => { resolveSync(errorResponse(500)) })

    expect(screen.queryByText(/Sync could not be completed|Sync timed out|sync failed/)).toBeNull()
  })

  it('aborts an in-flight timeline request when the panel unmounts', async () => {
    let timelineSignal: AbortSignal | undefined
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/plugins/team/pixel/timeline')) {
        timelineSignal = init?.signal as AbortSignal | undefined
        return new Promise<Response>(() => {})
      }
      for (const [prefix, body] of Object.entries(ROUTES)) {
        if (url.startsWith(prefix)) return Promise.resolve(jsonResponse(body))
      }
      return Promise.resolve(jsonResponse({}))
    }) as unknown as typeof fetch

    let __view2!: ReturnType<typeof render>
    await act(async () => {
      __view2 = render(<DiagnosticsTab agentId="pixel" />)
    })
    const { unmount } = __view2
    await waitFor(() => expect(timelineSignal).toBeDefined())

    unmount()
    expect(timelineSignal?.aborted).toBe(true)
  })

  it('turns a hung timeline request into a retryable timeout instead of a permanent skeleton', async () => {
    vi.useFakeTimers()
    try {
      globalThis.fetch = mock((url: string, init?: RequestInit) => {
        if (url.startsWith('/api/plugins/team/pixel/timeline')) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            })
          })
        }
        for (const [prefix, body] of Object.entries(ROUTES)) {
          if (url.startsWith(prefix)) return Promise.resolve(jsonResponse(body))
        }
        return Promise.resolve(jsonResponse({}))
      }) as unknown as typeof fetch

      await act(async () => {
        render(<DiagnosticsTab agentId="pixel" />)
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })

      expect(screen.getByText('Activity timeline unavailable.')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Retry activity timeline' })).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('DiagnosticsChipsView', () => {
  it('derives flags from canonical incident resources and observation check IDs', async () => {
    const fetchMock = stubFetch()
    const { result } = await actRender(() => renderHook(() => useAgentAttention('pixel')))

    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current).toEqual({ loaded: true, drift: true, context: true, burn: false })
    expect(fetchMock.mock.calls.some((call: unknown[]) => String(call[0]).startsWith('/api/plugins/health/doctor'))).toBe(true)
  })

  it('renders flagged and ok chips', async () => {
    await act(async () => {
      render(
        <DiagnosticsChipsView
          attention={{ loaded: true, drift: true, context: false, burn: false }}
          onOpen={() => {}}
        />,
      )
    })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    // State now reads as a StatusBadge rather than concatenated onto a button
    // label, so it is sentence-cased like every other status chip.
    expect(buttons[0]!.textContent).toContain('Drift')
    expect(buttons[0]!.textContent).toContain('Needs attention')
    expect(buttons[1]!.textContent).toContain('OK')
  })
})
