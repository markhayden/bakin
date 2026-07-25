// @vitest-environment jsdom
/**
 * ConversationPanel (T3.4) — the embedded
 * single-session contract, mirroring the three real bits call sites
 * (messaging brainstorm-view, messaging plan-workspace, projects
 * project-detail): fitParent/showHeader layout modes, readOnly notice,
 * transformText with extras (proposal stripping), agent switcher slot,
 * and the SSE-driven stream hook incl. custom events.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-conv-panel-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import '../rtl-settle'

import {
  ConversationPanel,
  type ConversationMessage,
} from '@makinbakin/sdk/components'

const MESSAGES: ConversationMessage[] = [
  { kind: 'user', ts: '2026-07-11T10:00:00.000Z', content: 'brainstorm this' },
  { kind: 'assistant', ts: '2026-07-11T10:00:05.000Z', turnId: 't1', content: 'Idea one.\n```json\n{"proposals":[{"id":"p1"}]}\n```' },
]

describe('ConversationPanel layout modes (bits contract)', () => {
  it('fitParent + showHeader=false renders no header and fills the host (brainstorm-view mode)', () => {
    const { container } = render(
      <ConversationPanel messages={MESSAGES} agentId="main" onSend={() => {}} storageKey="bs-1" fitParent showHeader={false} />,
    )
    expect(container.querySelector('[data-conv-panel-header]')).toBeNull()
    expect(container.querySelector('[data-conv-panel]')!.className).toContain('h-full')
    expect(container.querySelector('textarea')).not.toBeNull()
  })

  it('default mode renders the header with title (project-detail mode)', () => {
    const { container } = render(
      <ConversationPanel messages={[]} agentId="main" onSend={() => {}} storageKey="pd-1" title="Project brainstorm" />,
    )
    expect(container.querySelector('[data-conv-panel-header]')!.textContent).toContain('Project brainstorm')
  })

  it('readOnly hides the composer and shows the notice (archived session mode)', () => {
    const { container } = render(
      <ConversationPanel
        messages={MESSAGES}
        agentId="main"
        onSend={() => {}}
        storageKey="ro-1"
        readOnly
        readOnlyNotice="Archived session"
      />,
    )
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('[data-conv-readonly]')!.textContent).toContain('Archived session')
  })

  it('transformText strips proposal JSON and renders extras (messaging transform contract)', () => {
    const { container } = render(
      <ConversationPanel
        messages={MESSAGES}
        agentId="main"
        onSend={() => {}}
        storageKey="tf-1"
        transformText={(text) => ({
          text: text.replace(/```json[\s\S]*?```/g, '').trim(),
          extras: <span data-testid="proposal-badge">1 plan proposed</span>,
        })}
      />,
    )
    expect(container.textContent).toContain('Idea one.')
    expect(container.textContent).not.toContain('proposals')
    expect(container.querySelector('[data-testid="proposal-badge"]')).not.toBeNull()
  })

  it('renders the agent switcher slot when onAgentChange is provided', () => {
    const { container } = render(
      <ConversationPanel messages={[]} agentId="main" onAgentChange={() => {}} onSend={() => {}} storageKey="ag-1" />,
    )
    expect(container.querySelector('[data-conv-agent-select]')).not.toBeNull()
    cleanup()
  })
})

function sseResponse(frames: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames.join('')))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
