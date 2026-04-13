import { describe, it, expect, beforeEach, vi } from 'vitest'

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

    it('returns OpenClaw agent id when settings has no mainAgentId', () => {
      vi.mocked(getSettings).mockReturnValue({} as any)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        agents: {
          list: [{ id: 'main', identity: { name: 'Main Operator' } }],
        },
      }))
      expect(getMainAgentId()).toBe('main')
    })

    it('falls back to "main" when OpenClaw config is unreadable', () => {
      vi.mocked(getSettings).mockReturnValue({} as any)
      vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
      expect(getMainAgentId()).toBe('main')
    })

    it('falls back to "main" when OpenClaw has no main agent entry', () => {
      vi.mocked(getSettings).mockReturnValue({} as any)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        agents: { list: [{ id: 'pixel' }] },
      }))
      expect(getMainAgentId()).toBe('main')
    })

    it('returns "main" when OpenClaw main agent has no identity.name', () => {
      vi.mocked(getSettings).mockReturnValue({} as any)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        agents: { list: [{ id: 'main' }] },
      }))
      expect(getMainAgentId()).toBe('main')
    })

    it('prefers settings.mainAgentId over OpenClaw config', () => {
      vi.mocked(getSettings).mockReturnValue({ mainAgentId: 'custom-agent' } as any)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        agents: { list: [{ id: 'main', identity: { name: 'Main Operator' } }] },
      }))
      expect(getMainAgentId()).toBe('custom-agent')
    })

    it('ignores empty-string mainAgentId in settings', () => {
      vi.mocked(getSettings).mockReturnValue({ mainAgentId: '' } as any)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        agents: { list: [{ id: 'main' }] },
      }))
      expect(getMainAgentId()).toBe('main')
    })
  })

  describe('getMainAgentName', () => {
    it('returns identity.name when set on the main agent', () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        agents: { list: [{ id: 'main', identity: { name: 'Main Operator' } }] },
      }))
      expect(getMainAgentName()).toBe('Main Operator')
    })

    it('falls back to title-cased id when identity.name is missing', () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        agents: { list: [{ id: 'main' }] },
      }))
      expect(getMainAgentName()).toBe('Main')
    })

    it('falls back to title-cased id when OpenClaw config is unreadable', () => {
      vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
      expect(getMainAgentName()).toBe('Main')
    })

    it('uses settings.mainAgentId to locate the matching agent entry', () => {
      vi.mocked(getSettings).mockReturnValue({ mainAgentId: 'orchestrator' } as any)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        agents: { list: [
          { id: 'main', identity: { name: 'Wrong' } },
          { id: 'orchestrator', identity: { name: 'Captain' } },
        ] },
      }))
      expect(getMainAgentName()).toBe('Captain')
    })
  })
})
