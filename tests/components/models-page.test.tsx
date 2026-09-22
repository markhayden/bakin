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

mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
}))

/** Initial URL state per key — a test sets `?ref=` here before rendering. */
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
  let availableResponse: AvailableModelsPayload
  let agentScopedResponses: Record<string, AvailableModelsPayload>
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
    configState = {
      agents: [
        {
          agentId: 'patch',
          name: 'Patch',
          emoji: '⚙️',
          ownModel: null,
          subagentModel: null,
          defaultModel: 'anthropic/claude-sonnet-4-6',
          defaultSubagentModel: 'anthropic/claude-haiku-4-5',
          effectiveModel: 'anthropic/claude-sonnet-4-6',
        },
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
    agentScopedResponses = {}
    availableRequest = null
    refreshRequest = null
    aliasesState = {
      sonnet: 'anthropic/claude-sonnet-4-6',
    }
    uiModeState = null
    pendingState = []
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

      if (url === '/api/plugins/models/config' && method === 'GET') {
        return jsonResponse(configState)
      }
      if (url === '/api/plugins/models/available' && method === 'GET') {
        availableFetchCount += 1
        return availableRequest ?? jsonResponse(availableResponse)
      }
      // Agent-scoped catalog reads (#907 review): verdicts under THAT agent's credentials.
      if (url.startsWith('/api/plugins/models/available?agentId=') && method === 'GET') {
        const agentId = decodeURIComponent(url.slice('/api/plugins/models/available?agentId='.length))
        return jsonResponse(agentScopedResponses[agentId] ?? availableResponse)
      }
      if (url === '/api/plugins/models/refresh' && method === 'POST') {
        return refreshRequest ?? jsonResponse(refreshResponse)
      }
      if (url === '/api/plugins/models/aliases' && method === 'GET') {
        return jsonResponse({ aliases: aliasesState })
      }
      if (url === '/api/plugins/models/routing' && method === 'GET') {
        return jsonResponse(routingState)
      }
      // The ONE write path (#907): every save arrives as selection ops. The
      // read mirrors the fake config so the page classifies its mode honestly.
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
        const support = { defaultModel: true, fallbackModels: true, defaultSubagentModel: true, aliases: true, perAgentSubagentModel: true, supportedThinkingLevels: ['off', 'low', 'medium', 'high'], perTurnModel: true }
        return jsonResponse({ revision: `rev-${selectionsRevision}`, support, states, proposals: [], pending: pendingState, evidence: evidenceState })
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
          routeProposals: { proposals: [], skipped: [] },
          candidates: 4,
        })
      }
      if (url === '/api/plugins/models/selections' && method === 'POST') {
        // Revision-checked like the real mutator: a write under a revision
        // the page did not load from is refused, never applied.
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
        return jsonResponse({ applied: ops.map((o) => o.ref), failed: [], pending: [], warnings: [], revision: `rev-${selectionsRevision}` })
      }
      if (url === '/api/plugins/models/aliases/recommended' && method === 'GET') {
        return jsonResponse({ aliases: { opus: 'anthropic/claude-opus-4-6' } })
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders OpenClaw-backed defaults and agent config', async () => {
    const { container } = render(<ModelsPage />)

    expect(await screen.findByText('Models')).toBeTruthy()
    expect(await screen.findByText('Patch')).toBeTruthy()
    expect(screen.getByText('Global Defaults')).toBeTruthy()
    expect(container.querySelector('[data-archetype="page"]')).toBeTruthy()
    expect(screen.getByRole('tabpanel', { name: 'Advanced' })).toBeTruthy()
    expect(availableFetchCount).toBe(1)
  })

  it('saves global defaults and refreshes available models', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByText('Patch')

    await user.click(screen.getByRole('combobox', { name: 'Default Model' }))
    await user.click(await screen.findByRole('option', { name: 'GPT-5.4' }))

    fireEvent.click(screen.getByText('Save Defaults'))

    await waitFor(() => {
      const call = configWrite()
      expect(call).toBeTruthy()
      // Only the changed ref rides the write (D24): the default model.
      expect(call?.body?.ops).toEqual([{ ref: 'policy:defaultModel', set: { model: 'openai-codex/gpt-5.4' } }])
      expect(availableFetchCount).toBe(2)
    })
  })

  it('a save whose editor snapshot is behind the server is REFUSED, reloaded and explained — never re-posted against the moved state (positional fallback refs)', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByText('Patch')
    await waitFor(() => expect(fetchCalls.some((c) => c.method === 'GET' && c.url === '/api/plugins/models/selections')).toBe(true))
    // Another editor saved after this page loaded.
    selectionsRevision += 1
    const configLoads = () => fetchCalls.filter((c) => c.method === 'GET' && c.url === '/api/plugins/models/config').length
    const loadsBefore = configLoads()

    await user.click(screen.getByRole('combobox', { name: 'Default Model' }))
    await user.click(await screen.findByRole('option', { name: 'GPT-5.4' }))
    fireEvent.click(screen.getByText('Save Defaults'))

    const posts = () => fetchCalls.filter((c) => c.method === 'POST' && c.url === '/api/plugins/models/selections')
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0]!.body?.revision).toBe('rev-0')
    expect(await screen.findByText(/changed since this page loaded/)).toBeTruthy()
    await waitFor(() => expect(configLoads()).toBeGreaterThan(loadsBefore))
    // No second POST with the same ops under the fresher revision.
    expect(posts()).toHaveLength(1)
  })

  it('a Routing-tab visit never refreshes the revision behind the defaults snapshot — a positional fallback edit staged against the old list is refused, not authorized', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByText('Patch')
    await waitFor(() => expect(fetchCalls.some((c) => c.method === 'GET' && c.url === '/api/plugins/models/selections')).toBe(true))
    // Another editor moved the configuration after this page loaded its defaults…
    selectionsRevision += 1
    // …then the operator visits Routing (its own snapshot + a fresher server revision) and comes back.
    fireEvent.click(screen.getByRole('tab', { name: 'Routing' }))
    await screen.findByRole('region', { name: 'Task dispatch routes' })
    fireEvent.click(screen.getByRole('tab', { name: 'Agent Config' }))
    await screen.findByText('Global Defaults')

    // Remove fallback #1 — a POSITIONAL op built from the defaults snapshot loaded under rev-0.
    await user.click(screen.getByRole('button', { name: 'Remove fallback 1' }))
    fireEvent.click(screen.getByText('Save Defaults'))

    const posts = () => fetchCalls.filter((c) => c.method === 'POST' && c.url === '/api/plugins/models/selections')
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0]!.body?.revision).toBe('rev-0')
    expect((posts()[0]!.body?.ops as Array<{ ref: string }>)[0]!.ref).toBe('policy:fallback:0')
    expect(await screen.findByText(/changed since this page loaded/)).toBeTruthy()
    expect(posts()).toHaveLength(1)
  })

  it("an agent row's pickers are scoped to THAT agent's credentials: a model dead for Patch is disabled in Patch's Own Model picker while the install-wide Default Model picker still offers it", async () => {
    agentScopedResponses.patch = {
      ...availableResponse,
      models: availableResponse.models!.map((m) => m.id === 'openai-codex/gpt-5.4'
        ? { ...m, available: false, eligibility: { status: 'ineligible', reason: 'no_credentials', detail: 'no credentials for openai-codex' } }
        : m),
    } as AvailableModelsPayload
    const user = userEvent.setup()
    render(<ModelsPage />)
    const row = (await screen.findByText('Patch')).closest('[data-agent-model-row]') as HTMLElement
    await waitFor(() => expect(fetchCalls.some((c) => c.url === '/api/plugins/models/available?agentId=patch')).toBe(true))

    await user.click(within(row).getByRole('combobox', { name: 'Own Model' }))
    const dead = await screen.findByRole('option', { name: 'GPT-5.4 — no credentials for openai-codex' })
    expect(dead.getAttribute('aria-disabled')).toBe('true')
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('combobox', { name: 'Default Model' }))
    expect(await screen.findByRole('option', { name: 'GPT-5.4' })).toBeTruthy()
  })

  it('saves agent-specific model overrides', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    const patchCell = await screen.findByText('Patch')
    const row = patchCell.closest('[data-agent-model-row]')
    expect(row).toBeTruthy()

    await user.click(within(row as HTMLElement).getByRole('combobox', { name: 'Own Model' }))
    await user.click(await screen.findByRole('option', { name: 'Gemini 2.5 Pro' }))

    fireEvent.click(within(row as HTMLElement).getByText('Save'))

    await waitFor(() => {
      const call = configWrite()
      expect(call?.body?.ops).toEqual([{ ref: 'agent:patch:model', set: { model: 'google/gemini-2.5-pro' } }])
      expect(runtimeState.refresh).toHaveBeenCalled()
    })
  })

  it('adds aliases and refreshes model availability metadata', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByText('Patch')

    await user.click(screen.getByText('Aliases'))
    fireEvent.change(screen.getByPlaceholderText('e.g. opus'), { target: { value: 'fast' } })

    await user.click(screen.getByRole('combobox', { name: 'Target model' }))
    await user.click(screen.getByRole('option', { name: 'Gemini 2.5 Pro' }))
    await user.click(screen.getByRole('button', { name: 'Add alias' }))

    await waitFor(() => {
      const call = configWrite()
      expect(call?.body?.ops).toEqual([{ ref: 'policy:alias:fast', set: { model: 'google/gemini-2.5-pro' } }])
      expect(availableFetchCount).toBe(2)
    })
  })

  it('uses shared alias search, paginated rows, and form composition', async () => {
    aliasesState = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
      `alias-${String(index + 1).padStart(2, '0')}`,
      index % 2 === 0 ? 'anthropic/claude-sonnet-4-6' : 'google/gemini-2.5-pro',
    ]))

    const { container } = render(<ModelsPage />)
    fireEvent.click(await screen.findByText('Aliases'))

    const search = await screen.findByRole('searchbox', { name: 'Search aliases' })
    expect(container.querySelector('[data-slot="form"]')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Target model' })).toBeTruthy()
    expect(screen.getByText('Showing 1–8 of 10')).toBeTruthy()
    expect(container.querySelectorAll('[data-alias-row]')).toHaveLength(8)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 9–10 of 10')).toBeTruthy()
    expect(container.querySelectorAll('[data-alias-row]')).toHaveLength(2)

    fireEvent.change(search, { target: { value: 'alias-10' } })
    expect(await screen.findByText('alias-10')).toBeTruthy()
    expect(screen.queryByText('alias-09')).toBeNull()
  })

  it('confirms alias deletion with the alias name and current target', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await user.click(await screen.findByText('Aliases'))

    const deleteButton = await screen.findByRole('button', { name: 'Delete sonnet alias' })
    await user.click(deleteButton)

    const dialog = screen.getByRole('dialog', { name: 'Delete “sonnet” alias?' })
    expect(within(dialog).getByText(/currently points to anthropic\/claude-sonnet-4-6/)).toBeTruthy()
    expect(within(dialog).getByText(/may stop resolving/)).toBeTruthy()
    const isAliasClear = (call: { body?: Record<string, unknown> }) => ((call.body?.ops as Array<{ ref: string; set: { model?: string | null } }> | undefined) ?? []).some((op) => op.ref === 'policy:alias:sonnet' && op.set.model === null)
    expect(fetchCalls.some(isAliasClear)).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Delete “sonnet” alias?' })).toBeNull()
    expect(screen.getByText('sonnet')).toBeTruthy()

    await user.click(deleteButton)
    await user.click(within(
      screen.getByRole('dialog', { name: 'Delete “sonnet” alias?' }),
    ).getByRole('button', { name: 'Delete alias' }))

    await waitFor(() => {
      expect(fetchCalls.some(isAliasClear)).toBe(true)
      expect(screen.queryByText('sonnet')).toBeNull()
    })
  })

  it('renders the available models loading state while the runtime request is pending', async () => {
    const availableDeferred = createDeferred<Response>()
    availableRequest = availableDeferred.promise

    render(<ModelsPage />)
    fireEvent.click(await screen.findByText('Model catalog'))
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
    fireEvent.click(await screen.findByText('Model catalog'))

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
    await screen.findByText('Patch')
    expect(screen.queryByText(/Restart/)).toBeNull()
  })

  it('disables the refresh button while a refresh request is in flight', async () => {
    const refreshDeferred = createDeferred<Response>()
    refreshRequest = refreshDeferred.promise

    render(<ModelsPage />)
    fireEvent.click(await screen.findByText('Model catalog'))
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

  it('renders cached refresh age when available models come from cache', async () => {
    availableResponse = {
      ...availableResponse,
      cached: true,
      cachedAt: Date.now(),
    }

    render(<ModelsPage />)
    fireEvent.click(await screen.findByText('Model catalog'))

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
    fireEvent.click(await screen.findByText('Model catalog'))

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
    fireEvent.click(await screen.findByText('Model catalog'))
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
      expect(await panel.findByText('Agent model')).toBeTruthy()
      // Both lanes read the default: agent = the default, chores inherit it.
      expect(panel.getAllByText('anthropic/claude-sonnet-4-6')).toHaveLength(2)
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
      expect((await screen.findByRole('tab', { name: 'Advanced' })).getAttribute('aria-selected')).toBe('true')
      await screen.findByText('Patch')
      expect(modeWrites()).toHaveLength(0)
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

  it('uses the settings form composition for routing while preserving staged saves', async () => {
    const { container } = render(<ModelsPage />)
    fireEvent.click(await screen.findByText('Routing'))

    expect(await screen.findByRole('region', { name: 'Task dispatch routes' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'System work routes' })).toBeTruthy()
    expect(container.querySelectorAll('select')).toHaveLength(0)

    const scheduledModel = screen.getByRole('combobox', { name: /Scheduled model/i })
    await userEvent.click(scheduledModel)
    await userEvent.click(await screen.findByRole('option', { name: 'Claude Haiku 4.5' }))

    expect(await screen.findByText('Unsaved routing changes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save routing' }))

    await waitFor(() => {
      const call = configWrite()
      expect(call?.body?.ops).toEqual(expect.arrayContaining([
        { ref: 'route:scheduled', set: { model: 'anthropic/claude-haiku-4-5' } },
      ]))
    })
    expect(screen.queryByText('Unsaved routing changes')).toBeNull()
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
    fireEvent.click(await screen.findByText('Model catalog'))

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
