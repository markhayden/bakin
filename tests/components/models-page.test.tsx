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

mock.module('@makinbakin/sdk/navigation', () => ({
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
  useQueryArrayState: () => {
    const React = require('react') as typeof import('react')
    return React.useState<string[]>([])
  },
}))

const runtimeState = {
  restartNeeded: false,
  restarting: false,
  restart: mock(),
  markDirty: mock(),
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
  let availableFetchCount: number
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
  let routingState: {
    routes: Array<{ workClass: string; model?: string; thinking?: string }>
    tagOverrides: Array<{ tag: string; model?: string; thinking?: string }>
  }
  let spendResponse: Record<string, unknown>
  let budgetRulesState: Array<Record<string, unknown>>
  let budgetStatusState: Record<string, unknown>
  let incidentsState: Array<Record<string, unknown>>

  beforeEach(() => {
    cleanup()
    mock.restore()
    runtimeState.markDirty.mockReset()
    fetchCalls = []
    availableFetchCount = 0
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
    availableRequest = null
    refreshRequest = null
    aliasesState = {
      sonnet: 'anthropic/claude-sonnet-4-6',
    }
    routingState = {
      routes: [
        { workClass: 'workflow', model: 'anthropic/claude-sonnet-4-6', thinking: 'medium' },
      ],
      tagOverrides: [],
    }
    spendResponse = {
      window: '24h',
      estimated: true,
      totalUsdMicros: 2_480_000,
      byAgent: [
        { agent: 'patch', costUsdMicros: 1_480_000, runs: 8 },
        { agent: 'pixel', costUsdMicros: 1_000_000, runs: 5 },
      ],
      byModel: [
        { model: 'anthropic/claude-sonnet-4-6', costUsdMicros: 1_780_000, runs: 9 },
        { model: 'anthropic/claude-haiku-4-5', costUsdMicros: 700_000, runs: 4 },
      ],
      byWorkClass: [
        { workClass: 'workflow', runs: 8, totalTokens: 48_000, costUsdMicros: 1_480_000, subscriptionTokens: 0, avgCostUsdMicros: 185_000 },
        { workClass: 'scheduled', runs: 5, totalTokens: 32_000, costUsdMicros: 1_000_000, subscriptionTokens: 0, avgCostUsdMicros: 200_000 },
      ],
      timeline: [
        { startMs: Date.now() - 8 * 60 * 60 * 1000, endMs: Date.now() - 4 * 60 * 60 * 1000, costUsdMicros: 980_000, subscriptionTokens: 8_000, unpricedMeteredTokens: 0 },
        { startMs: Date.now() - 4 * 60 * 60 * 1000, endMs: Date.now(), costUsdMicros: 1_500_000, subscriptionTokens: 16_000, unpricedMeteredTokens: 0 },
      ],
      facets: {
        computedAt: Date.now(),
        daily: {
          startMs: Date.now() - 86_400_000,
          global: {
            meteredUsdMicros: 2_480_000,
            meteredTokens: 80_000,
            subscriptionTokens: 24_000,
            unpricedMeteredTokens: 0,
            unattributed: { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0 },
          },
          byAgent: {},
          byProvider: {
            anthropic: { meteredUsdMicros: 2_480_000, meteredTokens: 80_000, subscriptionTokens: 0, unpricedMeteredTokens: 0 },
            'openai-codex': { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 24_000, unpricedMeteredTokens: 0 },
          },
          byModel: {},
        },
        monthly: {
          startMs: Date.now() - 2_000_000_000,
          global: {
            meteredUsdMicros: 8_420_000,
            meteredTokens: 280_000,
            subscriptionTokens: 124_000,
            unpricedMeteredTokens: 0,
            unattributed: { meteredUsdMicros: 120_000, meteredTokens: 4_000, subscriptionTokens: 2_000 },
          },
          byAgent: {},
          byProvider: {
            anthropic: { meteredUsdMicros: 8_420_000, meteredTokens: 280_000, subscriptionTokens: 0, unpricedMeteredTokens: 0 },
            'openai-codex': { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 124_000, unpricedMeteredTokens: 0 },
          },
          byModel: {
            'anthropic/claude-sonnet-4-6': { meteredUsdMicros: 6_300_000, meteredTokens: 210_000, subscriptionTokens: 0, unpricedMeteredTokens: 0 },
          },
        },
      },
      pace: {
        daily: { meteredUsdMicros: 3_100_000, subscriptionTokens: 30_000, endsMs: Date.now() + 43_200_000 },
        monthly: { meteredUsdMicros: 12_000_000, subscriptionTokens: 180_000, endsMs: Date.now() + 604_800_000 },
      },
    }
    budgetRulesState = [
      { scope: 'global', lane: 'metered', dailyCap: 5, monthlyCap: 25, warnPct: 0.8, atCap: 'defer' },
    ]
    budgetStatusState = {
      paused: false,
      configured: true,
      perAgent: {},
      perTask: {},
      billing: {
        patch: { provider: 'anthropic', lane: 'metered', model: 'anthropic/claude-sonnet-4-6' },
        pixel: { provider: 'openai-codex', lane: 'subscription', model: 'openai-codex/gpt-5.4' },
      },
      overrides: [],
      deferredProviders: [],
      openIncidents: [],
    }
    incidentsState = []
    runtimeState.restartNeeded = false
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
      if (url === '/api/plugins/models/refresh' && method === 'POST') {
        return refreshRequest ?? jsonResponse(refreshResponse)
      }
      if (url === '/api/plugins/models/aliases' && method === 'GET') {
        return jsonResponse({ aliases: aliasesState })
      }
      if (url.startsWith('/api/plugins/models/spend') && method === 'GET') {
        return jsonResponse(spendResponse)
      }
      if (url === '/api/plugins/models/routing' && method === 'GET') {
        return jsonResponse(routingState)
      }
      if (url === '/api/plugins/models/routing' && method === 'PUT') {
        routingState = {
          routes: (body?.routes as typeof routingState.routes) ?? [],
          tagOverrides: (body?.tagOverrides as typeof routingState.tagOverrides) ?? [],
        }
        return jsonResponse({ ok: true })
      }
      if (url === '/api/plugins/models/budget' && method === 'GET') {
        return jsonResponse({ rules: budgetRulesState })
      }
      if (url === '/api/plugins/models/budget' && method === 'PUT') {
        budgetRulesState = (body?.rules as Array<Record<string, unknown>>) ?? []
        return jsonResponse({ ok: true })
      }
      if (url === '/api/plugins/models/budget/incidents' && method === 'GET') {
        return jsonResponse({ incidents: incidentsState })
      }
      if (url === '/api/plugins/models/budget/status' && method === 'GET') {
        return jsonResponse(budgetStatusState)
      }
      if (url === '/api/plugins/models/billing/overrides' && method === 'PUT') {
        budgetStatusState = {
          ...budgetStatusState,
          overrides: body?.overrides ?? [],
        }
        return jsonResponse({ ok: true })
      }
      if (url === '/api/settings' && method === 'POST') {
        budgetStatusState = {
          ...budgetStatusState,
          paused: Boolean((body?.dispatch as { paused?: boolean } | undefined)?.paused),
        }
        return jsonResponse({ ok: true })
      }
      if (url === '/api/plugins/models/defaults' && method === 'POST') {
        configState = {
          ...configState,
          defaultModel: String(body?.defaultModel ?? configState.defaultModel),
          defaultSubagentModel: body?.defaultSubagentModel === null ? null : String(body?.defaultSubagentModel ?? configState.defaultSubagentModel),
          fallbackModels: (body?.fallbackModels as string[]) ?? configState.fallbackModels,
          agents: configState.agents.map((agent) => ({
            ...agent,
            defaultModel: String(body?.defaultModel ?? configState.defaultModel),
            defaultSubagentModel: body?.defaultSubagentModel === null ? null : String(body?.defaultSubagentModel ?? configState.defaultSubagentModel),
            effectiveModel: agent.ownModel ?? String(body?.defaultModel ?? configState.defaultModel),
          })),
        }
        return jsonResponse({ ok: true })
      }
      if (url === '/api/plugins/models/config' && method === 'POST') {
        configState = {
          ...configState,
          agents: configState.agents.map((agent) => agent.agentId === body?.agentId
            ? {
                ...agent,
                ownModel: body?.ownModel ?? null,
                subagentModel: body?.subagentModel ?? agent.subagentModel,
                effectiveModel: body?.ownModel ?? configState.defaultModel,
              }
            : agent),
        }
        return jsonResponse({ ok: true })
      }
      if (url === '/api/plugins/models/aliases' && method === 'POST') {
        if (body?.action === 'add') {
          aliasesState[String(body.name)] = String(body.target)
        }
        if (body?.action === 'delete') {
          delete aliasesState[String(body.name)]
        }
        return jsonResponse({ ok: true })
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
    expect(screen.getByRole('tabpanel', { name: 'Agent Config' })).toBeTruthy()
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
      const defaultCall = fetchCalls.find((call) => call.method === 'POST' && call.url === '/api/plugins/models/defaults')
      expect(defaultCall).toBeTruthy()
      expect(defaultCall?.body).toEqual({
        defaultModel: 'openai-codex/gpt-5.4',
        defaultSubagentModel: 'anthropic/claude-haiku-4-5',
        fallbackModels: ['anthropic/claude-opus-4-6'],
      })
      expect(availableFetchCount).toBe(2)
    })
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
      const configCall = fetchCalls.find((call) => call.method === 'POST' && call.url === '/api/plugins/models/config')
      expect(configCall?.body).toEqual({
        agentId: 'patch',
        ownModel: 'google/gemini-2.5-pro',
      })
      expect(runtimeState.markDirty).toHaveBeenCalled()
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
      const aliasCall = fetchCalls.find((call) => call.method === 'POST' && call.url === '/api/plugins/models/aliases')
      expect(aliasCall?.body).toEqual({
        action: 'add',
        name: 'fast',
        target: 'google/gemini-2.5-pro',
      })
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
    expect(search.closest('[data-slot="page-header-controls"]')).toBeTruthy()
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
    expect(fetchCalls.some((call) => call.body?.action === 'delete')).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Delete “sonnet” alias?' })).toBeNull()
    expect(screen.getByText('sonnet')).toBeTruthy()

    await user.click(deleteButton)
    await user.click(within(
      screen.getByRole('dialog', { name: 'Delete “sonnet” alias?' }),
    ).getByRole('button', { name: 'Delete alias' }))

    await waitFor(() => {
      expect(fetchCalls.some((call) => call.body?.action === 'delete')).toBe(true)
      expect(screen.queryByText('sonnet')).toBeNull()
    })
  })

  it('renders the available models loading state while the runtime request is pending', async () => {
    const availableDeferred = createDeferred<Response>()
    availableRequest = availableDeferred.promise

    render(<ModelsPage />)
    fireEvent.click(await screen.findByText('Available Models'))

    expect(await screen.findByText('Loading available models')).toBeTruthy()

    availableDeferred.resolve(jsonResponse(availableResponse))
    await screen.findByText('Claude Sonnet 4.6')
  })

  it('renders the runtime models error state when no models are returned', async () => {
    availableResponse = {
      models: [],
      cached: false,
      cachedAt: null,
      error: 'runtime unavailable',
    }

    render(<ModelsPage />)
    fireEvent.click(await screen.findByText('Available Models'))

    expect(await screen.findByText('Models could not be loaded')).toBeTruthy()
    expect(screen.getByText('runtime unavailable')).toBeTruthy()
  })

  it('renders the runtime restart-needed banner and calls restart', async () => {
    runtimeState.restartNeeded = true

    render(<ModelsPage />)

    expect(await screen.findByText('Runtime config out of sync. Restart to apply changes.')).toBeTruthy()
    fireEvent.click(screen.getByText('Restart Runtime'))

    expect(runtimeState.restart).toHaveBeenCalled()
  })

  it('disables the refresh button while a refresh request is in flight', async () => {
    const refreshDeferred = createDeferred<Response>()
    refreshRequest = refreshDeferred.promise

    render(<ModelsPage />)
    fireEvent.click(await screen.findByText('Available Models'))

    await screen.findByText('Claude Sonnet 4.6')
    fireEvent.click(screen.getByText('Refresh'))

    await waitFor(() => {
      expect(screen.getByText('Refreshing…').closest('button')?.disabled).toBe(true)
    })

    refreshDeferred.resolve(jsonResponse(refreshResponse))
    await screen.findByText('Refresh')
  })

  it('renders cached refresh age when available models come from cache', async () => {
    availableResponse = {
      ...availableResponse,
      cached: true,
      cachedAt: Date.now(),
    }

    render(<ModelsPage />)
    fireEvent.click(await screen.findByText('Available Models'))

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
    fireEvent.click(await screen.findByText('Available Models'))

    expect(await screen.findByText('Best frontier coding model for long-running work.')).toBeTruthy()
    expect(screen.getByText('Best for: Complex coding')).toBeTruthy()
    expect(screen.getByText('High cost')).toBeTruthy()

    const plainRow = screen.getByText('Plain Runtime Model').closest('[data-model-row]')
    expect(plainRow).toBeTruthy()
    expect(within(plainRow as HTMLElement).getByText('vendor/plain-runtime-model')).toBeTruthy()
    expect(within(plainRow as HTMLElement).queryByText('Complex coding')).toBeNull()
    expect(within(plainRow as HTMLElement).queryByText('High cost')).toBeNull()
  })

  it('uses the shared header search pattern and strongly identifies the default model', async () => {
    render(<ModelsPage />)
    fireEvent.click(await screen.findByText('Available Models'))

    const search = await screen.findByRole('searchbox', { name: 'Search available models' })
    expect(search.closest('[data-slot="page-header-controls"]')).toBeTruthy()

    const defaultRow = screen.getByText('Claude Sonnet 4.6').closest('[data-model-row]')
    expect(defaultRow?.getAttribute('data-default')).toBe('true')
    expect(defaultRow?.className).toContain('border-bakin-action-primary-background/60')
    expect(defaultRow?.className).toContain('bg-bakin-action-primary-background/10')
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
      const saveCall = fetchCalls.find((call) => call.method === 'PUT' && call.url === '/api/plugins/models/routing')
      expect(saveCall?.body?.routes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          workClass: 'scheduled',
          model: 'anthropic/claude-haiku-4-5',
        }),
      ]))
    })
    expect(screen.queryByText('Unsaved routing changes')).toBeNull()
  })

  it('composes spend from shared settings, summary, selection, and pagination patterns', async () => {
    const { container } = render(<ModelsPage />)
    fireEvent.click(await screen.findByText('Spend'))

    expect(await screen.findByRole('region', { name: 'Spending overview' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Budget rules' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Billing lanes' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Spend breakdown' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Estimated spend over time' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Top agent spend' })).toBeTruthy()
    expect(container.querySelectorAll('select')).toHaveLength(0)

    const windowControl = screen.getByRole('tablist', { name: 'Spend window' })
    expect(windowControl.closest('[data-slot="page-header-controls"]')).toBeTruthy()
    // The ranked chart's exact-data table adds one occurrence beyond the breakdown rows.
    expect(screen.getAllByText('patch')).toHaveLength(3)

    fireEvent.click(screen.getByRole('tab', { name: 'Models' }))
    // The ranked chart's exact-data table adds one occurrence beyond the breakdown rows.
    expect(await screen.findAllByText('anthropic/claude-sonnet-4-6')).toHaveLength(3)
    expect(screen.getByRole('group', { name: 'Top model spend' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Add budget rule' }))
    expect(await screen.findByText('Unsaved budget rules')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByText('Unsaved budget rules')).toBeNull()
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
    fireEvent.click(await screen.findByText('Available Models'))

    expect(await screen.findByText('Showing 1–8 of 11')).toBeTruthy()
    expect(screen.getByText('Model 01')).toBeTruthy()
    expect(screen.queryByText('Model 09')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 9–11 of 11')).toBeTruthy()
    expect(screen.getByText('Model 09')).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search available models' }), {
      target: { value: 'Model 11' },
    })

    expect(await screen.findByText('Model 11')).toBeTruthy()
    expect(screen.queryByText('Model 09')).toBeNull()
    expect(screen.queryByText(/Showing \d+–\d+ of/)).toBeNull()
  })
})
