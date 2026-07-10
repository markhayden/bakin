/**
 * Tests for the generic doctor repair dialog (layered-context spec, C10).
 *
 * Coverage:
 *   - plan fetch on open; safe items pre-selected, destructive items not
 *   - apply posts explicit itemIds; allowDestructive only when a
 *     destructive item was ticked by hand
 *   - results render applied/skipped + verification summary
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '../../rtl-settle'

// Pure-UI test (all fetches mocked) — content-dir/OpenClaw mocks are the
// CLAUDE.md-mandated belt-and-suspenders so no transitive import can ever
// touch real ~/.bakin or ~/.openclaw.
const testDir = join(tmpdir(), `bakin-test-repair-dialog-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { RepairDialog } from '../../../plugins/health/components/repair-dialog'

const PLAN = {
  items: [
    {
      id: 'team.agent-sync.local',
      checkId: 'agent-sync',
      healthCheckId: 'team.agent-sync',
      checkName: 'Agent sync',
      title: 'Sync agents locally',
      reason: '2 stale blocks',
      safety: 'safe',
      requiresConfirmation: false,
      changes: [{ kind: 'runtime', target: 'pixel', action: 'update', description: 'Recompose blocks' }],
    },
    {
      id: 'team.agent-sync.migrate',
      checkId: 'agent-sync',
      healthCheckId: 'team.agent-sync',
      checkName: 'Agent sync',
      title: 'Run the one-time block migration',
      reason: 'Legacy package shapes',
      safety: 'destructive',
      requiresConfirmation: true,
      changes: [{ kind: 'runtime', target: 'pixel', action: 'update', description: 'Overwrite workspace files' }],
    },
  ],
  errors: [],
  summary: { totalItems: 2, safeItems: 1 },
}

const APPLY = {
  status: 'applied',
  applied: [
    { id: 'team.agent-sync.local', checkId: 'agent-sync', status: 'applied', message: 'Synced 2 agents locally.' },
  ],
  skipped: [],
  errors: [],
  verification: [{ check: 'agent-sync', status: 'ok', message: 'in sync' }],
}

let fetchCalls: Array<{ url: string; init?: RequestInit }> = []

beforeEach(() => {
  cleanup()
  fetchCalls = []
  global.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init })
    if (String(url).endsWith('/repair/plan')) {
      return { ok: true, json: async () => PLAN } as Response
    }
    if (String(url).endsWith('/repair/apply')) {
      return { ok: true, json: async () => APPLY } as Response
    }
    return { ok: false, json: async () => ({}) } as Response
  }) as unknown as typeof global.fetch
})

describe('RepairDialog', () => {
  it('plans on open with safe items pre-selected and destructive items unticked', async () => {
    render(<RepairDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Sync agents locally')).toBeDefined())

    const safeBox = screen.getByLabelText('Select repair: Sync agents locally') as HTMLInputElement
    const destructiveBox = screen.getByLabelText('Select repair: Run the one-time block migration') as HTMLInputElement
    expect(safeBox.checked).toBe(true)
    expect(destructiveBox.checked).toBe(false)
    expect(screen.getByText('destructive')).toBeDefined()
  })

  it('applies selected safe items without allowDestructive', async () => {
    render(<RepairDialog open onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Sync agents locally')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 repair' }))
    await waitFor(() => expect(screen.getByText(/Synced 2 agents locally/)).toBeDefined())

    const applyCall = fetchCalls.find((c) => c.url.endsWith('/repair/apply'))!
    const body = JSON.parse(String(applyCall.init?.body))
    expect(body).toEqual({ accepted: true, itemIds: ['team.agent-sync.local'], allowDestructive: false })
    expect(screen.getByText(/Verification: 1\/1 checks clean/)).toBeDefined()
  })

  it('sends allowDestructive only after the destructive item is ticked by hand', async () => {
    const onApplied = mock(() => {})
    render(<RepairDialog open onOpenChange={() => {}} onApplied={onApplied} />)
    await waitFor(() => expect(screen.getByText('Run the one-time block migration')).toBeDefined())

    fireEvent.click(screen.getByLabelText('Select repair: Run the one-time block migration'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 (incl. destructive)' }))
    await waitFor(() => expect(fetchCalls.some((c) => c.url.endsWith('/repair/apply'))).toBe(true))

    const body = JSON.parse(String(fetchCalls.find((c) => c.url.endsWith('/repair/apply'))!.init?.body))
    expect(body.allowDestructive).toBe(true)
    expect(new Set(body.itemIds)).toEqual(new Set(['team.agent-sync.local', 'team.agent-sync.migrate']))
    await waitFor(() => expect(onApplied).toHaveBeenCalled())
  })
})
