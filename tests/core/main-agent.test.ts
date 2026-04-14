import { describe, it, expect, beforeEach, vi } from 'vitest'

// Unmock main-agent — global setup replaces it with a constant-returning stub,
// but this test suite exercises the real resolution logic.
vi.unmock('../../packages/core/src/main-agent')
vi.unmock('@bakin/core/main-agent')

vi.mock('../../packages/core/src/settings', () => ({
  getSettings: vi.fn().mockReturnValue({}),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, readFileSync: vi.fn() }
})

import { getSettings } from '../../packages/core/src/settings'
import { readFileSync } from 'fs'

let getMainAgentId: typeof import('../../packages/core/src/main-agent').getMainAgentId
let getMainAgentName: typeof import('../../packages/core/src/main-agent').getMainAgentName

const WS = '/tmp/openclaw/workspace'

function openclawConfig(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    agents: {
      defaults: { workspace: WS },
      list: [],
      ...overrides,
    },
  })
}

describe('main-agent', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.mocked(getSettings).mockReturnValue({} as any)
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    const mod = await import('../../packages/core/src/main-agent')
    getMainAgentId = mod.getMainAgentId
    getMainAgentName = mod.getMainAgentName
  })

  describe('getMainAgentId', () => {
    it('returns mainAgentId from settings when set', () => {
      vi.mocked(getSettings).mockReturnValue({ mainAgentId: 'custom' } as any)
      expect(getMainAgentId()).toBe('custom')
    })

    it('detects orchestrator from OpenClaw when its workspace equals agents.defaults.workspace', () => {
      vi.mocked(readFileSync).mockReturnValue(openclawConfig({
        list: [
          { id: 'pixel', workspace: '/tmp/openclaw/workspaces/pixel' },
          { id: 'roscoe', workspace: WS, identity: { name: 'Roscoe' } },
          { id: 'patch', workspace: '/tmp/openclaw/workspaces/patch' },
        ],
      }))
      expect(getMainAgentId()).toBe('roscoe')
    })

    it('detects orchestrator when openclaw uses `main` as the id', () => {
      vi.mocked(readFileSync).mockReturnValue(openclawConfig({
        list: [
          { id: 'main', workspace: WS },
          { id: 'pixel', workspace: '/tmp/openclaw/workspaces/pixel' },
        ],
      }))
      expect(getMainAgentId()).toBe('main')
    })

    it('falls back to agent with populated subagents allowlist when workspace match is absent', () => {
      vi.mocked(readFileSync).mockReturnValue(openclawConfig({
        list: [
          { id: 'alpha', subagents: { allowAgents: ['x', 'y', 'z'] } },
          { id: 'x', workspace: '/tmp/openclaw/workspaces/x' },
        ],
      }))
      expect(getMainAgentId()).toBe('alpha')
    })

    it('throws when settings has no mainAgentId and OpenClaw config is unreadable', () => {
      vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
      expect(() => getMainAgentId()).toThrow(/main agent/i)
    })

    it('throws when OpenClaw config has no matching orchestrator', () => {
      vi.mocked(readFileSync).mockReturnValue(openclawConfig({
        list: [
          { id: 'pixel', workspace: '/tmp/openclaw/workspaces/pixel' },
          { id: 'patch', workspace: '/tmp/openclaw/workspaces/patch' },
        ],
      }))
      expect(() => getMainAgentId()).toThrow(/main agent/i)
    })

    it('prefers settings.mainAgentId over OpenClaw detection', () => {
      vi.mocked(getSettings).mockReturnValue({ mainAgentId: 'chief' } as any)
      vi.mocked(readFileSync).mockReturnValue(openclawConfig({
        list: [{ id: 'roscoe', workspace: WS }],
      }))
      expect(getMainAgentId()).toBe('chief')
    })

    it('ignores empty-string mainAgentId in settings', () => {
      vi.mocked(getSettings).mockReturnValue({ mainAgentId: '' } as any)
      vi.mocked(readFileSync).mockReturnValue(openclawConfig({
        list: [{ id: 'roscoe', workspace: WS }],
      }))
      expect(getMainAgentId()).toBe('roscoe')
    })
  })

  describe('getMainAgentName', () => {
    it('returns identity.name when set on the resolved agent', () => {
      vi.mocked(readFileSync).mockReturnValue(openclawConfig({
        list: [{ id: 'roscoe', workspace: WS, identity: { name: 'Roscoe' } }],
      }))
      expect(getMainAgentName()).toBe('Roscoe')
    })

    it('falls back to title-cased id when identity.name is missing', () => {
      vi.mocked(readFileSync).mockReturnValue(openclawConfig({
        list: [{ id: 'boss', workspace: WS }],
      }))
      expect(getMainAgentName()).toBe('Boss')
    })

    it('propagates throw from getMainAgentId when nothing resolves', () => {
      vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
      expect(() => getMainAgentName()).toThrow(/main agent/i)
    })

    it('uses settings.mainAgentId to locate the matching agent entry', () => {
      vi.mocked(getSettings).mockReturnValue({ mainAgentId: 'orchestrator' } as any)
      vi.mocked(readFileSync).mockReturnValue(openclawConfig({
        list: [
          { id: 'roscoe', workspace: WS, identity: { name: 'Wrong' } },
          { id: 'orchestrator', identity: { name: 'Captain' } },
        ],
      }))
      expect(getMainAgentName()).toBe('Captain')
    })
  })
})
