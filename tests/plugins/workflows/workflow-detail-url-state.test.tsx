// @vitest-environment jsdom
/**
 * `?step=` is the step drawer's open state on /workflows/$id (spec
 * settings-url-state, Phase 2 rules 1–2 + 4).
 *
 * Before: the selected step and the drawer's open flag lived in useState —
 * a step could not be linked, refreshed into, or closed with Back. Now a
 * canvas node click PUSHES `?step=<nodeId>` (Back closes), closing the
 * drawer REPLACES it away, and a stale id leaves the drawer closed WITHOUT
 * rewriting the URL (no producer links to a step yet, so no alert).
 *
 * The real page runs over the router shim with a stable spy navigate; the
 * canvas and drawer are stubbed to capture their props so selection is
 * driven through `onNodeClick` and close through `onOpenChange`.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { settleFor } from '../../helpers/wait'

const testDir = join(tmpdir(), `bakin-test-workflow-detail-url-state-${Date.now()}`)
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/task-store', () => ({
  createTask: mock(), addTaskLog: mock(), moveTask: mock(),
  readTaskboard: mock(() => ({ columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] } })),
  getTask: mock(() => null), getTaskWithColumn: mock(() => null),
}))

const workflowCanvasCalls: Array<Record<string, unknown>> = []
const stepDetailDrawerCalls: Array<Record<string, unknown>> = []
mock.module('../../../plugins/workflows/components/workflow-canvas', () => ({
  WorkflowCanvas: (props: Record<string, unknown>) => {
    workflowCanvasCalls.push(props)
    return <div data-testid="workflow-canvas" />
  },
}))
mock.module('../../../plugins/workflows/components/step-detail-drawer', () => ({
  StepDetailDrawer: (props: Record<string, unknown>) => {
    stepDetailDrawerCalls.push(props)
    return null
  },
}))

// Router shim + a STABLE spy navigate; the real navigation hooks run over it.
const navigations: Array<Record<string, unknown>> = []
const navigate = (opts: Record<string, unknown>) => navigations.push(opts)
mock.module('@tanstack/react-router', () => ({
  ...require('../../shims/tanstack-router'),
  useNavigate: () => navigate,
}))

import { WorkflowDetail } from '../../../plugins/workflows/components/workflow-detail'

function setURL(url: string) {
  const happy = (window as unknown as { happyDOM?: { setURL: (u: string) => void } }).happyDOM
  happy?.setURL(url)
}

const definition = {
  id: 'video-script',
  name: 'Video Script',
  description: 'Draft a video script',
  version: 1,
  steps: [
    { id: 'write', type: 'agent', label: 'Write', agent: 'chef', task: 'Write the script' },
    { id: 'review', type: 'agent', label: 'Review', agent: 'chef', task: 'Review the script' },
  ],
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const realFetch = globalThis.fetch
function stubFetch() {
  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    if (url === '/api/plugins/workflows/definitions/video-script' && !init) {
      return Promise.resolve(jsonResponse({ definition, subWorkflows: {}, source: 'plugin', disabled: false }))
    }
    return Promise.resolve(jsonResponse({}))
  }) as unknown as typeof fetch
}

const lastDrawer = () => stepDetailDrawerCalls[stepDetailDrawerCalls.length - 1] as { open: boolean; step: { id: string } | null }
const lastCanvas = () => workflowCanvasCalls[workflowCanvasCalls.length - 1] as { onNodeClick: (id: string) => void }

async function mountAt(url: string) {
  setURL(`http://localhost${url}`)
  stubFetch()
  await act(async () => { render(<WorkflowDetail workflowId="video-script" onBack={() => {}} />) })
  await waitFor(() => expect(workflowCanvasCalls.length).toBeGreaterThan(0))
}

beforeEach(() => {
  navigations.length = 0
  workflowCanvasCalls.length = 0
  stepDetailDrawerCalls.length = 0
})
afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
  setURL('http://localhost/')
})

describe('WorkflowDetail — ?step= drawer', () => {
  it('cold-loads the drawer from ?step= after the definition fetch without navigating', async () => {
    await mountAt('/workflows/video-script?step=review')
    await waitFor(() => expect(lastDrawer().open).toBe(true))
    expect(lastDrawer().step?.id).toBe('review')
    await settleFor(50, 'an inbound deep link must not be rewritten')
    expect(navigations).toHaveLength(0)
  })

  it('a node click PUSHES ?step= so Back closes the drawer', async () => {
    await mountAt('/workflows/video-script')
    expect(lastDrawer().open).toBe(false)
    await act(async () => { lastCanvas().onNodeClick('write') })
    await waitFor(() => expect(navigations).toHaveLength(1))
    expect(navigations[0]).toMatchObject({ to: '/workflows/video-script', search: { step: 'write' } })
    expect((navigations[0] as { replace?: boolean }).replace).not.toBe(true)
  })

  it('trigger nodes are ignored', async () => {
    await mountAt('/workflows/video-script')
    await act(async () => { lastCanvas().onNodeClick('__trigger') })
    await settleFor(50, 'trigger nodes never open a step')
    expect(navigations).toHaveLength(0)
  })

  it('closing the drawer REPLACES ?step= away', async () => {
    await mountAt('/workflows/video-script?step=write')
    await waitFor(() => expect(lastDrawer().open).toBe(true))
    const onOpenChange = (lastDrawer() as unknown as { onOpenChange: (open: boolean) => void }).onOpenChange
    await act(async () => { onOpenChange(false) })
    await waitFor(() => expect(navigations).toHaveLength(1))
    expect(navigations[0]).toMatchObject({ to: '/workflows/video-script', search: {}, replace: true })
  })

  it('a stale ?step= leaves the drawer closed without rewriting the URL', async () => {
    await mountAt('/workflows/video-script?step=nope')
    await settleFor(50, 'a stale in-page selection shows the default (closed); nothing to normalize')
    expect(lastDrawer().open).toBe(false)
    expect(lastDrawer().step).toBeNull()
    expect(navigations).toHaveLength(0)
  })
})
