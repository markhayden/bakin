// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../rtl-settle'
import { ModelsPage } from '../../plugins/models/components/models-page'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

/** Initial URL state per key — a test sets `?ref=` / `?tab=` here before rendering. */
const queryOverrides: Record<string, string> = {}
mock.module('@makinbakin/sdk/navigation', () => ({
  useQueryState: (key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(queryOverrides[key] ?? defaultValue)
  },
  useQueryArrayState: () => {
    const React = require('react') as typeof import('react')
    return React.useState<string[]>([])
  },
  // The guard's own behavior is covered by its story; here it only needs to mount.
  useUnsavedChangesGuard: () => ({ requestExit: () => {}, reset: () => {}, dialog: null }),
}))

const runtimeState = {
  pending: false,
  advice: { needed: false } as { needed: boolean; title?: string; body?: string; action?: { label: string; kind: 'restart-runtime' } },
  lastError: null as string | null,
  refresh: mock(async () => {}),
  restarting: false,
  restart: mock(),
}

mock.module('@/hooks/use-runtime-status', () => ({
  useRuntimeStatus: () => runtimeState,
}))

/** Roster store (teams + team assignments) — the Agents tab groups by it. */
let agentStoreState: { teams: Array<Record<string, unknown>>; displaySettings: Record<string, Record<string, unknown>> } = { teams: [], displaySettings: {} }
mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ ...agentStoreState, agentMap: {}, agents: [], load: async () => {} }),
  useAgent: () => undefined,
  useAgentColor: () => '#a1a1aa',
  useAgentList: () => [],
  useMainAgentId: () => 'main',
}))

interface FetchCall {
  method: string
  url: string
  body?: Record<string, unknown>
}

interface AvailableModelsPayload {
  models: Array<Record<string, unknown>>
  cached: boolean
  cachedAt: number | null
  stale?: boolean
  error?: string | null
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ModelsPage component', () => {
  let fetchCalls: FetchCall[]
  /** The first CONFIGURATION write — the page's own `ui:mode` view persist is not one. */
  const configWrite = () => fetchCalls.find((c) => c.method === 'POST' && c.url === '/api/plugins/models/selections'
    && !((c.body?.ops as Array<{ ref: string }> | undefined) ?? []).every((op) => op.ref === 'ui:mode'))
  let availableFetchCount: number
  let selectionsRevision = 0
  /** Per-test override of what a POST returns (partial failure, pending writes) — the fake applies the ops regardless. */
  let mutationOverride: ((ops: Array<{ ref: string; set: { model?: string | null; thinking?: string | null } }>) => { applied?: string[]; failed?: Array<{ ref: string; error: { code: string; message: string } }>; pending?: Array<{ ref: string; intended: string | null }> }) | null
  let availableResponse: AvailableModelsPayload
  let refreshResponse: AvailableModelsPayload
  let availableRequest: Promise<Response> | null
  let refreshRequest: Promise<Response> | null
  let configState: {
    agents: Array<Record<string, unknown>>
    defaultModel: string
    defaultSubagentModel: string | null
    fallbackModels: string[]
  }
  let aliasesState: Record<string, string>
  let uiModeState: string | null
  let pendingState: Array<Record<string, unknown>>
  let supportState: Record<string, unknown>
  let eligibilityState: Record<string, Record<string, unknown>>
  let proposalsState: Array<Record<string, unknown>>
  let routeProposalsState: { proposals: Array<Record<string, unknown>>; skipped: Array<Record<string, unknown>> }
  let evidenceState: Record<string, string>
  let routingState: {
    routes: Array<{ workClass: string; model?: string; thinking?: string }>
    tagOverrides: Array<{ tag: string; model?: string; thinking?: string }>
  }

