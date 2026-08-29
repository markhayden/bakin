// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ComponentType } from 'react'

const testDir = join(tmpdir(), `bakin-test-workflow-editor-route-${Date.now()}`)
const navigateMock = mock()
let currentParams = { id: 'video-script' }
let slotProps: Record<string, unknown> | null = null

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

mock.module('@tanstack/react-router', () => ({
  createRoute: (config: Record<string, unknown>) => ({
    ...config,
    options: config,
    useParams: () => currentParams,
  }),
  useNavigate: () => navigateMock,
}))

mock.module('../../../packages/host/src/routes/__root', () => ({
  Route: {},
}))

mock.module('@makinbakin/sdk/ui', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
  // The route composes its loading/error states on SystemState; the stub
  // keeps the title as a heading and renders the preview + action slots.
  SystemState: ({ kind, title, description, preview, action }: {
    kind: string
    title?: React.ReactNode
    description?: React.ReactNode
    preview?: React.ReactNode
    action?: React.ReactNode
  }) => (
    <section data-testid="system-state" data-kind={kind}>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {preview}
      {action}
    </section>
  ),
  Button: ({ children, variant: _variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button {...props}>{children}</button>
  ),
}))

mock.module('@makinbakin/sdk/slots', () => ({
  Slot: (props: Record<string, unknown>) => {
    slotProps = props
    const definition = props.initialDefinition as { name?: string } | undefined
    return (
      <div data-testid="workflow-edit-slot">
        {definition?.name ?? 'missing definition'}
      </div>
    )
  },
}))

import { Route } from '../../../packages/host/src/routes/workflows.$id.edit'

;(Route as unknown as { useParams: () => { id: string } }).useParams = () => currentParams

function getWorkflowEditRouteComponent(): ComponentType {
  const component = (Route as unknown as {
    component?: ComponentType
    options?: { component?: ComponentType }
  }).component ?? (Route as unknown as { options?: { component?: ComponentType } }).options?.component
  if (!component) throw new Error('Workflow edit route component was not registered')
  return component
}

const WorkflowEditRouteComponent = getWorkflowEditRouteComponent()

describe('/workflows/$id/edit route', () => {
  let fetchMock: ReturnType<typeof mock>

  beforeEach(() => {
    currentParams = { id: 'video-script' }
    slotProps = null
    navigateMock.mockClear()
    fetchMock = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            definition: {
              id: 'video-script',
              name: 'Video Script',
              description: 'Write a script',
              version: 1,
              steps: [],
            },
            source: 'user',
            shadowedSource: { source: 'plugin', pluginId: 'workflows' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches a workflow definition and passes edit props into the workflow editor slot', async () => {
    expect(WorkflowEditRouteComponent).toBeDefined()
    render(<WorkflowEditRouteComponent />)

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0)
    await screen.findByTestId('workflow-edit-slot')

    expect(fetchMock).toHaveBeenCalledWith('/api/plugins/workflows/definitions/video-script')
    expect(slotProps?.name).toBe('page:/workflows/[id]/edit')
    expect(slotProps?.mode).toBe('edit')
    expect(slotProps?.initialId).toBe('video-script')
    expect(slotProps?.source).toBe('user')
    expect(slotProps?.shadowedSource).toEqual({ source: 'plugin', pluginId: 'workflows' })
    expect((slotProps?.initialDefinition as { name?: string } | undefined)?.name).toBe('Video Script')
  })

  it('shows the not-found state instead of mounting the editor slot on a 404', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    render(<WorkflowEditRouteComponent />)

    await screen.findByText('Workflow not found')
    expect(slotProps).toBeNull()
  })

  it('routes saved, copied, deleted, and cancelled editor actions through TanStack navigation', async () => {
    render(<WorkflowEditRouteComponent />)

    await waitFor(() => expect(slotProps).not.toBeNull())

    ;(slotProps?.onSaved as (id: string) => void)('video-script-copy')
    ;(slotProps?.onCopied as (id: string) => void)('video-script-copy')
    ;(slotProps?.onDeleted as () => void)()
    ;(slotProps?.onCancel as () => void)()

    expect(navigateMock).toHaveBeenCalledWith({ to: '/workflows/$id', params: { id: 'video-script-copy' } })
    expect(navigateMock).toHaveBeenCalledWith({ to: '/workflows/$id/edit', params: { id: 'video-script-copy' } })
    expect(navigateMock).toHaveBeenCalledWith({ to: '/workflows' })
    expect(navigateMock).toHaveBeenCalledTimes(4)
  })
})
