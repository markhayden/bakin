// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const runtimeState = {
  restartNeeded: false,
  restarting: false,
  restart: mock(),
  markDirty: mock(),
}

mock.module('@/hooks/use-runtime-status', () => ({
  useRuntimeStatus: () => runtimeState,
}))

mock.module('@/components/plugin-header', () => ({
  PluginHeader: ({ title }: { title: string }) => <div>{title}</div>,
}))

mock.module('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <div>{agentId}</div>,
}))

mock.module('@/components/model-select', () => ({
  ModelSelect: ({
    value,
    onChange,
    models,
    defaultLabel,
    className,
  }: {
    value: string
    onChange: (value: string) => void
    models: Array<{ id: string; name: string }>
    defaultLabel?: string
    className?: string
  }) => (
    <select
      data-testid="model-select"
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {defaultLabel && <option value="__default__">{defaultLabel}</option>}
      {models.map((model) => (
        <option key={model.id} value={model.id}>{model.name}</option>
      ))}
    </select>
  ),
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
        return jsonResponse({ window: '24h', estimated: true, totalUsdMicros: 0, byAgent: [], byModel: [] })
      }
      if (url === '/api/plugins/models/routing' && method === 'GET') {
        return jsonResponse({ routes: [], tagOverrides: [] })
      }
      if (url === '/api/plugins/models/budget' && method === 'GET') {
        return jsonResponse({})
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
        return jsonResponse({ ok: true })
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders OpenClaw-backed defaults and agent config', async () => {
    render(<ModelsPage />)

    expect(await screen.findByText('Models')).toBeTruthy()
    expect(await screen.findByText('Patch')).toBeTruthy()
    expect(screen.getByText('Global Defaults')).toBeTruthy()
    expect(availableFetchCount).toBe(1)
  })

  it('saves global defaults and refreshes available models', async () => {
    render(<ModelsPage />)
    await screen.findByText('Patch')

    const selects = screen.getAllByTestId('model-select')
    fireEvent.change(selects[0], { target: { value: 'openai-codex/gpt-5.4' } })

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
    render(<ModelsPage />)
    const patchCell = await screen.findByText('Patch')
    const row = patchCell.closest('tr')
    expect(row).toBeTruthy()

    const selects = within(row as HTMLElement).getAllByTestId('model-select')
    fireEvent.change(selects[0], { target: { value: 'google/gemini-2.5-pro' } })

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
    render(<ModelsPage />)
    await screen.findByText('Patch')

    fireEvent.click(screen.getByText('Aliases'))
    fireEvent.change(screen.getByPlaceholderText('e.g. opus'), { target: { value: 'fast' } })

    const selects = screen.getAllByTestId('model-select')
    fireEvent.change(selects[0], { target: { value: 'google/gemini-2.5-pro' } })
    fireEvent.click(screen.getByText('Add'))

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

  it('renders the available models loading state while the runtime request is pending', async () => {
    const availableDeferred = createDeferred<Response>()
    availableRequest = availableDeferred.promise

    render(<ModelsPage />)
    fireEvent.click(await screen.findByText('Available Models'))

    expect(await screen.findByText('Querying runtime adapter — this can take up to 30 seconds on first load.')).toBeTruthy()

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

    expect(await screen.findByText('Could not load models from the runtime.')).toBeTruthy()
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

    expect(await screen.findByText('just now')).toBeTruthy()
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
    expect(screen.getByText('Complex coding')).toBeTruthy()
    expect(screen.getByText('High cost')).toBeTruthy()

    const plainCard = screen.getByText('Plain Runtime Model').closest('.rounded-xl')
    expect(plainCard).toBeTruthy()
    expect(within(plainCard as HTMLElement).getByText('vendor/plain-runtime-model')).toBeTruthy()
    expect(within(plainCard as HTMLElement).queryByText('Complex coding')).toBeNull()
    expect(within(plainCard as HTMLElement).queryByText('High cost')).toBeNull()
  })
})
