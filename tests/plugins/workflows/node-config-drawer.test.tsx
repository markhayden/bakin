// @vitest-environment jsdom

/**
 * Tests for `plugins/workflows/components/node-config-drawer.tsx`.
 *
 * The drawer reads from the node-type registry to know which form fields
 * to render per kind. These tests exercise one builtin kind per shape
 * (agent for agent-style picker, gate for approval fields
 * string, output for list fields) and confirm:
 *   1. Form renders from formFields metadata.
 *   2. Apply validates against the kind's Zod schema and surfaces errors.
 *   3. Valid Apply fires onApply with the merged patch.
 *   4. Unknown / unregistered kinds show a friendly notice (plugin
 *      inactive case).
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { z } from 'zod'

const testDir = join(tmpdir(), `bakin-test-node-config-drawer-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@/core/task-store', () => ({}))

// Stub AgentSelect so the agent-field renderer renders in jsdom without
// hitting the agent store.
mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentList: () => [
    { id: 'chef', name: 'Chef' },
    { id: 'pixel', name: 'Pixel' },
  ],
}))
mock.module('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span>{agentId}</span>,
}))

import { NodeConfigDrawer } from '../../../plugins/workflows/components/node-config-drawer'
import { registerNodeType, unregisterNodeType } from '@bakin/core/workflows/node-type-registry'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NodeConfigDrawer', () => {
  it('renders formFields for a builtin agent step', async () => {
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{ id: 'do-thing', type: 'agent', label: 'Do Thing', agent: 'chef' }}
          onApply={() => {}}
          onClose={() => {}}
        />,
      )
    })
    // id + label + agent + task + skill fields from agentFormFields are present
    expect(screen.getByLabelText(/step id/i)).toBeDefined()
    expect(screen.getByLabelText(/display name/i)).toBeDefined()
    expect(screen.getAllByText(/agent/i).length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/task brief/i)).toBeDefined()
    expect(screen.getByText(/stable identifier used by workflow links/i)).toBeDefined()
    expect(screen.getByPlaceholderText('Write a concise post caption for the approved brief.')).toBeDefined()
  })

  it('renders map_workflow fields purely from registry metadata (no special-casing)', async () => {
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{
            id: 'fan', type: 'map_workflow', label: 'Fan',
            source: 'seg.items', workflow_id: 'child-wf', item_key: 'clip', max_children: 8,
          }}
          onApply={() => {}}
          onClose={() => {}}
        />,
      )
    })
    expect(screen.getByText('Map fan-out')).toBeDefined()
    expect(screen.getByDisplayValue('seg.items')).toBeDefined()
    expect(screen.getByDisplayValue('child-wf')).toBeDefined()
    expect(screen.getByDisplayValue('clip')).toBeDefined()
    expect(screen.getByDisplayValue('8')).toBeDefined()
  })

  it('applies edited map_workflow fields as a typed patch', async () => {
    const onApply = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{ id: 'fan', type: 'map_workflow', label: 'Fan', source: 'seg.items', workflow_id: 'child-wf' }}
          onApply={onApply}
          onClose={() => {}}
        />,
      )
    })
    // workflow_id renders the workflow-picker Select (shared with nested
    // steps); the plain string field `source` proves the patch round-trip.
    fireEvent.change(screen.getByDisplayValue('seg.items'), { target: { value: 'seg.clips' } })
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))
    expect(onApply).toHaveBeenCalled()
    const patch = onApply.mock.calls[0][0] as Record<string, unknown>
    expect(patch.type).toBe('map_workflow')
    expect(patch.source).toBe('seg.clips')
    expect(patch.workflow_id).toBe('child-wf')
  })

  it('calls onApply with the merged patch when Apply is clicked on valid input', async () => {
    const onApply = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{ id: 'approve', type: 'gate', label: 'Approve' }}
          onApply={onApply}
          onClose={() => {}}
        />,
      )
    })
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))
    expect(onApply).toHaveBeenCalled()
    const patch = onApply.mock.calls[0][0] as Record<string, unknown>
    expect(patch.id).toBe('approve')
    expect(patch.label).toBe('Approve')
    expect(patch.type).toBe('gate')
  })

  it('round-trips structured output content as an object', async () => {
    const onApply = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{
            id: 'publish',
            type: 'output',
            label: 'Publish',
            agent: 'chef',
            content: { message: 'Ready to publish' },
          }}
          onApply={onApply}
          onClose={() => {}}
        />,
      )
    })

    expect((screen.getByLabelText(/output content/i) as HTMLTextAreaElement).value).toBe('{\n  "message": "Ready to publish"\n}')
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).toHaveBeenCalled()
    const patch = onApply.mock.calls[0][0] as Record<string, unknown>
    expect(patch.content).toEqual({ message: 'Ready to publish' })
  })

  it('shows an inline error for invalid output content JSON', async () => {
    const onApply = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{ id: 'publish', type: 'output', label: 'Publish', agent: 'chef' }}
          onApply={onApply}
          onClose={() => {}}
        />,
      )
    })

    fireEvent.change(screen.getByLabelText(/output content/i), { target: { value: '{bad json' } })
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByText('Enter valid JSON object content.')).toBeDefined()
  })

  it('preserves YAML-backed fields the drawer does not own', async () => {
    const onApply = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{
            id: 'write',
            type: 'agent',
            label: 'Write',
            agent: 'chef',
            output_schema: { type: 'object' },
          }}
          onApply={onApply}
          onClose={() => {}}
        />,
      )
    })
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Write draft' } })
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).toHaveBeenCalled()
    const patch = onApply.mock.calls[0][0] as Record<string, unknown>
    expect(patch.label).toBe('Write draft')
    expect(patch.output_schema).toEqual({ type: 'object' })
  })

  it('keeps unchanged empty optional fields instead of deleting YAML content', async () => {
    const onApply = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{
            id: 'write',
            type: 'agent',
            label: 'Write',
            agent: 'chef',
            skill: '',
            description: '',
          }}
          onApply={onApply}
          onClose={() => {}}
        />,
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).toHaveBeenCalled()
    const patch = onApply.mock.calls[0][0] as Record<string, unknown>
    expect(patch.skill).toBe('')
    expect(patch.description).toBe('')
  })

  it('rejects duplicate step IDs before applying a patch', async () => {
    const onApply = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{ id: 'write', type: 'agent', label: 'Write', agent: 'chef' }}
          existingStepIds={['write', 'review']}
          onApply={onApply}
          onClose={() => {}}
        />,
      )
    })

    fireEvent.change(screen.getByLabelText(/step id/i), { target: { value: 'review' } })
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByText('Step IDs must be unique.')).toBeDefined()
  })

  it('reports drawer dirty state and clears it after a valid apply', async () => {
    const onApply = mock()
    const onDirtyChange = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{ id: 'write', type: 'agent', label: 'Write', agent: 'chef' }}
          onApply={onApply}
          onDirtyChange={onDirtyChange}
          onClose={() => {}}
        />,
      )
    })

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Write draft' } })
    expect(onDirtyChange).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).toHaveBeenCalled()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('renders the assigned-agent token as a selectable agent option', async () => {
    const onApply = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{ id: 'write', type: 'agent', label: 'Write', agent: '$assigned' }}
          onApply={onApply}
          onClose={() => {}}
        />,
      )
    })

    expect(screen.getByText('Assigned agent')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).toHaveBeenCalled()
    const patch = onApply.mock.calls[0][0] as Record<string, unknown>
    expect(patch.agent).toBe('$assigned')
  })

  it('edits gate on_reject.goto without dropping sibling reject metadata', async () => {
    const onApply = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{
            id: 'approve',
            type: 'gate',
            label: 'Approve',
            on_reject: { goto: 'write', note_to_agent: true },
          }}
          onApply={onApply}
          onClose={() => {}}
        />,
      )
    })
    fireEvent.change(screen.getByLabelText(/rejected path/i), { target: { value: 'revise' } })
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).toHaveBeenCalled()
    const patch = onApply.mock.calls[0][0] as Record<string, unknown>
    expect(patch.on_reject).toEqual({ goto: 'revise', note_to_agent: true })
  })

  it('edits static parallel agent children as structured rows', async () => {
    const onApply = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{
            id: 'fanout',
            type: 'parallel',
            label: 'Fan out',
            steps: [
              {
                id: 'segment-a',
                type: 'agent',
                label: 'Segment A',
                agent: 'chef',
                task: 'Make the first segment',
              },
            ],
          }}
          onApply={onApply}
          onClose={() => {}}
        />,
      )
    })
    fireEvent.change(screen.getByLabelText(/task brief for child segment-a/i), {
      target: { value: 'Create segment one' },
    })
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).toHaveBeenCalled()
    const patch = onApply.mock.calls[0][0] as Record<string, unknown>
    expect(patch.steps).toEqual([
      {
        id: 'segment-a',
        type: 'agent',
        label: 'Segment A',
        agent: 'chef',
        task: 'Create segment one',
      },
    ])
  })

  it('marks required empty fields inline before schema validation', async () => {
    const onApply = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{ id: 'agent', type: 'agent', label: 'agent', agent: '', task: 'Do something.' }}
          onApply={onApply}
          onClose={() => {}}
        />,
      )
    })
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByText('Choose an agent.')).toBeDefined()
    expect(screen.queryByText(/Invalid input/)).toBeNull()
  })

  it('surfaces schema errors that are not owned by required field checks', async () => {
    const onApply = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{
            id: 'g',
            type: 'gate',
            label: 'G',
            approval_required: 'yes',
          }}
          onApply={onApply}
          onClose={() => {}}
        />,
      )
    })
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByText(/expected boolean/i)).toBeDefined()
    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('lets optional numeric plugin fields be cleared instead of saving zero', async () => {
    const kind = 'test.optional-number'
    registerNodeType({
      kind,
      runtime: 'plugin',
      pluginId: 'test',
      zodSchema: z.object({
        id: z.string(),
        type: z.literal(kind),
        label: z.string(),
        retries: z.number().optional(),
      }).passthrough(),
      formFields: [
        { name: 'retries', type: 'number', description: 'Retry count' },
      ],
    })
    try {
      const onApply = mock()
      await act(async () => {
        render(
          <NodeConfigDrawer
            step={{ id: 'retry', type: kind, label: 'Retry', retries: 3 }}
            onApply={onApply}
            onClose={() => {}}
          />,
        )
      })

      fireEvent.change(screen.getByLabelText(/retries/i), { target: { value: '' } })
      fireEvent.click(screen.getByRole('button', { name: /apply/i }))

      expect(onApply).toHaveBeenCalled()
      const patch = onApply.mock.calls[0][0] as Record<string, unknown>
      expect('retries' in patch).toBe(false)
    } finally {
      unregisterNodeType(kind)
    }
  })

  it('shows a friendly notice when the kind is unregistered', async () => {
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{ id: 's', type: 'ghost.never-registered', label: 'S' }}
          onApply={() => {}}
          onClose={() => {}}
        />,
      )
    })
    expect(screen.getByText(/No registered node type/)).toBeDefined()
  })

  it('closes via the X button', async () => {
    const onClose = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{ id: 's1', type: 'agent', label: 'S', agent: 'chef' }}
          onApply={() => {}}
          onClose={onClose}
        />,
      )
    })
    fireEvent.click(screen.getByLabelText(/close drawer/i))
    expect(onClose).toHaveBeenCalled()
  })

  it('exposes a delete action for the selected step', async () => {
    const onDelete = mock()
    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{ id: 's1', type: 'agent', label: 'S', agent: 'chef' }}
          onApply={() => {}}
          onDelete={onDelete}
          onClose={() => {}}
        />,
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(onDelete).toHaveBeenCalled()
  })

  it('renders workflow_id as a workflow selector', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            templates: [
              { filename: 'video-script', name: 'Video Script' },
              { filename: 'assemble-video', name: 'Assemble Video', disabled: true },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      render(
        <NodeConfigDrawer
          step={{
            id: 'script-video',
            type: 'workflow',
            label: 'Script Video',
            workflow_id: 'video-script',
          }}
          onApply={() => {}}
          onClose={() => {}}
        />,
      )
    })

    await waitFor(() => {
      // useJsonFetch passes an options object carrying the abort signal.
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/plugins/workflows/definitions?includeDisabled=1',
        expect.anything(),
      )
    })
    expect(screen.getByRole('combobox')).toBeDefined()
    expect(screen.queryByRole('textbox', { name: /^workflow_id$/i })).toBeNull()
  })
})
