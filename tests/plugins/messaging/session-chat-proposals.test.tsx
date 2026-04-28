// @vitest-environment jsdom
/**
 * Client-side integration test for SessionChat's SSE adapter.
 *
 * Mocks global fetch with a canned SSE body containing token events, a
 * proposal event, and a final done. Asserts that onProposalsReceived fires
 * with the parsed proposal — the end-to-end proposal-forwarding contract the
 * messaging review panel depends on.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-session-proposals-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

const MOCK_AGENTS = [{ id: 'basil', name: 'Basil', headshot: undefined }]
mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentList: () => MOCK_AGENTS,
  useAgentIds: () => MOCK_AGENTS.map((a) => a.id),
  useAgent: (id: string) => MOCK_AGENTS.find((a) => a.id === id),
  useAgentColor: () => '#10b981',
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      agentMap: Object.fromEntries(MOCK_AGENTS.map((a) => [a.id, a])),
      agents: MOCK_AGENTS,
      displaySettings: {},
    }),
}))

import { SessionChat } from '../../../plugins/messaging/components/session-chat'
import type { ProposedItem } from '../../../plugins/messaging/types'

/** Build a canned SSE body with the given event-lines and close it. */
function sseResponse(
  events: Array<{ event: string; data: unknown }>,
): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(
          encoder.encode(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`),
        )
      }
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

afterEach(() => {
  cleanup()
})

describe('SessionChat — proposal forwarding over SSE', () => {
  it('forwards proposal SSE events to onProposalsReceived', async () => {
    const received: ProposedItem[] = []
    const onProposalsReceived = (p: ProposedItem[]) => {
      received.push(...p)
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (_url: unknown, _init: unknown) =>
      sseResponse([
        { event: 'token', data: { text: 'Here are some ideas.' } },
        {
          event: 'proposal',
          data: {
            proposal: {
              id: 'p-1',
              title: 'Sunday snack post',
              contentType: 'post',
              tone: 'playful',
              scheduledAt: '2026-05-04T10:00:00Z',
              brief: 'Lightweight Sunday snack idea',
              status: 'pending',
            },
          },
        },
        { event: 'done', data: { content: 'Here are some ideas.' } },
      ]),
    ) as unknown as typeof fetch
    try {
      render(
        <SessionChat
          sessionId="s1"
          agentId="basil"
          onProposalsReceived={onProposalsReceived}
        />,
      )
      const ta = screen.getByLabelText(/Ask Basil/) as HTMLTextAreaElement
      act(() => {
        fireEvent.change(ta, { target: { value: 'plan please' } })
        fireEvent.keyDown(ta, { key: 'Enter' })
      })
      await waitFor(() => {
        expect(received.length).toBe(1)
      })
      expect(received[0].id).toBe('p-1')
      expect(received[0].title).toBe('Sunday snack post')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('forwards batch "proposals" SSE events as individual callbacks', async () => {
    const received: ProposedItem[] = []
    const onProposalsReceived = (p: ProposedItem[]) => {
      received.push(...p)
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      sseResponse([
        { event: 'token', data: { text: 'OK here are two.' } },
        {
          event: 'proposals',
          data: {
            proposals: [
              { id: 'p-a', title: 'Idea A' },
              { id: 'p-b', title: 'Idea B' },
            ],
          },
        },
        { event: 'done', data: { content: 'OK here are two.' } },
      ]),
    ) as unknown as typeof fetch
    try {
      render(
        <SessionChat
          sessionId="s1"
          agentId="basil"
          onProposalsReceived={onProposalsReceived}
        />,
      )
      const ta = screen.getByLabelText(/Ask Basil/) as HTMLTextAreaElement
      act(() => {
        fireEvent.change(ta, { target: { value: 'give two' } })
        fireEvent.keyDown(ta, { key: 'Enter' })
      })
      await waitFor(() => {
        expect(received.length).toBe(2)
      })
      expect(received.map((p) => p.id)).toEqual(['p-a', 'p-b'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('surfaces SSE error events as an error bubble (role=alert)', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      sseResponse([
        { event: 'error', data: { message: 'runtime rejected' } },
      ]),
    ) as unknown as typeof fetch
    try {
      render(<SessionChat sessionId="s1" agentId="basil" />)
      const ta = screen.getByLabelText(/Ask Basil/) as HTMLTextAreaElement
      act(() => {
        fireEvent.change(ta, { target: { value: 'boom' } })
        fireEvent.keyDown(ta, { key: 'Enter' })
      })
      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toContain('runtime rejected')
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
