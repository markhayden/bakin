// @vitest-environment jsdom
/**
 * WorkflowAgentSelect (#966 leaked fetch): the teams request it opens on mount
 * is aborted on unmount, and a body that still arrives afterwards is dropped.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, render, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import * as realHooks from '@makinbakin/sdk/hooks'
mock.module('@makinbakin/sdk/hooks', () => ({
  ...realHooks,
  useAgentList: () => [],
  useAgentStore: (selector: (s: { displaySettings: Record<string, unknown> }) => unknown) => selector({ displaySettings: {} }),
  useAgent: () => undefined,
  useAgentColor: () => '#888',
  useAgentDisplayName: () => '',
}))
import { WorkflowAgentSelect } from '../../../plugins/workflows/components/workflow-agent-identity'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

describe('WorkflowAgentSelect — teams request lifecycle', () => {
  it('aborts the teams request on unmount and ignores a late body', async () => {
    let signal: AbortSignal | undefined
    let release!: (body: unknown) => void
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>((resolve) => { release = (body) => resolve({ ok: true, json: () => Promise.resolve(body) } as Response) })
    }) as typeof fetch
    const view = render(<WorkflowAgentSelect value="" onValueChange={() => {}} />)
    await waitFor(() => expect(signal).toBeDefined())
    expect(signal?.aborted).toBe(false)
    await act(async () => { view.unmount() })
    expect(signal?.aborted).toBe(true)
    await act(async () => { release({ teams: [{ id: 't1', name: 'Late team' }] }) })
    // Nothing to assert on the DOM after unmount — the act gate fails the run if a state update lands.
  })
})
