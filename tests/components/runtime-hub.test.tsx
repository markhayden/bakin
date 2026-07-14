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

import { useToastStore } from '@makinbakin/sdk/hooks'

import { OverviewTab } from '../../packages/host/src/components/runtime/overview-tab'
import { CapabilitiesTab } from '../../packages/host/src/components/runtime/capabilities-tab'
import { RuntimesTab } from '../../packages/host/src/components/runtime/runtimes-tab'
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
        onRefreshOnboarding={() => {}}
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
    // budget is not headless-fixable — no Fix button; fixable components get one
    expect(screen.queryByTestId('setup-fix-budget')).toBeNull()
  })

  it('warn rows expose Repair, confirm-gated, posting the install and reporting failure reasons', async () => {
    const posts: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/runtime/onboarding/install')) {
        posts.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({ ok: true, result: { status: 'installed', message: 'synced 3 agents' } }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const refreshed: number[] = []
    render(
      <OverviewTab
        report={report}
        onRefreshOnboarding={() => refreshed.push(1)}
        onboarding={[{ name: 'agent-sync', status: 'warn', message: '3 findings', remediation: 'Run bakin install agent-sync' }]}
      />,
    )
    useToastStore.setState({ toasts: [] })
    fireEvent.click(screen.getByTestId('setup-fix-agent-sync'))
    await settleReact()
    // Confirmation first — nothing posted yet.
    expect(posts).toEqual([])
    fireEvent.click(screen.getByTestId('setup-repair-confirm'))
    await waitFor(() => expect(posts).toEqual([{ component: 'agent-sync' }]))
    await waitFor(() => expect(refreshed.length).toBe(1))
    // Success feedback reaches the REAL toast store (the one the shell
    // Toaster reads) with the result message.
    const toasts = useToastStore.getState().toasts
    expect(toasts.length).toBe(1)
    expect(String(toasts[0].message)).toContain('synced 3 agents')
  })

  it('a failed repair surfaces the reason', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/runtime/onboarding/install')) {
        return new Response(JSON.stringify({ ok: false, result: { status: 'failed', message: 'runtime unreachable' } }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    render(
      <OverviewTab
        report={report}
        onRefreshOnboarding={() => {}}
        onboarding={[{ name: 'plugin-assets', status: 'warn', message: '1 drifted' }]}
      />,
    )
    fireEvent.click(screen.getByTestId('setup-fix-plugin-assets'))
    await settleReact()
    fireEvent.click(screen.getByTestId('setup-repair-confirm'))
    // The failure surfaces INSIDE the still-open dialog (retry or cancel),
    // not in a detached banner.
    await waitFor(() => expect(screen.getByText(/Repair failed: runtime unreachable/)).toBeTruthy())
    expect(screen.getByTestId('setup-repair-confirm')).toBeTruthy()
  })
})

describe('CapabilitiesTab', () => {
  it('renders ready and needs-attention packs with per-leg chips + remediation', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      capabilities: [
        {
          capability: 'web-search', packageId: 'web-search-brave', version: '1.0.0', name: 'Web Search (Brave)',
          description: 'Give your agents real web search — research, docs lookup, fresh information.',
          skills: [{ name: 'bx-search', status: 'ok' }],
          bins: [{ name: 'bx', status: 'ok' }],
          npm: [{ name: 'scripts', status: 'missing' }],
          models: [{ name: 'parakeet', bytes: 897_000_000, status: 'missing' }],
          prereqs: [{ name: 'Google Chrome', kind: 'app', help: 'https://www.google.com/chrome/', status: 'missing' }],
          platformSupported: true,
          secrets: [{ name: 'BRAVE_SEARCH_API_KEY', required: true, secretSlot: 'brave.apiKey', status: 'missing' }],
          ready: false,
          missing: ['BRAVE_SEARCH_API_KEY is not configured — add it in Settings → Integrations & Keys'],
        },
      ],
    }), { status: 200 })) as unknown as typeof fetch

    render(<CapabilitiesTab />)
    await waitFor(() => screen.getByText('Web Search (Brave)'))
    expect(screen.getByText(/Give your agents real web search/)).toBeTruthy()
    expect(screen.getByText('Needs attention')).toBeTruthy()
    expect(screen.getByText(/BRAVE_SEARCH_API_KEY not set/)).toBeTruthy()
    expect(screen.getByText(/dependencies scripts missing/)).toBeTruthy()
    expect(screen.getByText(/model parakeet missing \(897 MB\)/)).toBeTruthy()
    expect(screen.getByText(/Google Chrome not installed/)).toBeTruthy()
    expect(screen.getByText('Add the key in Settings')).toBeTruthy()
  })

  it('empty state invites the user to Explore', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ capabilities: [] }), { status: 200 })) as unknown as typeof fetch
    render(<CapabilitiesTab />)
    await waitFor(() => screen.getByText('No capabilities installed yet'))
    expect(screen.getByText('Browse capabilities')).toBeTruthy()
  })
})

