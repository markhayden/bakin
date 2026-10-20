/**
 * The roster provider owns the `updates.changed` re-read (PR 8 review r2 #8):
 * a changed `package:` record re-fetches `/api/agent-packages` once for every
 * Team surface — with only the provider mounted, no card, no grid.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-theme-provider-updates-${Date.now()}`)
mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) }))
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) }))

import { AgentThemeProvider } from '../../packages/host/src/providers/AgentThemeProvider'
import { useAgentStore } from '../../plugins/team/hooks/use-agent-store'
import { emitPluginEvent } from '../../src/hooks/use-plugin-event'

afterAll(() => { try { rmSync(testDir, { recursive: true, force: true }) } catch {} })
afterEach(() => cleanup())

const ROSTER = { agents: [], displaySettings: {}, teams: [], mainAgentId: 'main' }
let packageReads = 0
beforeEach(() => {
  packageReads = 0
  useAgentStore.setState({ agents: [], agentIds: [], agentMap: {}, agentsWithStatus: [], displaySettings: {}, teams: [], packageStates: {}, mainAgentId: null, loaded: false })
  global.fetch = mock((url: RequestInfo | URL) => {
    const u = String(url)
    if (u === '/api/plugins/team/') return Promise.resolve({ ok: true, json: () => Promise.resolve(ROSTER) } as Response)
    if (u === '/api/agent-packages') {
      packageReads += 1
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, agents: [{ agentId: 'pixel', state: 'managed', packageId: 'pixel@1.0.0', version: String(packageReads) }] }) } as Response)
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`))
  }) as unknown as typeof global.fetch
})

describe('AgentThemeProvider — updates.changed re-reads the package rows', () => {
  it('a package record change re-fetches the rows once; other subjects are ignored', async () => {
    await act(async () => { render(<AgentThemeProvider><div /></AgentThemeProvider>) })
    await waitFor(() => expect(useAgentStore.getState().loaded).toBe(true))
    expect(packageReads).toBe(1)

    await act(async () => { emitPluginEvent({ event: 'updates.changed', ids: ['plugin:notes', 'bakin:bakin'] }) })
    expect(packageReads).toBe(1)

    await act(async () => { emitPluginEvent({ event: 'updates.changed', ids: ['package:pixel'] }) })
    await waitFor(() => expect(packageReads).toBe(2))
    expect(useAgentStore.getState().packageStates['pixel']?.version).toBe('2')
  })
})
