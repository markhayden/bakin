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
// router, so the house shim renders Link as a plain anchor (with `search`
// composed into the href, so deep links are assertable).
mock.module('@tanstack/react-router', () => require('../shims/tanstack-router'))

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '../rtl-settle'
import { settleReact } from '../rtl-settle'

import { useToastStore } from '@makinbakin/sdk/hooks'

import { finishedOperation, operationResponse, operationStarted } from '../helpers/operation-fetch'
import { OverviewTab } from '../../packages/host/src/components/runtime/overview-tab'
import { CapabilitiesTab } from '../../packages/host/src/components/runtime/capabilities-tab'
import { RuntimesTab } from '../../packages/host/src/components/runtime/runtimes-tab'
import type { CapabilityReport } from '../../packages/host/src/components/runtime/types'

const report: CapabilityReport = {
  adapter: 'pi',
  adapters: ['openclaw', 'pi'],
  runtime: { name: 'pi', version: '0.1.0' },
  capabilities: {
    toolCalling: { mode: 'native', access: { style: 'in-process', perTurnToolsMode: true } },
    delivery: { mode: 'unavailable' },
    imageGen: { mode: 'native' },
    memory: { mode: 'native' },
    sessions: { mode: 'native' },
    workspaceFiles: { mode: 'native' },
    concurrency: { sameAgentTurns: 'serialized' },
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
  it('says on the Tool access tile when per-turn tool policy is NOT enforced (#883 honesty)', async () => {
    const dropped: CapabilityReport = {
      ...report,
      adapter: 'openclaw',
      capabilities: { ...report.capabilities, toolCalling: { mode: 'native', access: { style: 'mcp', perTurnToolsMode: false } } },
      toolAccess: { style: 'mcp', ok: true, issues: [] },
    }
    await act(async () => {
      render(<OverviewTab report={dropped} onRefreshOnboarding={() => {}} onboarding={[]} />)
    })
    expect(screen.getByText(/Per-turn tool policy is not enforced: a text-only turn keeps its tools/)).toBeTruthy()
  })

  it('speaks plain language: honest unavailable copy, legend, credential tiles, setup rows', async () => {
    await act(async () => {
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
    })
    // Identity + credentials
    expect(screen.getByText('pi')).toBeTruthy()
    expect(screen.getByText(/anthropic · subscription/)).toBeTruthy()
    // Tool access tile says whether a text-only turn is really tool-free (#883).
    expect(screen.getByText(/Per-turn tool policy is enforced: a text-only turn runs without tools/)).toBeTruthy()
    // Honest unavailable copy for delivery on pi — never a bare enum
    const capabilities = within(screen.getByRole('table', { name: 'Runtime capabilities' }))
    expect(capabilities.getByText(/Alerts and approvals appear in the app/)).toBeTruthy()
    expect(capabilities.getByText('Not available')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Runtime capabilities' }).getAttribute('data-variant')).toBe('separated')
    expect(screen.getByRole('combobox', { name: 'Sort runtime capabilities' })).toBeTruthy()
    // Legend present
    expect(screen.getByText(/Via Bakin — Bakin fills the gap itself/)).toBeTruthy()
    // Setup rows carry remediation for non-ok. It is a labelled table column
    // now, so the hand-rolled "→ " marker is gone with the divide-y card.
    expect(screen.getByRole('columnheader', { name: 'Remediation' })).toBeTruthy()
    expect(within(screen.getByRole('table', { name: 'Setup checks' })).getByText('Set one in Settings')).toBeTruthy()
    // budget is not headless-fixable — no Fix button; fixable components get one
    expect(screen.queryByTestId('setup-fix-budget')).toBeNull()
  })

  it('media is repairable from the hub (#895)', async () => {
    await act(async () => {
      render(
        <OverviewTab
          report={report}
          onRefreshOnboarding={() => {}}
          onboarding={[{ name: 'media', status: 'missing', message: 'no image processing' }]}
        />,
      )
    })
    expect(within(screen.getByRole('table', { name: 'Setup checks' })).getByTestId('setup-fix-media')).toBeTruthy()
  })

  it('the open dialog shows the live operation while the repair runs', async () => {
    const running = finishedOperation('op-media', { httpStatus: 200, body: null }, {
      kind: 'onboarding:media', title: 'Install the media store', status: 'running', outcome: undefined, result: undefined, endedAt: undefined,
      stages: [{ id: 'download', kind: 'downloading', label: 'Download pinned sharp packages', status: 'active', startedAt: new Date().toISOString(), bytes: { received: 4_000_000, total: 8_000_000 } }],
      plan: { stages: [{ id: 'download', kind: 'downloading', label: 'Download pinned sharp packages' }], pointOfNoReturn: 'commit' },
      cancellable: true,
    })
    const operations = new Map([['op-media', running]])
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/runtime/onboarding/install')) return operationStarted('op-media')
      return operationResponse(String(input), operations) ?? new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    await act(async () => {
      render(
        <OverviewTab
          report={report}
          onRefreshOnboarding={() => {}}
          onboarding={[{ name: 'media', status: 'missing', message: 'no image processing' }]}
        />,
      )
    })
    await act(async () => { fireEvent.click(within(screen.getByRole('table', { name: 'Setup checks' })).getByTestId('setup-fix-media')) })
    await settleReact()
    await act(async () => { fireEvent.click(screen.getByTestId('setup-repair-confirm')) })
    await waitFor(() => expect(screen.getByText('Download pinned sharp packages')).toBeTruthy())
    // The operation's Cancel is live (before the commit); the dialog's own
    // Cancel is disabled while the repair runs.
    const cancels = screen.getAllByRole('button', { name: 'Cancel' })
    expect(cancels.filter((b) => !b.hasAttribute('disabled'))).toHaveLength(1)
  })

  it('warn rows expose Repair, confirm-gated, starting the install operation and following it to the result', async () => {
    const posts: Array<Record<string, unknown>> = []
    // The route answers 202 and the result arrives on the operation (#895).
    const operations = new Map([['op-sync', finishedOperation('op-sync', { httpStatus: 200, body: { ok: true, result: { status: 'installed', message: 'synced 3 agents' } } }, { kind: 'onboarding:agent-sync' })]])
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/runtime/onboarding/install')) {
        posts.push(JSON.parse(String(init?.body)))
        return operationStarted('op-sync')
      }
      return operationResponse(String(input), operations) ?? new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const refreshed: number[] = []
    await act(async () => {
      render(
        <OverviewTab
          report={report}
          onRefreshOnboarding={() => refreshed.push(1)}
          onboarding={[{ name: 'agent-sync', status: 'warn', message: '3 findings', remediation: 'Run bakin install agent-sync' }]}
        />,
      )
    })
    useToastStore.setState({ toasts: [] })
    await act(async () => { fireEvent.click(within(screen.getByRole('list', { name: 'Setup checks' })).getByTestId('setup-fix-agent-sync')) })
    await settleReact()
    // Confirmation first — nothing posted yet.
    expect(posts).toEqual([])
    await act(async () => { fireEvent.click(screen.getByTestId('setup-repair-confirm')) })
    // Confirming in the dialog IS the approval: explicit options, nothing implied.
    await waitFor(() => expect(posts).toEqual([{ component: 'agent-sync', options: { autoApprove: true } }]))
    await waitFor(() => expect(refreshed.length).toBe(1))
    // Success feedback reaches the REAL toast store (the one the shell
    // Toaster reads) with the result message.
    const toasts = useToastStore.getState().toasts
    expect(toasts.length).toBe(1)
    expect(String(toasts[0].message)).toContain('synced 3 agents')
  })

  it('a second Repair click while the first request is pending sends nothing (#895 review)', async () => {
    const posts: number[] = []
    let accept!: () => void
    const accepted = new Promise<void>((resolve) => { accept = resolve })
    const operations = new Map([['op-assets', finishedOperation('op-assets', { httpStatus: 200, body: { ok: true, result: { status: 'installed', message: 'done' } } })]])
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/runtime/onboarding/install')) {
        posts.push(1)
        await accepted
        return operationStarted('op-assets')
      }
      return operationResponse(String(input), operations) ?? new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    await act(async () => {
      render(<OverviewTab report={report} onRefreshOnboarding={() => {}} onboarding={[{ name: 'plugin-assets', status: 'warn', message: '1 drifted' }]} />)
    })
    await act(async () => { fireEvent.click(within(screen.getByRole('table', { name: 'Setup checks' })).getByTestId('setup-fix-plugin-assets')) })
    await settleReact()
    await act(async () => { fireEvent.click(screen.getByTestId('setup-repair-confirm')) })
    await act(async () => { fireEvent.click(screen.getByTestId('setup-repair-confirm')) })
    expect(posts).toEqual([1])
    await act(async () => { accept() })
    await settleReact()
  })

  it('a failed repair surfaces the reason', async () => {
    const operations = new Map([['op-assets', finishedOperation('op-assets', { httpStatus: 200, body: { ok: false, result: { status: 'failed', message: 'runtime unreachable' } } }, { status: 'failed', outcome: { code: 'component_failed', message: 'runtime unreachable' } })]])
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/runtime/onboarding/install')) return operationStarted('op-assets')
      return operationResponse(String(input), operations) ?? new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    await act(async () => {
      render(
        <OverviewTab
          report={report}
          onRefreshOnboarding={() => {}}
          onboarding={[{ name: 'plugin-assets', status: 'warn', message: '1 drifted' }]}
        />,
      )
    })
    await act(async () => { fireEvent.click(within(screen.getByRole('table', { name: 'Setup checks' })).getByTestId('setup-fix-plugin-assets')) })
    await settleReact()
    // Flush the repair fetch inside act instead of polling for it: leaning on
    // waitFor's default budget made this the first test to starve under CI
    // contention (observed at 37s against a 15s limit).
    await act(async () => { fireEvent.click(screen.getByTestId('setup-repair-confirm')) })
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

    await act(async () => { render(<CapabilitiesTab />) })
    const table = within(await screen.findByRole('table', { name: 'Installed capabilities' }))
    expect(table.getByText('Web Search (Brave)')).toBeTruthy()
    expect(table.getByText(/Give your agents real web search/)).toBeTruthy()
    expect(table.getByText('Needs attention')).toBeTruthy()
    expect(table.getByText(/BRAVE_SEARCH_API_KEY not set/)).toBeTruthy()
    expect(table.getByText(/dependencies scripts missing/)).toBeTruthy()
    expect(table.getByText(/model parakeet missing \(897 MB\)/)).toBeTruthy()
    expect(table.getByText(/Google Chrome not installed/)).toBeTruthy()
    expect(table.getByText('Add the key in Settings')).toBeTruthy()
    // Deep link straight to Integrations & Keys, not the settings landing tab.
    expect(table.getByText('Add the key in Settings').closest('a')?.getAttribute('href')).toBe('/settings?tab=integrations')
  })

  it('empty state invites the user to Explore', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ capabilities: [] }), { status: 200 })) as unknown as typeof fetch
    await act(async () => { render(<CapabilitiesTab />) })
    await waitFor(() => screen.getByText('No capabilities installed yet'))
    expect(screen.getByText('Browse capabilities')).toBeTruthy()
  })
})

