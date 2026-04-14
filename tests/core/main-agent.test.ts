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
  return { ...actual, readFileSync: vi.fn(), statSync: vi.fn() }
})

import { getSettings } from '../../packages/core/src/settings'
import { readFileSync, statSync } from 'fs'

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

function mockOpenclawFile(mtimeMs: number, content: string): void {
  vi.mocked(statSync).mockReturnValue({ mtimeMs } as any)
  vi.mocked(readFileSync).mockReturnValue(content)
}

describe('main-agent', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.mocked(getSettings).mockReturnValue({} as any)
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    vi.mocked(statSync).mockImplementation(() => { throw new Error('ENOENT') })

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
      mockOpenclawFile(1000, openclawConfig({
        list: [
          { id: 'pixel', workspace: '/tmp/openclaw/workspaces/pixel' },
          { id: 'main-operator', workspace: WS, identity: { name: 'Main Operator' } },
          { id: 'patch', workspace: '/tmp/openclaw/workspaces/patch' },
        ],
      }))
      expect(getMainAgentId()).toBe('main-operator')
    })

    it('detects orchestrator when openclaw uses `main` as the id', () => {
      mockOpenclawFile(1000, openclawConfig({
        list: [
          { id: 'main', workspace: WS },
          { id: 'pixel', workspace: '/tmp/openclaw/workspaces/pixel' },
        ],
      }))
      expect(getMainAgentId()).toBe('main')
    })

    it('falls back to agent with populated subagents allowlist when workspace match is absent', () => {
      mockOpenclawFile(1000, openclawConfig({
        list: [
          { id: 'alpha', subagents: { allowAgents: ['x', 'y', 'z'] } },
          { id: 'x', workspace: '/tmp/openclaw/workspaces/x' },
        ],
      }))
      expect(getMainAgentId()).toBe('alpha')
    })

    it('throws when settings has no mainAgentId and OpenClaw config is unreadable', () => {
      vi.mocked(statSync).mockImplementation(() => { throw new Error('ENOENT') })
      expect(() => getMainAgentId()).toThrow(/main agent/i)
    })

    it('throws when OpenClaw config has no matching orchestrator', () => {
      mockOpenclawFile(1000, openclawConfig({
        list: [
          { id: 'pixel', workspace: '/tmp/openclaw/workspaces/pixel' },
          { id: 'patch', workspace: '/tmp/openclaw/workspaces/patch' },
        ],
      }))
      expect(() => getMainAgentId()).toThrow(/main agent/i)
    })

    it('prefers settings.mainAgentId over OpenClaw detection', () => {
      vi.mocked(getSettings).mockReturnValue({ mainAgentId: 'chief' } as any)
      mockOpenclawFile(1000, openclawConfig({
        list: [{ id: 'main-operator', workspace: WS }],
      }))
      expect(getMainAgentId()).toBe('chief')
    })

    it('ignores empty-string mainAgentId in settings', () => {
      vi.mocked(getSettings).mockReturnValue({ mainAgentId: '' } as any)
      mockOpenclawFile(1000, openclawConfig({
        list: [{ id: 'main-operator', workspace: WS }],
      }))
      expect(getMainAgentId()).toBe('main-operator')
    })
  })

  describe('getMainAgentName', () => {
    it('returns identity.name when set on the resolved agent', () => {
      mockOpenclawFile(1000, openclawConfig({
        list: [{ id: 'main-operator', workspace: WS, identity: { name: 'Main Operator' } }],
      }))
      expect(getMainAgentName()).toBe('Main Operator')
    })

    it('falls back to title-cased id when identity.name is missing', () => {
      mockOpenclawFile(1000, openclawConfig({
        list: [{ id: 'boss', workspace: WS }],
      }))
      expect(getMainAgentName()).toBe('Boss')
    })

    it('propagates throw from getMainAgentId when nothing resolves', () => {
      vi.mocked(statSync).mockImplementation(() => { throw new Error('ENOENT') })
      expect(() => getMainAgentName()).toThrow(/main agent/i)
    })

    it('uses settings.mainAgentId to locate the matching agent entry', () => {
      vi.mocked(getSettings).mockReturnValue({ mainAgentId: 'orchestrator' } as any)
      mockOpenclawFile(1000, openclawConfig({
        list: [
          { id: 'main-operator', workspace: WS, identity: { name: 'Wrong' } },
          { id: 'orchestrator', identity: { name: 'Captain' } },
        ],
      }))
      expect(getMainAgentName()).toBe('Captain')
    })
  })

  describe('mtime-cached config reads', () => {
    it('reuses parsed config across calls when mtime is unchanged', () => {
      mockOpenclawFile(1000, openclawConfig({
        list: [{ id: 'boss', workspace: WS }],
      }))
      expect(getMainAgentId()).toBe('boss')
      expect(getMainAgentId()).toBe('boss')
      expect(getMainAgentId()).toBe('boss')
      // One parse, three stats — stat is the only per-call cost.
      expect(readFileSync).toHaveBeenCalledTimes(1)
      expect(statSync).toHaveBeenCalledTimes(3)
    })

    it('re-reads when mtime changes (live rename recovery)', () => {
      mockOpenclawFile(1000, openclawConfig({
        list: [{ id: 'old-name', workspace: WS }],
      }))
      expect(getMainAgentId()).toBe('old-name')

      mockOpenclawFile(2000, openclawConfig({
        list: [{ id: 'new-name', workspace: WS }],
      }))
      expect(getMainAgentId()).toBe('new-name')
      expect(readFileSync).toHaveBeenCalledTimes(2)
    })

    it('recovers when openclaw.json becomes available after being missing', () => {
      expect(() => getMainAgentId()).toThrow(/main agent/i)

      mockOpenclawFile(1000, openclawConfig({
        list: [{ id: 'boss', workspace: WS }],
      }))
      expect(getMainAgentId()).toBe('boss')
    })

    it('does not cache a stale config across consecutive getMainAgentId + getMainAgentName calls', () => {
      mockOpenclawFile(1000, openclawConfig({
        list: [{ id: 'boss', workspace: WS, identity: { name: 'Boss Man' } }],
      }))
      expect(getMainAgentId()).toBe('boss')
      expect(getMainAgentName()).toBe('Boss Man')
      // Both helpers share the same cache — only one parse total.
      expect(readFileSync).toHaveBeenCalledTimes(1)
    })
  })
})
