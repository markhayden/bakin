// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  ConversationPage,
  ConversationPageBody,
  ConversationPageComposer,
  ConversationPageTimeline,
  InspectorPanel,
  InspectorPanelContent,
  InspectorPanelFooter,
  InspectorPanelHeader,
  PageHeader,
} from '@makinbakin/sdk/patterns'
import { Button, SystemState } from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('conversation page recipe', () => {
  it('names one log and keeps the composer outside its explicit contained scroller', () => {
    const { container } = render(
      <ConversationPage mode="contained">
        <PageHeader title="Conversation with Patch" />
        <ConversationPageBody mode="contained" feedback={<p>Reconnecting</p>}>
          <ConversationPageTimeline label="Conversation with Patch">
            <article>Existing message</article>
          </ConversationPageTimeline>
          <ConversationPageComposer><label>Message <textarea /></label></ConversationPageComposer>
        </ConversationPageBody>
      </ConversationPage>,
    )

    const page = container.querySelector('[data-archetype="conversation"]')
    expect(page?.getAttribute('data-width')).toBe('full')
    expect(page?.getAttribute('data-mode')).toBe('contained')
    expect(page?.className).toContain('h-full')
    expect(page?.className).toContain('[&>[data-slot=page-shell-content]]:h-full')
    const log = screen.getByRole('log', { name: 'Conversation with Patch' })
    expect(log.getAttribute('aria-live')).toBe('polite')
    expect(log.className).toContain('overflow-y-auto')
    const composer = container.querySelector('[data-slot="conversation-page-composer"]')
    expect(composer?.contains(log)).toBe(false)
    expect(composer?.className).not.toContain('border-t')
    expect(container.querySelector('[data-slot="conversation-page-feedback"]')?.textContent).toBe('Reconnecting')
  })

  it('replaces the conversation body while preserving identity', () => {
    render(
      <ConversationPage>
        <PageHeader title="Conversation with Patch" />
        <ConversationPageBody state={<SystemState kind="permission-denied" />}>
          <ConversationPageTimeline label="Conversation with Patch">Restricted message</ConversationPageTimeline>
        </ConversationPageBody>
      </ConversationPage>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Conversation with Patch' })).toBeTruthy()
    expect(screen.getByText('Access restricted')).toBeTruthy()
    expect(screen.queryByText('Restricted message')).toBeNull()
  })
})

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
