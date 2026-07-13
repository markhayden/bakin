// @vitest-environment jsdom
/**
 * Runtime hub tabs (pi-parity P4): honest capability language on Overview,
 * per-leg readiness on Capabilities, and the guided Switch flow (dry-run
 * default, ConfirmDialog-gated execute, grouped result cards).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-runtime-hub-${Date.now()}`)
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
}))
// The hub links into /explore and /settings; a bare RTL render has no
// router, so Link becomes a plain anchor.
mock.module('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) => (
    <a href={to} className={className}>{children as never}</a>
  ),
  createRoute: () => ({}),
}))

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../rtl-settle'
import { settleReact } from '../rtl-settle'

import { OverviewTab } from '../../packages/host/src/components/runtime/overview-tab'
import { CapabilitiesTab } from '../../packages/host/src/components/runtime/capabilities-tab'
import { SwitchTab } from '../../packages/host/src/components/runtime/switch-tab'
import type { CapabilityReport } from '../../packages/host/src/components/runtime/types'

const report: CapabilityReport = {
  adapter: 'pi',
  adapters: ['openclaw', 'pi'],
  runtime: { name: 'pi', version: '0.1.0' },
  capabilities: {
    toolCalling: { mode: 'native', access: { style: 'in-process' } },
    delivery: { mode: 'unavailable' },
    imageGen: { mode: 'native' },
    memory: { mode: 'native' },
    sessions: { mode: 'native' },
    workspaceFiles: { mode: 'native' },
    input: { imageInput: true, audioInput: false },
  },
  toolAccess: { style: 'in-process', ok: true, issues: [] },
  credentialStatus: { llmProviders: ['anthropic'], llmCredentials: [{ provider: 'anthropic', kind: 'oauth' }], channels: [] },
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('OverviewTab', () => {
  it('speaks plain language: honest unavailable copy, legend, credential tiles, setup rows', () => {
    render(
      <OverviewTab
        report={report}
        onboarding={[
          { name: 'runtime', status: 'ok', message: 'pi runtime adapter is available' },
          { name: 'budget', status: 'warn', message: 'No spending budget is set', remediation: 'Set one in Settings' },
        ]}
      />,
    )
    // Identity + credentials
    expect(screen.getByText('pi')).toBeTruthy()
    expect(screen.getByText(/anthropic · subscription/)).toBeTruthy()
    // Honest unavailable copy for delivery on pi — never a bare enum
    expect(screen.getByText(/Alerts and approvals appear in the app/)).toBeTruthy()
    expect(screen.getByText('Not available')).toBeTruthy()
    // Legend present
    expect(screen.getByText(/Via Bakin — Bakin fills the gap itself/)).toBeTruthy()
    // Setup rows carry remediation for non-ok
    expect(screen.getByText('→ Set one in Settings')).toBeTruthy()
  })
})

describe('CapabilitiesTab', () => {
  it('renders ready and needs-attention packs with per-leg chips + remediation', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      capabilities: [
        {
          capability: 'web-search', packageId: 'web-search-brave', version: '1.0.0', name: 'Web Search (Brave)',
          skills: [{ name: 'bx-search', status: 'ok' }],
          bins: [{ name: 'bx', status: 'ok' }],
          secrets: [{ name: 'BRAVE_SEARCH_API_KEY', required: true, secretSlot: 'brave.apiKey', status: 'missing' }],
          ready: false,
          missing: ['BRAVE_SEARCH_API_KEY is not configured — add it in Settings → Integrations & Keys'],
        },
      ],
    }), { status: 200 })) as unknown as typeof fetch

    render(<CapabilitiesTab />)
    await waitFor(() => screen.getByText('Web Search (Brave)'))
    expect(screen.getByText('Needs attention')).toBeTruthy()
    expect(screen.getByText(/BRAVE_SEARCH_API_KEY not set/)).toBeTruthy()
    expect(screen.getByText('Add the key in Settings')).toBeTruthy()
  })

  it('empty state invites the user to Explore', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ capabilities: [] }), { status: 200 })) as unknown as typeof fetch
    render(<CapabilitiesTab />)
    await waitFor(() => screen.getByText('No capabilities installed yet'))
    expect(screen.getByText('Browse capabilities')).toBeTruthy()
  })
})

describe('SwitchTab', () => {
  let posts: Array<Record<string, unknown>> = []

  beforeEach(() => {
    posts = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/runtime/switch')) {
        posts.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({
          ok: true, from: 'pi', to: 'openclaw', dryRun: true, backupPath: null, restartRequired: false,
          roster: {
            carried: [{ agentId: 'main' }], existing: ['pixel'],
            unmappedModels: [], preserved: [{ agentId: 'scout', sourceModel: 'openai/gpt-5.5-mini' }], failed: [],
          },
          workspaces: { carried: [{ agentId: 'main', files: 3, bytes: 100 }], skills: [], skippedExisting: [], failed: [] },
          cron: { adopted: ['daily-report'], skipped: [], failed: [] },
          cantCarry: [{ concern: 'sessions', detail: 'runtime session context resets' }],
          credentials: { llmProviders: [] }, sync: null,
        }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    // EventSource: the tab opens a progress stream before POSTing.
    ;(globalThis as Record<string, unknown>).EventSource = class {
      onopen: (() => void) | null = null
      onmessage: unknown = null
      constructor() { setTimeout(() => this.onopen?.(), 0) }
      close() {}
    }
  })

  it('preview posts a dry run with the chosen options and renders grouped result cards', async () => {
    render(<SwitchTab report={report} onSwitched={() => {}} />)
    fireEvent.click(screen.getByTestId('switch-target-openclaw'))
    fireEvent.click(screen.getByTestId('switch-adopt-cron'))
    fireEvent.click(screen.getByTestId('switch-preview'))

    await waitFor(() => screen.getByTestId('switch-result'))
    expect(posts).toEqual([{ target: 'openclaw', dryRun: true, adoptCron: true }])
    // Summary card + attention card content
    expect(screen.getByText('Preview: pi → openclaw')).toBeTruthy()
    expect(screen.getByText(/would be adopted/)).toBeTruthy()
    expect(screen.getByText(/subagent model 'openai\/gpt-5.5-mini' preserved/)).toBeTruthy()
    expect(screen.getByText(/no model providers configured/)).toBeTruthy()
    expect(screen.getByText('Stays behind')).toBeTruthy()
  })

  it('the real switch is gated behind the confirm dialog', async () => {
    render(<SwitchTab report={report} onSwitched={() => {}} />)
    fireEvent.click(screen.getByTestId('switch-target-openclaw'))
    fireEvent.click(screen.getByTestId('switch-execute'))
    await settleReact()

    // Dialog open, nothing posted yet.
    expect(posts).toEqual([])
    fireEvent.click(screen.getByTestId('switch-confirm'))
    await waitFor(() => expect(posts).toEqual([{ target: 'openclaw' }]))
  })
})