describe('RuntimesTab', () => {
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
    render(<RuntimesTab report={report} onSwitched={() => {}} />)
    // Clicking a runtime card opens the dialog — options + preview live THERE.
    fireEvent.click(screen.getByTestId('switch-target-openclaw'))
    await settleReact()
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
    // A dry-run result funnels back into the confirm dialog — the only
    // path to a real switch.
    fireEvent.click(screen.getByTestId('switch-execute'))
    await settleReact()
    expect(screen.getByTestId('switch-confirm')).toBeTruthy()
  })

  it('the active runtime is marked and not selectable', () => {
    render(<RuntimesTab report={report} onSwitched={() => {}} />)
    expect(screen.getByText('Active')).toBeTruthy()
    expect((screen.getByTestId('switch-target-pi') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('switch-target-openclaw') as HTMLButtonElement).disabled).toBe(false)
  })

  it('the real switch is gated behind a TYPED confirm dialog', async () => {
    render(<RuntimesTab report={report} onSwitched={() => {}} />)
    fireEvent.click(screen.getByTestId('switch-target-openclaw'))
    await settleReact()

    // Consequences live in the dialog; nothing posted; confirm stays
    // disabled until the adapter name is typed — switching is deliberate.
    expect(screen.getByText(/Agents start fresh sessions on openclaw/)).toBeTruthy()
    expect(posts).toEqual([])
    expect((screen.getByTestId('switch-confirm') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'openclaw' } })
    fireEvent.click(screen.getByTestId('switch-confirm'))
    await waitFor(() => expect(posts).toEqual([{ target: 'openclaw' }]))
  })
})

describe('ExtensionsSection', () => {
  const EXT_PATH = '/home/u/.pi/agent/node_modules/pi-image-gen/index.js'
  const report = (status: 'pending' | 'allowed') => ({
    supported: true,
    mode: 'allowlist',
    // id === path: trust names exactly one module.
    extensions: [{ id: EXT_PATH, label: 'npm:pi-image-gen', source: 'npm package', path: EXT_PATH, status }],
  })

  it('renders nothing when the runtime has no extension mechanism', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ supported: false, mode: 'allowlist', extensions: [] }), { status: 200 })) as unknown as typeof fetch
    const { ExtensionsSection } = await import('../../packages/host/src/components/runtime/extensions-section')
    render(<ExtensionsSection />)
    await settleReact()
    expect(screen.queryByTestId('runtime-extensions')).toBeNull()
  })

  it('approve is ConfirmDialog-gated with the trust + spend disclosure, and flips to Allowed', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) })
        return new Response(JSON.stringify(report('allowed')), { status: 200 })
      }
      return new Response(JSON.stringify(report('pending')), { status: 200 })
    }) as unknown as typeof fetch

    const { ExtensionsSection } = await import('../../packages/host/src/components/runtime/extensions-section')
    render(<ExtensionsSection />)
    await waitFor(() => screen.getByTestId('ext-allow-npm:pi-image-gen'))
    expect(screen.getByText('Awaiting approval')).toBeTruthy()

    fireEvent.click(screen.getByTestId('ext-allow-npm:pi-image-gen'))
    await settleReact()
    // Nothing posted before confirm; disclosure present in the dialog.
    expect(posts).toEqual([])
    expect(screen.getByText(/full system permissions/i)).toBeTruthy()
    expect(screen.getByText(/OUTSIDE Bakin's budget caps/i)).toBeTruthy()

    fireEvent.click(screen.getByTestId('ext-confirm'))
    await waitFor(() => screen.getByText('Allowed'))
    expect(posts).toEqual([{ url: expect.stringContaining('/api/runtime/extensions/allow'), body: { id: EXT_PATH } }])
  })
})
