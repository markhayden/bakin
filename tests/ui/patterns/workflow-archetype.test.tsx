// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  InspectorPanel,
  InspectorPanelContent,
  InspectorPanelHeader,
  PageHeader,
  WorkflowPage,
  WorkflowPageActions,
  WorkflowPageBody,
  WorkflowPageCanvas,
  WorkflowPageToolbar,
} from '@makinbakin/sdk/patterns'
import { Button, SystemState } from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('workflow page recipe', () => {
  it('defaults to a full-width vertical canvas with named controls and actions', () => {
    const { container } = render(
      <WorkflowPage>
        <PageHeader title="Launch publishing workflow" />
        <WorkflowPageBody>
          <WorkflowPageToolbar label="Workflow canvas tools">
            <Button>Auto arrange</Button>
          </WorkflowPageToolbar>
          <WorkflowPageCanvas label="Launch publishing workflow canvas">
            <div>Graph</div>
          </WorkflowPageCanvas>
          <WorkflowPageActions label="Workflow changes">
            <Button>Save workflow</Button>
          </WorkflowPageActions>
        </WorkflowPageBody>
      </WorkflowPage>,
    )

    expect(container.querySelector('[data-archetype="workflow"]')?.getAttribute('data-width')).toBe('full')
    expect(screen.getByRole('toolbar', { name: 'Workflow canvas tools' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Launch publishing workflow canvas' }).getAttribute('data-orientation')).toBe('vertical')
    expect(screen.getByRole('group', { name: 'Workflow changes' })).toBeTruthy()
  })

  it('supports an explicit horizontal canvas and responsive inspector composition', () => {
    const { container } = render(
      <WorkflowPage width="wide">
        <WorkflowPageBody layout="inspector" mode="contained" feedback={<p>Draft changes</p>}>
          <WorkflowPageCanvas label="Campaign workflow canvas" orientation="horizontal">
            <div>Graph</div>
          </WorkflowPageCanvas>
          <InspectorPanel label="Selected node inspector">
            <InspectorPanelHeader title="Assemble social video" />
            <InspectorPanelContent>Fields</InspectorPanelContent>
          </InspectorPanel>
        </WorkflowPageBody>
      </WorkflowPage>,
    )

    const body = container.querySelector('[data-slot="workflow-page-body"]')
    expect(body?.getAttribute('data-mode')).toBe('contained')
    expect(body?.className).toContain('overflow-hidden')
    expect(container.querySelector('[data-slot="workflow-page-grid"]')?.getAttribute('data-layout')).toBe('inspector')
    expect(screen.getByRole('region', { name: 'Campaign workflow canvas' }).getAttribute('data-orientation')).toBe('horizontal')
    expect(container.querySelector('[data-slot="workflow-page-feedback"]')?.textContent).toBe('Draft changes')
  })

  it('replaces the workspace while preserving page identity', () => {
    render(
      <WorkflowPage>
        <PageHeader title="Archived workflow" />
        <WorkflowPageBody state={<SystemState kind="error" recovery="unavailable" />}>
          <WorkflowPageCanvas label="Archived workflow canvas">Graph</WorkflowPageCanvas>
        </WorkflowPageBody>
      </WorkflowPage>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Archived workflow' })).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Graph')).toBeNull()
  })
})
