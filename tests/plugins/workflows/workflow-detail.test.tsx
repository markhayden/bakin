// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-workflow-detail-${Date.now()}`)
const routerPush = mock()
const workflowCanvasCalls: Array<Record<string, unknown>> = []
const stepDetailDrawerCalls: Array<Record<string, unknown>> = []

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))

mock.module('@/core/task-store', () => ({
  createTask: mock(),
  addTaskLog: mock(),
  moveTask: mock(),
  readTaskboard: mock(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] },
  })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
}))

mock.module('@makinbakin/sdk/hooks', () => ({
  useRouter: () => ({
    push: routerPush,
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => {},
  }),
}))

mock.module('../../../plugins/workflows/components/workflow-canvas', () => ({
  WorkflowCanvas: (props: Record<string, unknown>) => {
    workflowCanvasCalls.push(props)
    return <div data-testid="workflow-canvas" data-has-skill-drift={Boolean(props.skillDrift)} />
  },
}))

mock.module('../../../plugins/workflows/components/step-detail-drawer', () => ({
  StepDetailDrawer: (props: Record<string, unknown>) => {
    stepDetailDrawerCalls.push(props)
    return null
  },
}))

import { WorkflowDetail } from '../../../plugins/workflows/components/workflow-detail'

const pluginDefinition = {
  id: 'video-script',
  name: 'Video Script',
  description: 'Draft a video script',
  version: 1,
  steps: [
    {
      id: 'write',
      type: 'agent',
      label: 'Write',
      agent: 'chef',
      task: 'Write the script',
    },
  ],
}

