// @vitest-environment jsdom
/**
 * DiagnosticsTab (#385) — drift panel (scan findings + sync), context budget
 * panel (meter + sections + workspace), timeline panel (runs + events), and
 * the attention chips derivation.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-diagnostics-tab-unused',
  getBakinPaths: () => ({ home: '/tmp/bakin-test-diagnostics-tab-unused' }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

mock.module('@makinbakin/sdk/components', () => ({
  Sparkline: ({ label }: { label: string }) => <svg aria-label={label} />,
  ChartExplainer: ({ children }: { children: ReactNode }) => <p role="note">{children}</p>,
}))

import { DiagnosticsTab, DiagnosticsChipsView } from '../../../plugins/team/components/diagnostics-tab'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}

const ROUTES: Record<string, unknown> = {
  '/api/agent-packages/pixel/scan': {
    ok: true,
    packageId: 'pixel',
    scannedAt: '2026-07-05T00:00:00Z',
    findings: [{
      type: 'block-stale',
      severity: 'warn',
      autoFixable: true,
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

afterEach(cleanup)

describe('DiagnosticsTab', () => {
  it('renders all three panels from their endpoints', async () => {
    stubFetch()
    render(<DiagnosticsTab agentId="pixel" />)

    // Drift panel: finding + attribution + receipt line
    expect(await screen.findByText('block-stale')).toBeDefined()
    expect(screen.getByText(/Changed inputs:/)).toBeDefined()
    expect(screen.getByText(/verification ok/)).toBeDefined()

    // Context panel: over-budget meter (80000 > 65536) + sections + managed bytes
    await waitFor(() => expect(screen.getByText('over budget')).toBeDefined())
    expect(screen.getByText('identity-block')).toBeDefined()
    expect(screen.getByText(/managed\)/)).toBeDefined()

    // Timeline panel: run row + warn event
    expect(await screen.findByText('resize hero images')).toBeDefined()
    expect(screen.getByText(/turn-ok/)).toBeDefined()
    expect(screen.getByText(/Bypass detected/)).toBeDefined()
    expect(screen.getByText(/1 progress log line/)).toBeDefined()
  })

  it('Sync now posts to the sync endpoint and rescans', async () => {
    const fetchMock = stubFetch()
    render(<DiagnosticsTab agentId="pixel" />)
    const syncButton = await screen.findByRole('button', { name: /Sync now/ })
    fireEvent.click(syncButton)
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => [c[0], (c[1] as RequestInit | undefined)?.method ?? 'GET'])
      expect(calls.some(([url, method]) => url === '/api/agent-packages/pixel/sync' && method === 'POST')).toBe(true)
    })
  })
})

describe('DiagnosticsChipsView', () => {
  it('renders flagged and ok chips', () => {
    render(
      <DiagnosticsChipsView
        attention={{ loaded: true, drift: true, context: false, burn: false }}
        onOpen={() => {}}
      />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons[0]!.textContent).toContain('Drift')
    expect(buttons[0]!.textContent).toContain('⚠')
    expect(buttons[1]!.textContent).toContain('ok')
  })
})
