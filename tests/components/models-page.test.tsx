// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ModelsPage } from '../../plugins/models/components/models-page'

mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
}))

const gatewayState = {
  restartNeeded: false,
  restarting: false,
  restart: mock(),
  markDirty: mock(),
}

mock.module('@/hooks/use-gateway-status', () => ({
  useGatewayStatus: () => gatewayState,
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('ModelsPage component', () => {
  let fetchCalls: FetchCall[]
  let availableFetchCount: number
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
    gatewayState.markDirty.mockReset()
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
    aliasesState = {
      sonnet: 'anthropic/claude-sonnet-4-6',
    }

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
        return jsonResponse({
          models: [
            { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', tier: 'standard', isDefault: configState.defaultModel === 'anthropic/claude-sonnet-4-6', configured: true, tags: ['configured'] },
            { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', tier: 'premium', configured: true, tags: ['configured'] },
            { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'budget', configured: true, tags: ['configured'] },
            { id: 'openai-codex/gpt-5.4', name: 'GPT-5.4', provider: 'openai-codex', tier: 'premium', isDefault: configState.defaultModel === 'openai-codex/gpt-5.4', configured: true, tags: ['configured'] },
            { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', tier: 'premium', configured: false, tags: [] },
          ],
          cached: false,
          cachedAt: null,
        })
      }
      if (url === '/api/plugins/models/aliases' && method === 'GET') {
        return jsonResponse({ aliases: aliasesState })
      }
      if (url === '/api/plugins/models/profiles' && method === 'GET') {
        return jsonResponse({ profiles: [] })
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
    cleanup()
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
      expect(gatewayState.markDirty).toHaveBeenCalled()
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
})