const userDefinition = {
  ...pluginDefinition,
  id: 'clip-creation-copy',
  name: 'Clip Creation Copy',
  description: 'Custom clip workflow',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getWorkflowHeaderActions(): HTMLElement {
  const actions = document.querySelector('[data-workflow-header-actions]')
  if (!(actions instanceof HTMLElement)) {
    throw new Error('Expected the full workflow header actions to be rendered')
  }
  return actions
}

function getFullWorkspaceHeader(): HTMLElement {
  const header = document.querySelector('[data-slot="workspace-page-header"]')
  if (!(header instanceof HTMLElement)) {
    throw new Error('Expected the full workspace page header to render')
  }
  return header
}

function getWorkflowEditButton(): HTMLButtonElement {
  return within(getWorkflowHeaderActions()).getByRole('button', { name: /^edit$/i }) as HTMLButtonElement
}

function setupPluginDefinitionFetch(options: { disabled?: boolean; availabilityStatus?: number; skillDrift?: unknown } = {}) {
  const fetchMock = mock((url: string, init?: RequestInit) => {
    if (url === '/api/plugins/workflows/definitions/video-script' && !init) {
      return Promise.resolve(jsonResponse({
        definition: pluginDefinition,
        subWorkflows: {},
        source: 'plugin',
        pluginId: 'workflows',
        disabled: options.disabled === true,
        skillDrift: options.skillDrift,
      }))
    }
    if (url === '/api/plugins/workflows/definitions' && init?.method === 'POST') {
      return Promise.resolve(jsonResponse({ id: 'video-script-copy', source: 'user' }, 201))
    }
    if (url === '/api/plugins/workflows/definitions/video-script/availability' && init?.method === 'PATCH') {
      const body = JSON.parse(init.body as string) as { disabled: boolean }
      if (options.availabilityStatus && options.availabilityStatus !== 200) {
        return Promise.resolve(jsonResponse({ error: 'availability unavailable' }, options.availabilityStatus))
      }
      return Promise.resolve(jsonResponse({ id: 'video-script', disabled: body.disabled }))
    }
    return Promise.resolve(jsonResponse({ error: `unexpected ${url}` }, 500))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function setupUserDefinitionFetch() {
  const fetchMock = mock((url: string, init?: RequestInit) => {
    if (url === '/api/plugins/workflows/definitions/clip-creation-copy' && !init) {
      return Promise.resolve(jsonResponse({
        definition: userDefinition,
        subWorkflows: {},
        source: 'user',
        shadowedSource: { source: 'plugin', pluginId: 'workflows' },
        disabled: false,
      }))
    }
    if (url === '/api/plugins/workflows/definitions/clip-creation-copy' && init?.method === 'DELETE') {
      return Promise.resolve(jsonResponse({ id: 'clip-creation-copy', deleted: true }))
    }
    return Promise.resolve(jsonResponse({ error: `unexpected ${url}` }, 500))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  routerPush.mockClear()
  workflowCanvasCalls.length = 0
  stepDetailDrawerCalls.length = 0
})

beforeEach(() => {
  routerPush.mockClear()
  workflowCanvasCalls.length = 0
  stepDetailDrawerCalls.length = 0
})

describe('WorkflowDetail', () => {
  it('opens the edit dialog before creating a managed workflow copy', async () => {
    const fetchMock = setupPluginDefinitionFetch()

    await act(async () => {
      render(<WorkflowDetail workflowId="video-script" onBack={() => {}} />)
    })

    await screen.findByText('Draft a video script')
    const edit = getWorkflowEditButton()
    expect(screen.getByText(/This workflow is managed by Bakin directly/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /delete workflow/i })).toBeNull()
    await act(async () => { fireEvent.click(edit) })

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Edit managed workflow/)).toBeDefined()
    expect(within(dialog).getByText(/To edit this workflow, Bakin will create a custom copy/i)).toBeDefined()
    expect((screen.getByLabelText(/copy name/i) as HTMLInputElement).value).toBe('Video Script Copy')
    expect((screen.getByLabelText(/workflow id/i) as HTMLInputElement).value).toBe('video-script-copy')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('creates the named copy, disables the managed original, and navigates to the copy editor', async () => {
    const fetchMock = setupPluginDefinitionFetch()

    await act(async () => {
      render(<WorkflowDetail workflowId="video-script" onBack={() => {}} />)
    })

    await screen.findByText('Draft a video script')
    await act(async () => { fireEvent.click(getWorkflowEditButton()) })
    const dialog = screen.getByRole('dialog')
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText(/copy name/i), {
        target: { value: 'My Better Flow' },
      })
    })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /create copy/i })) })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const [, createInit] = fetchMock.mock.calls[1]
    expect(createInit).toBeDefined()
    const createBody = JSON.parse(createInit!.body as string) as Record<string, unknown>
    expect(createBody.id).toBe('my-better-flow')
    expect(createBody.name).toBe('My Better Flow')

    const [, availabilityInit] = fetchMock.mock.calls[2]
    expect(availabilityInit).toBeDefined()
    expect(JSON.parse(availabilityInit!.body as string)).toEqual({ disabled: true })
    expect(routerPush).toHaveBeenCalledWith('/workflows/my-better-flow/edit')
  })

  it('still navigates to the copy editor when disabling the managed original fails', async () => {
    const fetchMock = setupPluginDefinitionFetch({ availabilityStatus: 500 })

    await act(async () => {
      render(<WorkflowDetail workflowId="video-script" onBack={() => {}} />)
    })

    await screen.findByText('Draft a video script')
    await act(async () => { fireEvent.click(getWorkflowEditButton()) })
    const dialog = screen.getByRole('dialog')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /create copy/i })) })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(routerPush).toHaveBeenCalledWith('/workflows/video-script-copy/edit')
  })

  it('toggles managed workflow availability from the detail header', async () => {
    const fetchMock = setupPluginDefinitionFetch()

    await act(async () => {
      render(<WorkflowDetail workflowId="video-script" onBack={() => {}} />)
    })

    expect(await screen.findByText('Enabled')).toBeDefined()
    const availabilitySwitch = screen.getByRole('switch', { name: 'Enabled' })
    expect(availabilitySwitch.parentElement?.className).not.toContain('border')
    await act(async () => { fireEvent.click(availabilitySwitch) })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, availabilityInit] = fetchMock.mock.calls[1]
    expect(availabilityInit).toBeDefined()
    expect(JSON.parse(availabilityInit!.body as string)).toEqual({ disabled: true })
    expect(screen.getByText('Disabled')).toBeDefined()
    expect(screen.getByText(/matching and automatic starts skip this workflow/i)).toBeDefined()
    expect(getWorkflowEditButton().disabled).toBe(true)
  })

  it('surfaces workflow skill drift in the detail header and child components', async () => {
    const skillDrift = {
      count: 1,
      repairableCount: 1,
      skills: ['generate-image'],
      byStep: { write: ['generate-image'] },
      reports: [{
        skillName: 'generate-image',
        filePath: '/tmp/generate-image.md',
        currentSha256: 'old',
        managedSource: { kind: 'plugin', id: 'images', skillName: 'generate-image' },
        findings: [],
        userEdited: false,
        installedBy: null,
        repairability: 'safe-managed',
        repairable: true,
      }],
    }
    setupPluginDefinitionFetch({ skillDrift })

    await act(async () => {
      render(<WorkflowDetail workflowId="video-script" onBack={() => {}} />)
    })

    expect(await screen.findByText(/uses a stale workflow skill/i)).toBeDefined()
    await waitFor(() => expect(workflowCanvasCalls.length).toBeGreaterThan(0))
    expect(workflowCanvasCalls.at(-1)?.skillDrift).toEqual(skillDrift)
    expect(stepDetailDrawerCalls.at(-1)?.skillDrift).toEqual(skillDrift)
  })

  it('can re-enable a disabled managed workflow from the detail header', async () => {
    const fetchMock = setupPluginDefinitionFetch({ disabled: true })

    await act(async () => {
      render(<WorkflowDetail workflowId="video-script" onBack={() => {}} />)
    })

    expect(await screen.findByText('Disabled')).toBeDefined()
    expect(screen.getByText(/matching and automatic starts skip this workflow/i)).toBeDefined()
    expect(getWorkflowEditButton().disabled).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Disabled' })) })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, availabilityInit] = fetchMock.mock.calls[1]
    expect(availabilityInit).toBeDefined()
    expect(JSON.parse(availabilityInit!.body as string)).toEqual({ disabled: false })
    expect(screen.getByText('Enabled')).toBeDefined()
    expect(screen.queryByText(/matching and automatic starts skip this workflow/i)).toBeNull()
    expect(getWorkflowEditButton().disabled).toBe(false)
  })

  it('deletes a custom workflow from the detail header after confirmation', async () => {
    const fetchMock = setupUserDefinitionFetch()
    const onBack = mock()

    await act(async () => {
      render(<WorkflowDetail workflowId="clip-creation-copy" onBack={onBack} />)
    })

    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="page-header-title"]')?.textContent,
      ).toBe('Clip Creation Copy'),
    )
    const headerActions = document.querySelector('[data-workflow-header-actions]')
    expect(headerActions).not.toBeNull()
    expect(within(headerActions as HTMLElement).getByRole('button', { name: /^edit$/i })).toBeDefined()
    expect(headerActions?.className).toContain('items-center')
    expect(screen.getByText(/shadows a managed default/i)).toBeDefined()
    expect(screen.queryByText(/steps/i)).toBeNull()
    expect(screen.queryByTestId(/agent-/i)).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()

    await act(async () => {
      fireEvent.click(
        within(getFullWorkspaceHeader()).getByRole('button', { name: 'Workflow actions' }),
      )
    })
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' })) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Delete workflow?')).toBeDefined()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i })) })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/plugins/workflows/definitions/clip-creation-copy')
    expect(init?.method).toBe('DELETE')
    expect(onBack).toHaveBeenCalled()
  })
})
