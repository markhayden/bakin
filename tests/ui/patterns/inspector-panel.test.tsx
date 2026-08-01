// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  InspectorPanel,
  InspectorPanelContent,
  InspectorPanelFooter,
  InspectorPanelHeader,
} from '@makinbakin/sdk/patterns'
import { Button, SystemState } from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('inspector panel recipe', () => {
  it('keeps identity, content, and local actions in one named supporting region', () => {
    const { container } = render(
      <InspectorPanel label="Transform node inspector">
        <InspectorPanelHeader eyebrow="Workflow node" title="Assemble social video" actions={<Button>Close</Button>} />
        <InspectorPanelContent busy feedback={<p>Draft changes</p>}>
          <dl><dt>Step ID</dt><dd>assemble-video</dd></dl>
        </InspectorPanelContent>
        <InspectorPanelFooter><Button>Apply</Button></InspectorPanelFooter>
      </InspectorPanel>,
    )
    expect(screen.getByRole('region', { name: 'Transform node inspector' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Assemble social video' })).toBeTruthy()
    expect(container.querySelector('[data-slot="inspector-panel-content"]')?.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelector('[data-slot="inspector-panel-feedback"]')?.textContent).toBe('Draft changes')
    expect(container.querySelector('[data-slot="inspector-panel-footer"]')?.textContent).toBe('Apply')
  })

  it('replaces only inspector content without removing close or footer actions', () => {
    render(
      <InspectorPanel label="Node inspector">
        <InspectorPanelHeader title="Unknown node" actions={<Button>Close</Button>} />
        <InspectorPanelContent state={<SystemState kind="error" recovery="unavailable" />}>Stale fields</InspectorPanelContent>
        <InspectorPanelFooter><Button variant="danger">Delete node</Button></InspectorPanelFooter>
      </InspectorPanel>,
    )
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete node' })).toBeTruthy()
    expect(screen.queryByText('Stale fields')).toBeNull()
  })
})