describe('RuntimesTab', () => {
  let posts: Array<Record<string, unknown>> = []
  const operations = new Map<string, ReturnType<typeof finishedOperation>>()

  beforeEach(() => {
    posts = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/runtime/switch')) {
        posts.push(JSON.parse(String(init?.body)))
        // The switch is an operation (#895): 202, then the report rides its result.
        operations.set('op-switch', finishedOperation('op-switch', { httpStatus: 200, body: {
          ok: true, from: 'pi', to: 'openclaw', dryRun: true, backupPath: null, restartRequired: false,
          roster: {
            carried: [{ agentId: 'main' }], existing: ['pixel'],
            unmappedModels: [], preserved: [{ agentId: 'scout', sourceModel: 'openai/gpt-5.5-mini' }], failed: [],
          },
          workspaces: { carried: [{ agentId: 'main', files: 3, bytes: 100 }], skills: [], skippedExisting: [], failed: [] },
          cron: {
            adopted: ['daily-report'], skipped: [],
            refused: [{ jobId: 'dream', name: 'dream', reason: 'not a task prompt — a schedule needs a prompt an agent can act on' }],
            failed: [],
            listing: [
              { jobId: 'daily-report', name: 'Daily report', outcome: 'adopt', commandPreview: 'Post the daily report' },
              { jobId: 'dream', name: 'dream', outcome: 'refuse', commandPreview: '__openclaw_memory_core_short_term_promotion_dream__', reason: 'not a task prompt — a schedule needs a prompt an agent can act on' },
            ],
          },
          cantCarry: [{ concern: 'sessions', detail: 'runtime session context resets' }],
          channels: {
            source: { owner: 'runtime', state: 'native' },
            target: { owner: 'bridge', projectedState: 'missing_token', tokenSource: null },
            setup: ['Add the Discord bot token in Settings → Channels (/settings?tab=channels) — the bridge cannot connect without it.'],
            ownership: "openclaw's bot token stays in openclaw's own config. pi delivers through Bakin's Discord bridge, which needs its OWN token in Settings → Channels — Bakin never reads the runtime's secret.",
          },
          credentials: { llmProviders: [] }, sync: null,
        } }, { kind: 'runtime-switch:preview' }))
        return operationStarted('op-switch')
      }
      return operationResponse(url, operations) ?? new Response('{}', { status: 200 })
    }) as typeof fetch
  })

  it('while a preview request is pending, nothing else can start a switch (#895 review)', async () => {
    let accept!: () => void
    const accepted = new Promise<void>((resolve) => { accept = resolve })
    const base = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/runtime/switch')) await accepted
      return base(input, init)
    }) as typeof fetch
    await act(async () => { render(<RuntimesTab report={report} onSwitched={() => {}} />) })
    await act(async () => { fireEvent.click(within(screen.getByRole('list', { name: 'Available runtimes' })).getByTestId('switch-target-openclaw')) })
    await settleReact()
    await act(async () => { fireEvent.click(screen.getByTestId('switch-preview')) })

    const target = within(screen.getByRole('list', { name: 'Available runtimes' })).getByTestId('switch-target-openclaw') as HTMLButtonElement
    expect(target.disabled).toBe(true)
    await act(async () => { accept() })
    await waitFor(() => screen.getByTestId('switch-result'))
    expect(posts).toHaveLength(1)
  })

  it('preview posts a dry run with the chosen options and renders grouped result cards', async () => {
    await act(async () => {
      render(<RuntimesTab report={report} onSwitched={() => {}} />)
    })
    // Clicking a runtime card opens the dialog — options + preview live THERE.
    await act(async () => { fireEvent.click(within(screen.getByRole('list', { name: 'Available runtimes' })).getByTestId('switch-target-openclaw')) })
    await settleReact()
    await act(async () => { fireEvent.click(screen.getByTestId('switch-adopt-cron')) })
    await act(async () => { fireEvent.click(screen.getByTestId('switch-preview')) })

    await waitFor(() => screen.getByTestId('switch-result'))
    expect(posts).toEqual([{ target: 'openclaw', dryRun: true, adoptCron: true }])
    // Summary card + attention card content
    expect(screen.getByText('Preview: pi → openclaw')).toBeTruthy()
    expect(screen.getByText(/would be adopted/)).toBeTruthy()
    // Refusals are first-class: a tile, an attention line, and a per-job listing with a status per row.
    expect(screen.getByText('cron jobs refused')).toBeTruthy()
    expect(screen.getByText(/cron dream: refused/)).toBeTruthy()
    const listing = screen.getByTestId('switch-cron-listing')
    expect(within(listing).getByText('Adopted')).toBeTruthy()
    expect(within(listing).getByText('Refused')).toBeTruthy()
    expect(within(listing).getByText('__openclaw_memory_core_short_term_promotion_dream__')).toBeTruthy()
    expect(screen.getByText(/subagent model 'openai\/gpt-5.5-mini' preserved/)).toBeTruthy()
    expect(screen.getByText(/no model providers configured/)).toBeTruthy()
    expect(screen.getByText('Stays behind')).toBeTruthy()
    // Channel ownership section + the setup step surfaces in "Needs your attention" (#908 §4.9).
    expect(screen.getByTestId('switch-channels')).toBeTruthy()
    expect(screen.getByText(/Bakin never reads the runtime's secret/)).toBeTruthy()
    expect(screen.getByText(/Channels: Add the Discord bot token/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Settings → Channels' }).getAttribute('href')).toBe('/settings?tab=channels')
    // A dry-run result funnels back into the confirm dialog — the only
    // path to a real switch.
    await act(async () => { fireEvent.click(screen.getByTestId('switch-execute')) })
    await settleReact()
    expect(screen.getByTestId('switch-confirm')).toBeTruthy()
  })

  it('the active runtime is marked and not selectable', async () => {
    await act(async () => {
      render(<RuntimesTab report={report} onSwitched={() => {}} />)
    })
    expect(within(screen.getByRole('table', { name: 'Available runtimes' })).getByText('Active')).toBeTruthy()
    const table = within(screen.getByRole('table', { name: 'Available runtimes' }))
    expect((table.getByTestId('switch-target-pi') as HTMLButtonElement).disabled).toBe(true)
    expect((table.getByTestId('switch-target-openclaw') as HTMLButtonElement).disabled).toBe(false)
  })

  it('the real switch is gated behind a TYPED confirm dialog', async () => {
    await act(async () => {
      render(<RuntimesTab report={report} onSwitched={() => {}} />)
    })
    await act(async () => { fireEvent.click(within(screen.getByRole('table', { name: 'Available runtimes' })).getByTestId('switch-target-openclaw')) })
    await settleReact()

    // Consequences live in the dialog; nothing posted; confirm stays
    // disabled until the adapter name is typed — switching is deliberate.
    expect(screen.getByText(/Agents start fresh sessions on openclaw/)).toBeTruthy()
    expect(posts).toEqual([])
    expect((screen.getByTestId('switch-confirm') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.change(screen.getByRole('textbox'), { target: { value: 'openclaw' } }) })
    await act(async () => { fireEvent.click(screen.getByTestId('switch-confirm')) })
    await waitFor(() => expect(posts).toEqual([{ target: 'openclaw' }]))
  })
})

describe('ExtensionsSection', () => {
  const EXT_PATH = '/home/u/.pi/agent/node_modules/pi-image-gen/index.js'
  const report = (status: 'pending' | 'allowed') => ({
    supported: true,
    mode: 'allowlist',
    // id === path: trust names exactly one module.
    extensions: [{ id: EXT_PATH, label: 'npm:pi-image-gen', source: 'npm package', path: EXT_PATH, sha256: 'a'.repeat(64), status }],
  })

  it('shows an error state (not a hidden section) when discovery fails', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    const { ExtensionsSection } = await import('../../packages/host/src/components/runtime/extensions-section')
    // Flush the mount fetch — its resolution otherwise lands outside act
    // and leaves React work in flight when the test ends.
    await act(async () => { render(<ExtensionsSection />) })
    await waitFor(() => screen.getByTestId('runtime-extensions-error'))
    expect(screen.getByText(/Couldn't load extensions/i)).toBeTruthy()
  })

  it('renders nothing when the runtime has no extension mechanism', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ supported: false, mode: 'allowlist', extensions: [] }), { status: 200 })) as unknown as typeof fetch
    const { ExtensionsSection } = await import('../../packages/host/src/components/runtime/extensions-section')
    // Flush the mount fetch — its resolution otherwise lands outside act
    // and leaves React work in flight when the test ends.
    await act(async () => { render(<ExtensionsSection />) })
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
    // Flush the mount fetch — its resolution otherwise lands outside act
    // and leaves React work in flight when the test ends.
    await act(async () => { render(<ExtensionsSection />) })
    const narrow = within(await screen.findByRole('list', { name: 'Runtime extensions' }))
    expect(narrow.getByText('Awaiting approval')).toBeTruthy()

    await act(async () => { fireEvent.click(narrow.getByTestId('ext-allow-npm:pi-image-gen')) })
    await settleReact()
    // Nothing posted before confirm; disclosure present in the dialog.
    expect(posts).toEqual([])
    expect(screen.getByText(/full system permissions/i)).toBeTruthy()
    expect(screen.getByText(/OUTSIDE Bakin's budget caps/i)).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByTestId('ext-confirm')) })
    await waitFor(() => narrow.getByText('Allowed'))
    expect(posts).toEqual([{ url: expect.stringContaining('/api/runtime/extensions/allow'), body: { id: EXT_PATH } }])
    // Approval triggers a follow-up re-fetch; drain it so nothing is left in
    // flight when the test ends (that residue is what stalls the settle hook).
    await settleReact()
  })
})