  beforeEach(() => {
    cleanup()
    mock.restore()
    runtimeState.refresh.mockReset()
    fetchCalls = []
    availableFetchCount = 0
    selectionsRevision = 0
    mutationOverride = null
    configState = {
      agents: [
        { agentId: 'patch', name: 'Patch', ownModel: null, subagentModel: null },
        { agentId: 'main', name: 'Main', ownModel: null, subagentModel: null },
      ],
      defaultModel: 'anthropic/claude-sonnet-4-6',
      defaultSubagentModel: 'anthropic/claude-haiku-4-5',
      fallbackModels: ['anthropic/claude-opus-4-6'],
    }
    availableResponse = {
      models: [
        { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', tier: 'standard', isDefault: configState.defaultModel === 'anthropic/claude-sonnet-4-6', configured: true, tags: ['configured'] },
        { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', tier: 'premium', configured: true, tags: ['configured'] },
        { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'budget', configured: true, tags: ['configured'] },
        { id: 'openai-codex/gpt-5.4', name: 'GPT-5.4', provider: 'openai-codex', tier: 'premium', isDefault: configState.defaultModel === 'openai-codex/gpt-5.4', configured: true, tags: ['configured'] },
        { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', tier: 'premium', configured: false, tags: [] },
      ],
      cached: false,
      cachedAt: null,
    }
    refreshResponse = availableResponse
    availableRequest = null
    refreshRequest = null
    aliasesState = {
      sonnet: 'anthropic/claude-sonnet-4-6',
    }
    uiModeState = null
    agentStoreState = { teams: [], displaySettings: {} }
    pendingState = []
    routeProposalsState = { proposals: [], skipped: [] }
    eligibilityState = {}
    proposalsState = []
    supportState = { defaultModel: true, fallbackModels: true, defaultSubagentModel: true, aliases: true, perAgentSubagentModel: true, supportedThinkingLevels: ['off', 'low', 'medium', 'high'], perTurnModel: true }
    evidenceState = { catalog: 'ok', runtimeAvailability: 'ok', credentials: 'ok', rejections: 'ok' }
    for (const key of Object.keys(queryOverrides)) delete queryOverrides[key]
    routingState = {
      routes: [
        { workClass: 'workflow', model: 'anthropic/claude-sonnet-4-6', thinking: 'medium' },
      ],
      tagOverrides: [],
    }
    runtimeState.pending = false
    runtimeState.advice = { needed: false }
    runtimeState.lastError = null
    runtimeState.restarting = false
    runtimeState.restart.mockReset()

    vi.stubGlobal('fetch', mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      fetchCalls.push({ method, url, body })

      if (url === '/api/plugins/models/available' && method === 'GET') {
        availableFetchCount += 1
        return availableRequest ?? jsonResponse(availableResponse)
      }
      if (url === '/api/plugins/models/refresh' && method === 'POST') {
        return refreshRequest ?? jsonResponse(refreshResponse)
      }
      // The page's whole contract: GET /selections + GET /plan, POST /selections
      // (the ONE write path, #907), GET /available + POST /refresh. The read
      // mirrors the fake config so the page classifies its mode honestly.
      if (url === '/api/plugins/models/selections' && method === 'GET') {
        const states = [
          { ref: 'policy:defaultModel', model: configState.defaultModel, document: 'policy', label: 'Default model' },
          { ref: 'policy:defaultSubagentModel', model: configState.defaultSubagentModel, document: 'policy', label: 'Default subagent model' },
          ...configState.fallbackModels.map((model, n) => ({ ref: `policy:fallback:${n}`, model, document: 'policy', label: `Fallback ${n + 1}` })),
          ...Object.entries(aliasesState).map(([name, model]) => ({ ref: `policy:alias:${name}`, model, document: 'policy', label: `Alias ${name}` })),
          ...configState.agents.flatMap((agent) => [
            { ref: `agent:${agent.agentId}:model`, model: agent.ownModel ?? null, document: `agent:${agent.agentId}`, label: String(agent.name) },
            { ref: `agent:${agent.agentId}:subagentModel`, model: agent.subagentModel ?? null, document: `agent:${agent.agentId}`, label: `${agent.name} subagents` },
          ]),
          ...routingState.routes.map((r) => ({ ref: `route:${r.workClass}`, model: r.model ?? null, ...(r.thinking ? { thinking: r.thinking } : {}), document: 'routing', label: r.workClass })),
          ...routingState.tagOverrides.map((t) => ({ ref: `tag:${t.tag}`, model: t.model ?? null, ...(t.thinking ? { thinking: t.thinking } : {}), document: 'routing', label: t.tag })),
          { ref: 'ui:mode', model: uiModeState, document: 'routing', label: 'Models page mode' },
        ]
        const withEligibility = states.map((st) => (typeof st.model === 'string' && st.ref !== 'ui:mode' ? { ...st, eligibility: eligibilityState[st.model] ?? { status: 'eligible', detail: 'ok' } } : st))
        return jsonResponse({ revision: `rev-${selectionsRevision}`, support: supportState, states: withEligibility, proposals: proposalsState, pending: pendingState, evidence: evidenceState })
      }
      if (url === '/api/plugins/models/plan' && method === 'GET') {
        const agent = configState.defaultModel
        return jsonResponse({
          revision: `rev-${selectionsRevision}`,
          current: { agent, chores: { model: agent, models: [agent], mixed: false }, enrichmentEnabled: true },
          recommended: {
            agent: { model: agent, why: 'Your current default model — it can run here.', suitability: 'known' },
            chores: { model: 'anthropic/claude-haiku-4-5', why: '~$6 per 1M tokens vs ~$18 for anthropic/claude-sonnet-4-6', suitability: 'known' },
            routes: ['auto-title', 'enrichment', 'relay', 'team-routing', 'skill-mapping'].map((workClass) => ({ workClass, model: 'anthropic/claude-haiku-4-5', reason: 'cheapest' })),
            enrichment: 'chores',
            ops: ['auto-title', 'enrichment', 'relay', 'team-routing', 'skill-mapping'].map((workClass) => ({ ref: `route:${workClass}`, set: { model: 'anthropic/claude-haiku-4-5' } })),
            notes: [],
          },
          routeProposals: routeProposalsState,
          candidates: 4,
        })
      }
      if (url === '/api/plugins/models/selections' && method === 'POST') {
        // Revision-checked like the real mutator: every write moves it, and
        // a write under an old one is refused — including the page's own
        // first-visit ui:mode persist, which advances it too.
        if (body?.revision !== `rev-${selectionsRevision}`) {
          return jsonResponse({ error: 'stale_revision', message: 'the configuration changed since this change was planned', current: `rev-${selectionsRevision}` }, 409)
        }
        const ops = (body?.ops as Array<{ ref: string; set: { model?: string | null; thinking?: string | null } }>) ?? []
        for (const op of ops) {
          const [kind, a, b] = op.ref.split(':')
          if (kind === 'policy' && a === 'defaultModel' && typeof op.set.model === 'string') {
            const next = op.set.model
            configState = { ...configState, defaultModel: next, agents: configState.agents.map((agent) => ({ ...agent, defaultModel: next, effectiveModel: agent.ownModel ?? next })) }
          } else if (kind === 'policy' && a === 'defaultSubagentModel') {
            configState = { ...configState, defaultSubagentModel: op.set.model ?? null }
          } else if (kind === 'policy' && a === 'fallback') {
            const n = Number(b)
            const fallbacks = [...configState.fallbackModels]
            if (op.set.model === null) fallbacks.splice(n, 1); else fallbacks[n] = String(op.set.model)
            configState = { ...configState, fallbackModels: fallbacks }
          } else if (kind === 'policy' && a === 'alias' && b) {
            if (op.set.model === null) delete aliasesState[b]; else aliasesState[b] = String(op.set.model)
          } else if (kind === 'agent' && a && b === 'model') {
            configState = { ...configState, agents: configState.agents.map((agent) => agent.agentId === a ? { ...agent, ownModel: op.set.model ?? null, effectiveModel: op.set.model ?? configState.defaultModel } : agent) }
          } else if (kind === 'agent' && a && b === 'subagentModel') {
            configState = { ...configState, agents: configState.agents.map((agent) => agent.agentId === a ? { ...agent, subagentModel: op.set.model ?? null } : agent) }
          } else if (kind === 'route' && a) {
            const routes = routingState.routes.filter((r) => r.workClass !== a)
            const existing = routingState.routes.find((r) => r.workClass === a) ?? { workClass: a }
            const next = { ...existing } as { workClass: string; model?: string; thinking?: string }
            if (op.set.model !== undefined) { if (op.set.model) next.model = op.set.model; else delete next.model }
            if (op.set.thinking !== undefined) { if (op.set.thinking) next.thinking = op.set.thinking; else delete next.thinking }
            if (next.model || next.thinking) routes.push(next as typeof routingState.routes[number])
            routingState = { ...routingState, routes }
          } else if (kind === 'ui' && a === 'mode') {
            uiModeState = op.set.model ?? null
          } else if (kind === 'tag' && a) {
            const tagOverrides = routingState.tagOverrides.filter((t) => t.tag !== a)
            if (op.set.model || op.set.thinking) tagOverrides.push({ tag: a, ...(op.set.model ? { model: op.set.model } : {}), ...(op.set.thinking ? { thinking: op.set.thinking } : {}) } as typeof routingState.tagOverrides[number])
            routingState = { ...routingState, tagOverrides }
          }
        }
        selectionsRevision += 1
        const outcome = mutationOverride?.(ops) ?? {}
        return jsonResponse({ applied: ops.map((o) => o.ref), failed: [], pending: [], warnings: [], ...outcome, revision: `rev-${selectionsRevision}`, ...(body?.snapshot === 'reset' ? { snapshot: '/tmp/snapshots/2026-09-22.json' } : {}) })
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const openTab = async (name: 'Agents' | 'Work routing') => fireEvent.click(await screen.findByRole('tab', { name }))

  /**
   * A `?ref=` deep link has landed when its control holds focus AND the
   * picker is ready: Base UI pre-mounts a Select's popup the moment its
   * trigger gains focus, so a test that stops at the focus leaves that
   * mount in flight (the act gate catches exactly that).
   */
  const deepLinkLanded = async (controlLabel: string) => {
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe(controlLabel))
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
  }

  describe('Advanced view (S4, support-gated)', () => {
    it('Defaults: changing the default model stages one policy op; the subagent default renders when supported', async () => {
      const user = userEvent.setup()
      render(<ModelsPage />)
      await user.click(await screen.findByRole('combobox', { name: 'Default model' }))
      await user.click(await screen.findByRole('option', { name: 'GPT-5.4' }))
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('1 change staged')
      expect(screen.getByRole('combobox', { name: 'Default subagent model' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(configWrite()).toBeTruthy())
      expect(configWrite()?.body?.ops).toEqual([{ ref: 'policy:defaultModel', set: { model: 'openai-codex/gpt-5.4' } }])
    })

    it('Overview opens by default: default model, recommendation, in-use tiles and the extras disclosure', async () => {
      render(<ModelsPage />)
      expect((await screen.findByRole('tab', { name: 'Overview' })).getAttribute('aria-selected')).toBe('true')
      const stats = within(screen.getByTestId('overview-stats'))
      expect(stats.getByText('Agents on the default')).toBeTruthy()
      expect(stats.getByText('Tag overrides')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Use recommended plan' })).toBeTruthy()
      fireEvent.click(screen.getByText('More defaults'))
      expect(await screen.findByRole('combobox', { name: 'Default subagent model' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Remove fallback 1' })).toBeTruthy()
    })

    it('?tab= opens that tab; a ?ref= lands on its owning tab and the tablist still works afterwards', async () => {
      queryOverrides.tab = 'routing'
      const first = render(<ModelsPage />)
      expect(await screen.findByRole('region', { name: 'Agent work' })).toBeTruthy()
      first.unmount()
      cleanup()

      delete queryOverrides.tab
      queryOverrides.ref = 'agent:patch:model'
      render(<ModelsPage />)
      expect((await screen.findByRole('tab', { name: 'Agents' })).getAttribute('aria-selected')).toBe('true')
      await screen.findByText('Patch')
      // The ref seeded the tab once; the user can still move on.
      await openTab('Work routing')
      expect(await screen.findByRole('region', { name: 'Agent work' })).toBeTruthy()
      expect(screen.queryByText('Patch')).toBeNull()
      // …and coming back does not steal focus again: the deep link landed once.
      await openTab('Agents')
      await screen.findByText('Patch')
      expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Patch model')
    })

    it('a ?ref= row is visibly selected and its control takes focus — a deep link from Health lands on something you can see', async () => {
      queryOverrides.ref = 'agent:patch:model'
      render(<ModelsPage />)
      await deepLinkLanded('Patch model')
      const row = screen.getByText('Patch').closest('[data-agent-model-row]') as HTMLElement
      expect(row.hasAttribute('data-selected')).toBe(true)
      expect(document.activeElement).toBe(within(row).getByRole('combobox', { name: 'Patch model' }))
      const main = screen.getByText('Main').closest('[data-agent-model-row]')
      expect(main?.hasAttribute('data-selected')).toBe(false)
    })

    it('saving a new default leaves exactly ONE Default badge in the catalog (the catalog re-reads after a save)', async () => {
      const user = userEvent.setup()
      render(<ModelsPage />)
      await user.click(await screen.findByRole('combobox', { name: 'Default model' }))
      await user.click(await screen.findByRole('option', { name: 'GPT-5.4' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(configWrite()).toBeTruthy())
      await waitFor(() => expect(screen.queryByTestId('draft-summary')).toBeNull())
      const catalog = within(await screen.findByTestId('model-catalog'))
      await waitFor(() => {
        const defaults = catalog.getAllByRole('row').filter((r) => r.getAttribute('data-default') === 'true')
        expect(defaults).toHaveLength(1)
        expect(defaults[0]!.textContent).toContain('GPT-5.4')
      })
    })

    it('Agents carry a sortable Team column from the roster; the main agent leads by default', async () => {
      agentStoreState = { teams: [{ id: 'ops', label: 'Ops', reportsTo: null }], displaySettings: { patch: { teamId: 'ops' } } }
      render(<ModelsPage />)
      await openTab('Agents')
      const rows = await screen.findAllByRole('row')
      expect(rows.some((r) => r.textContent?.includes('Main'))).toBe(true)
      const patchRow = (await screen.findByText('Patch')).closest('[data-agent-model-row]') as HTMLElement
      expect(within(patchRow).getByText('Ops')).toBeTruthy()
      // Main first by default (Pixel-less fixture: Main before Patch), Team header sorts.
      const names = screen.getAllByRole('row').map((r) => r.textContent ?? '').filter((t) => t.includes('Use default model')).map((t) => (t.includes('Main') ? 'Main' : 'Patch'))
      expect(names[0]).toBe('Main')
      expect(screen.getByRole('columnheader', { name: /Team/ })).toBeTruthy()
    })

    it('knobs the runtime cannot persist are hidden behind one muted line (Pi shape)', async () => {
      supportState = { ...supportState, fallbackModels: false, aliases: false, defaultSubagentModel: false, perAgentSubagentModel: false }
      render(<ModelsPage />)
      await screen.findByRole('combobox', { name: 'Default model' })
      expect(screen.queryByText('More defaults')).toBeNull()
      expect(screen.getByTestId('unsupported-knobs').textContent).toContain("doesn't support fallbacks, aliases, a default subagent model")
      await openTab('Agents')
      await screen.findByText('Patch')
      expect(screen.queryByRole('combobox', { name: 'Patch subagents' })).toBeNull()
    })

    it('Fallbacks: removing the only fallback stages a clear of its index; adding stages the next index', async () => {
      render(<ModelsPage />)
      fireEvent.click(await screen.findByText('More defaults'))
      fireEvent.click(await screen.findByRole('button', { name: 'Remove fallback 1' }))
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('1 change staged')
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(configWrite()).toBeTruthy())
      expect(configWrite()?.body?.ops).toEqual([{ ref: 'policy:fallback:0', set: { model: null } }])
    })

    it('Aliases: adding stages a set op, removing stages a clear', async () => {
      const user = userEvent.setup()
      render(<ModelsPage />)
      fireEvent.click(await screen.findByText('More defaults'))
      fireEvent.change(await screen.findByRole('textbox', { name: 'New alias' }), { target: { value: 'fast' } })
      await user.click(screen.getByRole('combobox', { name: 'Target model' }))
      await user.click(await screen.findByRole('option', { name: 'Claude Haiku 4.5' }))
      fireEvent.click(screen.getByRole('button', { name: 'Add alias' }))
      fireEvent.click(screen.getByRole('button', { name: 'Remove alias sonnet' }))
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('2 changes staged')
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(configWrite()).toBeTruthy())
      expect(configWrite()?.body?.ops).toEqual([
        { ref: 'policy:alias:fast', set: { model: 'anthropic/claude-haiku-4-5' } },
        { ref: 'policy:alias:sonnet', set: { model: null } },
      ])
    })

    it('Agents: an override stages the agent ref; the row says whether it runs on the default', async () => {
      const user = userEvent.setup()
      render(<ModelsPage />)
      await openTab('Agents')
      const row = within((await screen.findByText('Patch')).closest('[data-agent-model-row]') as HTMLElement)
      expect(row.getByText('default')).toBeTruthy()
      await user.click(row.getByRole('combobox', { name: 'Patch model' }))
      await user.click(await screen.findByRole('option', { name: 'Claude Opus 4.6' }))
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('1 change staged')
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(configWrite()).toBeTruthy())
      expect(configWrite()?.body?.ops).toEqual([{ ref: 'agent:patch:model', set: { model: 'anthropic/claude-opus-4-6' } }])
    })

    it('Work routing: 11 classes in two groups; a model change stages a route op; a new tag override needs a model', async () => {
      const user = userEvent.setup()
      const { container } = render(<ModelsPage />)
      await openTab('Work routing')
      expect(await screen.findByRole('region', { name: 'Agent work' })).toBeTruthy()
      expect(screen.getByRole('region', { name: 'Background chores' })).toBeTruthy()
      expect(container.querySelectorAll('[data-routing-row]')).toHaveLength(11)
      await user.click(screen.getByRole('combobox', { name: /Scheduled model/i }))
      await user.click(await screen.findByRole('option', { name: 'Claude Haiku 4.5' }))
      const addOverride = screen.getByRole('button', { name: 'Add override' }) as HTMLButtonElement
      fireEvent.change(screen.getByRole('textbox', { name: 'Task tag' }), { target: { value: 'heavy' } })
      expect(addOverride.disabled).toBe(true)
      await user.click(screen.getByRole('combobox', { name: 'Model' }))
      await user.click(await screen.findByRole('option', { name: 'Claude Opus 4.6' }))
      // A tag that would break the ref (`tag:a:b`) or already exists cannot be added.
      fireEvent.change(screen.getByRole('textbox', { name: 'Task tag' }), { target: { value: 'a:b' } })
      expect(addOverride.disabled).toBe(true)
      expect(screen.getByText(/cannot contain/)).toBeTruthy()
      fireEvent.change(screen.getByRole('textbox', { name: 'Task tag' }), { target: { value: 'heavy' } })
      fireEvent.click(addOverride)
      fireEvent.change(screen.getByRole('textbox', { name: 'Task tag' }), { target: { value: 'heavy' } })
      expect(addOverride.disabled).toBe(true)
      expect(screen.getByText(/already has an override/)).toBeTruthy()
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('2 changes staged')
      expect(screen.getByRole('button', { name: 'Remove tag override heavy' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(configWrite()).toBeTruthy())
      expect(configWrite()?.body?.ops).toEqual([
        { ref: 'route:scheduled', set: { model: 'anthropic/claude-haiku-4-5' } },
        { ref: 'tag:heavy', set: { model: 'anthropic/claude-opus-4-6' } },
      ])
    })

    it('thinking dropdowns offer only runtime-supported levels; a persisted-but-unsupported level surfaces as clamping, never hidden', async () => {
      supportState = { ...supportState, supportedThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] }
      routingState = { routes: [{ workClass: 'relay', thinking: 'max' }], tagOverrides: [] }
      const user = userEvent.setup()
      render(<ModelsPage />)
      await openTab('Work routing')
      await user.click(await screen.findByRole('combobox', { name: 'Scheduled thinking' }))
      const options = screen.getAllByRole('option').map((o) => o.textContent)
      expect(options).toContain('Extra high')
      expect(options).not.toContain('Adaptive')
      expect(options).not.toContain('Maximum')
      await user.keyboard('{Escape}')
      await user.click(screen.getByRole('combobox', { name: 'Relay thinking' }))
      expect(await screen.findByRole('option', { name: 'Maximum · unsupported by this runtime' })).toBeTruthy()
    })

    it('"Use recommended routes" stages the route proposals from the plan', async () => {
      routeProposalsState = { proposals: [{ workClass: 'relay', model: 'anthropic/claude-haiku-4-5', reason: 'cheapest' }], skipped: [{ workClass: 'enrichment', reason: 'no vision model' }] }
      render(<ModelsPage />)
      await openTab('Work routing')
      fireEvent.click(await screen.findByRole('button', { name: 'Use recommended routes' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Skipped enrichment')).toBeTruthy()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Stage 1 route' }))
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('1 change staged')
    })

    it('a runtime that refuses per-turn overrides shows the notice and makes routing read-only', async () => {
      supportState = { ...supportState, perTurnModel: false }
      render(<ModelsPage />)
      await openTab('Work routing')
      expect(await screen.findByTestId('per-turn-clamped')).toBeTruthy()
      const scheduled = screen.getByRole('combobox', { name: /Scheduled model/i })
      expect(scheduled.getAttribute('aria-disabled') === 'true' || (scheduled as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'Use recommended routes' }) as HTMLButtonElement).disabled).toBe(true)
    })
  })

  it('renders the available models loading state while the runtime request is pending', async () => {
    const availableDeferred = createDeferred<Response>()
    availableRequest = availableDeferred.promise

    render(<ModelsPage />)
    const catalog = within(await screen.findByTestId('model-catalog'))

    expect(await catalog.findByText('Loading available models')).toBeTruthy()

    availableDeferred.resolve(jsonResponse(availableResponse))
    await catalog.findByText('Claude Sonnet 4.6')
  })

  it('renders the runtime models error state when no models are returned', async () => {
    availableResponse = {
      models: [],
      cached: false,
      cachedAt: null,
      error: 'runtime unavailable',
    }

    render(<ModelsPage />)

    expect(await screen.findByText('Models could not be loaded')).toBeTruthy()
    expect(screen.getByText('runtime unavailable')).toBeTruthy()
  })

  it("renders the pending-restart banner in the ADAPTER's words and calls restart (#878)", async () => {
    runtimeState.pending = true
    runtimeState.advice = { needed: true, title: 'Restart the OpenClaw gateway', body: 'Agents attach at gateway start.', action: { label: 'Restart gateway', kind: 'restart-runtime' } }
    runtimeState.lastError = 'gateway restart timed out'

    render(<ModelsPage />)

    expect(await screen.findByText('Restart the OpenClaw gateway')).toBeTruthy()
    expect(screen.getByText(/The last restart failed: gateway restart timed out/)).toBeTruthy()
    fireEvent.click(screen.getByText('Restart gateway'))

    expect(runtimeState.restart).toHaveBeenCalled()
  })

  it('renders no banner when nothing is pending (Pi after a model save)', async () => {
    runtimeState.pending = false
    render(<ModelsPage />)
    await screen.findByTestId('overview-stats')
    expect(screen.queryByText(/Restart/)).toBeNull()
  })

  it('disables the refresh button while a refresh request is in flight', async () => {
    const refreshDeferred = createDeferred<Response>()
    refreshRequest = refreshDeferred.promise

    render(<ModelsPage />)
    const catalog = within(await screen.findByTestId('model-catalog'))

    await catalog.findByText('Claude Sonnet 4.6')
    fireEvent.click(catalog.getByText('Refresh'))

    await waitFor(() => {
      // Busy contract: the control announces and goes inert without leaving the tab order.
      expect(catalog.getByText('Refreshing…').closest('button')?.getAttribute('aria-busy')).toBe('true')
      expect(catalog.getByText('Refreshing…').closest('button')?.getAttribute('aria-disabled')).toBe('true')
    })

    refreshDeferred.resolve(jsonResponse(refreshResponse))
    await catalog.findByText('Refresh')
  })

  it('the catalog keeps rejected and credential-less rows LISTED with a visible reason badge (#852/#907)', async () => {
    availableResponse = {
      ...availableResponse,
      models: [
        { id: 'openai-codex/gpt-5.4-mini', name: 'gpt-5.4-mini', tier: 'budget', provider: 'openai-codex', available: false, rejection: { lastSeenAt: Date.now() - 60_000, occurrences: 14 }, eligibility: { status: 'ineligible', reason: 'account_rejected', detail: 'rejected by your account (14 failures)' } },
        { id: 'openai-codex/gpt-5.6-luna', name: 'gpt-5.6-luna', tier: 'premium', provider: 'openai-codex', available: true, eligibility: { status: 'eligible', detail: 'ok' } },
        { id: 'openai/gpt-6-astra', name: 'gpt-6-astra', tier: 'premium', provider: 'openai', available: false, eligibility: { status: 'ineligible', reason: 'no_credentials', detail: 'no credentials for openai' } },
      ],
    }
    render(<ModelsPage />)
    const catalog = within(await screen.findByTestId('model-catalog'))
    expect(await catalog.findByText('gpt-5.4-mini')).toBeTruthy()
    const rejected = catalog.getByText('Not available to your account')
    expect(rejected.closest('[title]')?.getAttribute('title')).toContain('14')
    expect(catalog.getByText('No credentials').closest('[title]')?.getAttribute('title')).toContain('no credentials for openai')
    const healthy = catalog.getByText('gpt-5.6-luna').closest('[data-model-row]')!
    expect(within(healthy as HTMLElement).queryByText('Not available to your account')).toBeNull()
  })

  it('renders cached refresh age when available models come from cache', async () => {
    availableResponse = {
      ...availableResponse,
      cached: true,
      cachedAt: Date.now(),
    }

    render(<ModelsPage />)

    expect(await screen.findByText(/Refreshed just now/)).toBeTruthy()
  })

  it('renders enriched model metadata while leaving unmatched models plain', async () => {
    availableResponse = {
      models: [
        {
          id: 'openai-codex/gpt-5.4',
          name: 'GPT-5.4',
          provider: 'openai-codex',
          providerLabel: 'OpenAI Codex',
          providerBrandIconSlug: 'openai',
          providerBrandColor: '#111111',
          tier: 'premium',
          configured: true,
          tags: ['configured'],
          description: 'Best frontier coding model for long-running work.',
          bestFor: 'Complex coding',
          costRange: 'High cost',
        },
        {
          id: 'vendor/plain-runtime-model',
          name: 'Plain Runtime Model',
          provider: 'vendor',
          tier: 'standard',
          configured: false,
          tags: [],
        },
      ],
      cached: false,
      cachedAt: null,
    }

    render(<ModelsPage />)

    expect(await screen.findByText('Best frontier coding model for long-running work.')).toBeTruthy()
    expect(screen.getByText('Best for: Complex coding')).toBeTruthy()
    expect(screen.getByText('High cost')).toBeTruthy()

    const plainRow = screen.getByText('Plain Runtime Model').closest('[data-model-row]')
    expect(plainRow).toBeTruthy()
    expect(within(plainRow as HTMLElement).getByText('vendor/plain-runtime-model')).toBeTruthy()
    expect(within(plainRow as HTMLElement).queryByText('Complex coding')).toBeNull()
    expect(within(plainRow as HTMLElement).queryByText('High cost')).toBeNull()
  })

  it('uses the shared search pattern inside the catalog panel and strongly identifies the default model', async () => {
    render(<ModelsPage />)
    const catalog = within(await screen.findByTestId('model-catalog'))

    const search = await catalog.findByRole('searchbox', { name: 'Search the model catalog' })
    expect(search.closest('[data-slot="page-controls"]')).toBeTruthy()

    const defaultRow = catalog.getByText('Claude Sonnet 4.6').closest('[data-model-row]')
    expect(defaultRow?.getAttribute('data-default')).toBe('true')
    // The catalog is a DataTable now, so the default model is identified by its
    // visible Status badge rather than the Card selection ring it used to carry.
    expect(defaultRow?.textContent).toContain('Default')
  })

  describe('page shell (Simple/Advanced, spec §3.4)', () => {
    const modeWrites = () => fetchCalls.filter((c) => c.method === 'POST' && c.url === '/api/plugins/models/selections'
      && ((c.body?.ops as Array<{ ref: string; set: { model?: string | null } }> | undefined) ?? []).some((op) => op.ref === 'ui:mode'))

    it('classifies an install with customizations as Advanced, persists that once, and shows the mode switch', async () => {
      render(<ModelsPage />)
      expect((await screen.findByRole('tab', { name: 'Advanced' })).getAttribute('aria-selected')).toBe('true')
      expect(screen.getByRole('tabpanel', { name: 'Advanced' })).toBeTruthy()
      await waitFor(() => expect(modeWrites()).toHaveLength(1))
      expect(modeWrites()[0]!.body?.ops).toEqual([{ ref: 'ui:mode', set: { model: 'advanced' } }])
    })

    it('a plain two-lane install classifies as Simple and shows the lanes; no customizations line', async () => {
      configState = { ...configState, defaultSubagentModel: null, fallbackModels: [] }
      aliasesState = {}
      routingState = { routes: [], tagOverrides: [] }
      render(<ModelsPage />)
      expect((await screen.findByRole('tab', { name: 'Simple' })).getAttribute('aria-selected')).toBe('true')
      const panel = within(screen.getByRole('tabpanel', { name: 'Simple' }))
      const agentLane = within(await panel.findByTestId('lane-agent'))
      expect(agentLane.getByRole('combobox', { name: 'Model' }).textContent).toContain('Claude Sonnet 4.6')
      // Chores inherit the agent model — the picker says so in plain words.
      const choresLane = within(panel.getByTestId('lane-chores'))
      expect(choresLane.getByRole('combobox', { name: 'Model' }).textContent).toContain('Same as the agent model')
      expect(screen.queryByTestId('customizations-line')).toBeNull()
    })

    it('a persisted mode wins over classification; switching writes ui:mode and flips the view', async () => {
      uiModeState = 'simple'
      render(<ModelsPage />)
      expect((await screen.findByRole('tab', { name: 'Simple' })).getAttribute('aria-selected')).toBe('true')
      // Customizations exist (fallback, alias, subagent default, workflow route) — Simple says so.
      expect((await screen.findByTestId('customizations-line')).textContent).toContain('customizations active')
      // No write on load: the mode was already persisted.
      expect(modeWrites()).toHaveLength(0)
      fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))
      await waitFor(() => expect(modeWrites()).toHaveLength(1))
      expect(modeWrites()[0]!.body?.ops).toEqual([{ ref: 'ui:mode', set: { model: 'advanced' } }])
      expect(await screen.findByRole('tabpanel', { name: 'Advanced' })).toBeTruthy()
    })

    it('?ref= into an Advanced-only layer flips the VIEW without writing the mode', async () => {
      uiModeState = 'simple'
      queryOverrides.ref = 'agent:patch:model'
      render(<ModelsPage />)
      // The deep link lands: the VIEW flips and focus moves to the pinned agent's control.
      await deepLinkLanded('Patch model')
      expect(screen.getByRole('tab', { name: 'Advanced' }).getAttribute('aria-selected')).toBe('true')
      expect(modeWrites()).toHaveLength(0)
    })

    it('?ref= to a chores route that carries a thinking level flips to Advanced — Simple has no thinking control to land on', async () => {
      uiModeState = 'simple'
      routingState = { routes: [{ workClass: 'relay', thinking: 'high' }], tagOverrides: [] }
      queryOverrides.ref = 'route:relay'
      render(<ModelsPage />)
      await deepLinkLanded('Relay model')
      expect(screen.getByRole('tab', { name: 'Advanced' }).getAttribute('aria-selected')).toBe('true')
      expect(screen.getByRole('combobox', { name: 'Relay thinking' })).toBeTruthy()
    })

    it('the first-visit mode persist moves the revision the page holds: a later view switch and a Reset both post under the CURRENT revision', async () => {
      // Fresh install: no persisted ui:mode ⇒ the page writes one on load (rev-0 → rev-1).
      render(<ModelsPage />)
      await waitFor(() => expect(modeWrites()).toHaveLength(1))
      fireEvent.click(await screen.findByRole('tab', { name: 'Simple' }))
      await waitFor(() => expect(modeWrites()).toHaveLength(2))
      expect(modeWrites()[1]!.body?.revision).toBe('rev-1')
      expect(uiModeState).toBe('simple')
      // Reset (an immediate write) is planned under the live revision, not the one the page loaded with.
      fireEvent.click(await screen.findByRole('button', { name: 'Reset to this plan…' }))
      const dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByPlaceholderText('reset'), { target: { value: 'reset' } })
      await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
      await waitFor(() => expect(configWrite()).toBeTruthy())
      expect(configWrite()?.body?.revision).toBe('rev-2')
      expect((await screen.findByRole('status')).textContent).toContain('bakin models restore')
    })

    it('pending adapter writes are summarized in the header meta', async () => {
      pendingState = [{ document: 'policy', refs: ['policy:defaultModel'], intended: { 'policy:defaultModel': 'openai-codex/gpt-5.4' }, state: 'unsettled', startedAt: Date.now() }]
      render(<ModelsPage />)
      expect((await screen.findByTestId('pending-writes')).textContent).toContain('1 write pending runtime confirmation')
    })

    it('partial credential evidence is disclosed in a banner', async () => {
      evidenceState = { catalog: 'ok', runtimeAvailability: 'ok', credentials: 'partial', rejections: 'ok' }
      render(<ModelsPage />)
      expect(await screen.findByText('Some availability facts could not be verified')).toBeTruthy()
    })
  })

  describe('Simple view (S4/S5/S11)', () => {
    const plain = () => {
      configState = { ...configState, defaultSubagentModel: null, fallbackModels: [] }
      aliasesState = {}
      routingState = { routes: [], tagOverrides: [] }
    }
    const CHORES = ['auto-title', 'enrichment', 'relay', 'skill-mapping', 'team-routing']

    it('picking a chores model stages five route ops; Save posts exactly those and nothing else', async () => {
      plain()
      const user = userEvent.setup()
      render(<ModelsPage />)
      const lane = within(await screen.findByTestId('lane-chores'))
      await user.click(lane.getByRole('combobox', { name: 'Model' }))
      await user.click(await screen.findByRole('option', { name: 'Claude Haiku 4.5' }))
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('5 changes staged')
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(configWrite()).toBeTruthy())
      expect(configWrite()?.body?.ops).toEqual(CHORES.map((workClass) => ({ ref: `route:${workClass}`, set: { model: 'anthropic/claude-haiku-4-5' } })))
      await waitFor(() => expect(screen.queryByTestId('draft-summary')).toBeNull())
    })

    it('a partially failed save keeps the failed ref staged with the reason on the bar; Retry posts ONLY that ref under the new revision (S10)', async () => {
      plain()
      mutationOverride = (ops) => ({
        applied: ops.filter((o) => o.ref !== 'route:enrichment').map((o) => o.ref),
        failed: [{ ref: 'route:enrichment', error: { code: 'adapter_failed', message: 'gateway down' } }],
      })
      const user = userEvent.setup()
      render(<ModelsPage />)
      const lane = within(await screen.findByTestId('lane-chores'))
      await user.click(lane.getByRole('combobox', { name: 'Model' }))
      await user.click(await screen.findByRole('option', { name: 'Claude Haiku 4.5' }))
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('5 changes staged')
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(configWrite()).toBeTruthy())
      await waitFor(() => expect(screen.getByTestId('draft-summary').textContent).toContain('1 change staged'))
      expect(screen.getByText(/route:enrichment — gateway down/)).toBeTruthy()

      mutationOverride = null
      fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
      const writes = () => fetchCalls.filter((c) => c.method === 'POST' && c.url === '/api/plugins/models/selections' && !((c.body?.ops as Array<{ ref: string }>) ?? []).every((op) => op.ref === 'ui:mode'))
      await waitFor(() => expect(writes()).toHaveLength(2))
      expect(writes()[1]!.body?.ops).toEqual([{ ref: 'route:enrichment', set: { model: 'anthropic/claude-haiku-4-5' } }])
      expect(writes()[1]!.body?.revision).toBe('rev-2')
      await waitFor(() => expect(screen.queryByTestId('draft-summary')).toBeNull())
    })

    it('a write the runtime has not confirmed leaves the draft, marks its ref and is counted on the bar (S10 pending)', async () => {
      plain()
      mutationOverride = (ops) => {
        pendingState = [{ document: 'policy', refs: ops.map((o) => o.ref), intended: {}, state: 'unsettled', startedAt: Date.now() }]
        return { applied: [], pending: ops.map((o) => ({ ref: o.ref, intended: o.set.model ?? null })) }
      }
      const user = userEvent.setup()
      render(<ModelsPage />)
      const lane = within(await screen.findByTestId('lane-agent'))
      await user.click(lane.getByRole('combobox', { name: 'Model' }))
      await user.click(await screen.findByRole('option', { name: 'GPT-5.4' }))
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('1 change staged')
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(configWrite()).toBeTruthy())
      expect((await screen.findByTestId('pending-policy:defaultModel')).textContent).toContain('saving…')
      // The draft is clean (the bar only speaks for the draft); the header
      // badge carries the pending count read back from the server.
      expect(screen.queryByTestId('draft-summary')).toBeNull()
      expect((await screen.findByTestId('pending-writes')).textContent).toContain('1 write pending runtime confirmation')
      // The chip never becomes part of the control's name.
      expect(lane.getByRole('combobox', { name: 'Model' })).toBeTruthy()
    })

    it('changing the agent model stages exactly one policy op; discarding clears the draft', async () => {
      plain()
      const user = userEvent.setup()
      render(<ModelsPage />)
      const lane = within(await screen.findByTestId('lane-agent'))
      await user.click(lane.getByRole('combobox', { name: 'Model' }))
      await user.click(await screen.findByRole('option', { name: 'GPT-5.4' }))
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('1 change staged')
      expect(lane.getByText('Model (unsaved)')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
      await waitFor(() => expect(screen.queryByTestId('draft-summary')).toBeNull())
      expect(configWrite()).toBeUndefined()
    })

    it('chores on different models read as Mixed; "Set all to…" stages the five routes', async () => {
      plain()
      routingState = { routes: [{ workClass: 'relay', model: 'anthropic/claude-haiku-4-5' }], tagOverrides: [] }
      const user = userEvent.setup()
      render(<ModelsPage />)
      const lane = within(await screen.findByTestId('lane-chores'))
      expect((await lane.findByTestId('chores-mixed')).textContent).toContain('Mixed (2 models)')
      await user.click(lane.getByRole('combobox', { name: 'Set all to' }))
      await user.click(await screen.findByRole('option', { name: 'Claude Haiku 4.5' }))
      // relay already IS haiku — only the other four ride the draft (S5).
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('4 changes staged')
      expect(lane.queryByTestId('chores-mixed')).toBeNull()
    })

    it('perTurnModel === false ⇒ the chores lane says saved-but-not-applied (S11)', async () => {
      plain()
      supportState = { ...supportState, perTurnModel: false }
      render(<ModelsPage />)
      expect((await screen.findByTestId('chores-not-applied')).textContent).toContain('not applied')
    })

    it('"Use recommended plan" shows the diff in a dialog and stages the plan ops on confirm', async () => {
      plain()
      render(<ModelsPage />)
      fireEvent.click(await screen.findByRole('button', { name: 'Use recommended plan' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Background chores')).toBeTruthy()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Stage changes' }))
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('5 changes staged')
      expect(configWrite()).toBeUndefined()
    })
  })

  describe('selection callouts (#907)', () => {
    it('a dead default shows the reason with one button that STAGES the proposal; saving posts it', async () => {
      configState = { ...configState, defaultModel: 'openai/gpt-6-astra' }
      eligibilityState = { 'openai/gpt-6-astra': { status: 'ineligible', reason: 'no_credentials', detail: 'no credentials for openai' } }
      proposalsState = [{ ref: 'policy:defaultModel', from: 'openai/gpt-6-astra', to: 'anthropic/claude-sonnet-4-6', reason: 'no credentials for openai', source: 'recommender', revision: 'rev-0' }]
      render(<ModelsPage />)
      const callout = await screen.findByTestId('callout-policy:defaultModel')
      expect(callout.getAttribute('data-callout')).toBe('ineligible')
      expect(callout.textContent).toContain('no credentials for openai')
      fireEvent.click(within(callout).getByRole('button', { name: 'Use anthropic/claude-sonnet-4-6' }))
      expect((await screen.findByTestId('draft-summary')).textContent).toContain('1 change staged')
      // Acted on ⇒ the callout is gone until saved.
      expect(screen.queryByTestId('callout-policy:defaultModel')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(configWrite()).toBeTruthy())
      expect(configWrite()?.body?.ops).toEqual([{ ref: 'policy:defaultModel', set: { model: 'anthropic/claude-sonnet-4-6' } }])
    })

    it('unknown eligibility is information only — no proposal button', async () => {
      eligibilityState = { 'anthropic/claude-sonnet-4-6': { status: 'unknown', detail: 'credential evidence unavailable' } }
      render(<ModelsPage />)
      const callout = await screen.findByTestId('callout-policy:defaultModel')
      expect(callout.getAttribute('data-callout')).toBe('unknown')
      expect(within(callout).queryByRole('button')).toBeNull()
    })

    it('a dead agent pin in Simple surfaces through the customizations line; in Advanced the row carries the callout', async () => {
      configState = { ...configState, agents: [{ ...configState.agents[0]!, ownModel: 'openai/gpt-6-astra', effectiveModel: 'openai/gpt-6-astra' }] }
      eligibilityState = { 'openai/gpt-6-astra': { status: 'ineligible', reason: 'no_credentials', detail: 'no credentials for openai' } }
      proposalsState = [{ ref: 'agent:patch:model', from: 'openai/gpt-6-astra', to: null, reason: 'no credentials for openai', source: 'none', revision: 'rev-0' }]
      // A deep link to the pin lands on the Agents tab on its own.
      queryOverrides.ref = 'agent:patch:model'
      render(<ModelsPage />)
      await deepLinkLanded('Patch model')
      const callout = screen.getByTestId('callout-agent:patch:model')
      expect(callout.textContent).toContain('No eligible replacement')
    })

    it('a pending adapter write marks its ref with a chip', async () => {
      pendingState = [{ document: 'policy', refs: ['policy:defaultModel'], intended: { 'policy:defaultModel': 'openai-codex/gpt-5.4' }, state: 'unsettled', startedAt: Date.now() }]
      render(<ModelsPage />)
      expect((await screen.findByTestId('pending-policy:defaultModel')).textContent).toBe('saving…')
    })
  })

  describe('Reset to this plan (S6)', () => {
    it('lists the clears, needs typed confirmation, posts once with snapshot:reset, and reports the undo handle', async () => {
      uiModeState = 'simple'
      render(<ModelsPage />)
      fireEvent.click(await screen.findByRole('button', { name: 'Reset to this plan…' }))
      const dialog = await screen.findByRole('dialog')
      // The fixture's customizations: subagent default, fallback, alias, workflow
      // route (model + thinking) — each named by its label with its before-value.
      expect(within(dialog).getByText('Fallback 1')).toBeTruthy()
      expect(within(dialog).getByText('anthropic/claude-opus-4-6 → cleared')).toBeTruthy()
      expect(within(dialog).getByText('workflow')).toBeTruthy()
      expect(within(dialog).getByText('anthropic/claude-sonnet-4-6 · medium thinking → cleared')).toBeTruthy()
      expect(within(dialog).queryByText('policy:fallback:0')).toBeNull()
      const confirm = within(dialog).getByRole('button', { name: 'Reset' })
      expect(confirm.getAttribute('aria-disabled') === 'true' || (confirm as HTMLButtonElement).disabled).toBe(true)
      fireEvent.change(within(dialog).getByPlaceholderText('reset'), { target: { value: 'reset' } })
      await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
      await waitFor(() => expect(configWrite()).toBeTruthy())
      expect(configWrite()?.body?.snapshot).toBe('reset')
      const refs = (configWrite()?.body?.ops as Array<{ ref: string }>).map((op) => op.ref).sort()
      expect(refs).toEqual(['policy:alias:sonnet', 'policy:defaultSubagentModel', 'policy:fallback:0', 'route:workflow'])
      // After the reset nothing is customized: the button is gone, the undo handle stays, Simple has no customizations line.
      expect((await screen.findByRole('status')).textContent).toContain('bakin models restore /tmp/snapshots/2026-09-22.json')
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Reset to this plan…' })).toBeNull())
      expect(screen.queryByTestId('customizations-line')).toBeNull()
    })

    it('is refused while the page holds an unsaved draft', async () => {
      uiModeState = 'simple'
      const user = userEvent.setup()
      render(<ModelsPage />)
      const lane = within(await screen.findByTestId('lane-agent'))
      await user.click(lane.getByRole('combobox', { name: 'Model' }))
      await user.click(await screen.findByRole('option', { name: 'GPT-5.4' }))
      await screen.findByTestId('draft-summary')
      const reset = screen.getByRole('button', { name: 'Reset to this plan…' }) as HTMLButtonElement
      expect(reset.disabled || reset.getAttribute('aria-disabled') === 'true').toBe(true)
      expect(screen.getByTestId('reset-blocked')).toBeTruthy()
    })

    it('discloses the clears a runtime cannot do instead of attempting them', async () => {
      uiModeState = 'simple'
      supportState = { ...supportState, fallbackModels: false, aliases: false, defaultSubagentModel: false, perAgentSubagentModel: false }
      render(<ModelsPage />)
      fireEvent.click(await screen.findByRole('button', { name: 'Reset to this plan…' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Kept Fallback 1')).toBeTruthy()
      expect(within(dialog).getByText('Kept Alias sonnet')).toBeTruthy()
    })
  })

  it('paginates the model catalog and resets to filtered search results', async () => {
    availableResponse = {
      models: Array.from({ length: 11 }, (_, index) => ({
        id: `${index < 6 ? 'anthropic' : 'google'}/model-${index + 1}`,
        name: `Model ${String(index + 1).padStart(2, '0')}`,
        provider: index < 6 ? 'anthropic' : 'google',
        providerLabel: index < 6 ? 'Anthropic' : 'Google',
        tier: index % 3 === 0 ? 'premium' : index % 3 === 1 ? 'standard' : 'budget',
        configured: index < 3,
        tags: index < 3 ? ['configured'] : [],
      })),
      cached: false,
      cachedAt: null,
    }

    render(<ModelsPage />)

    expect(await screen.findByText('Showing 1–8 of 11')).toBeTruthy()
    expect(screen.getByText('Model 01')).toBeTruthy()
    expect(screen.queryByText('Model 09')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 9–11 of 11')).toBeTruthy()
    expect(screen.getByText('Model 09')).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the model catalog' }), {
      target: { value: 'Model 11' },
    })

    expect(await screen.findByText('Model 11')).toBeTruthy()
    expect(screen.queryByText('Model 09')).toBeNull()
    expect(screen.queryByText(/Showing \d+–\d+ of/)).toBeNull()
  })
})
