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

// Dynamic import to get fresh module per test
let getMainAgentId: typeof import('../../packages/core/src/main-agent').getMainAgentId

describe('main-agent', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.mocked(getSettings).mockReturnValue({} as any)
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    const mod = await import('../../packages/core/src/main-agent')
    getMainAgentId = mod.getMainAgentId
  })

  it('returns mainAgentId from settings when set', () => {
    vi.mocked(getSettings).mockReturnValue({ mainAgentId: 'main-operator' } as any)
    expect(getMainAgentId()).toBe('main-operator')
  })

  it('falls back to OpenClaw config when settings has no mainAgentId', () => {
    vi.mocked(getSettings).mockReturnValue({} as any)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      agents: {
        list: [{ id: 'main', identity: { name: 'Main Operator' } }],
      },
    }))
    expect(getMainAgentId()).toBe('main-operator') // lowercased
  })

  it('falls back to "main-operator" via OPENCLAW_ID_TO_BAKIN_NAME when no other source resolves', () => {
    vi.mocked(getSettings).mockReturnValue({} as any)
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    expect(getMainAgentId()).toBe('main-operator')
  })

  it('falls back to "main-operator" when OpenClaw has no main agent entry', () => {
    vi.mocked(getSettings).mockReturnValue({} as any)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      agents: { list: [{ id: 'pixel' }] },
    }))
    expect(getMainAgentId()).toBe('main-operator')
  })

  it('falls back to "main-operator" when OpenClaw main agent has no identity.name', () => {
    vi.mocked(getSettings).mockReturnValue({} as any)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      agents: { list: [{ id: 'main' }] },
    }))
    expect(getMainAgentId()).toBe('main-operator')
  })

  it('prefers settings over OpenClaw', () => {
    vi.mocked(getSettings).mockReturnValue({ mainAgentId: 'custom-agent' } as any)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      agents: { list: [{ id: 'main', identity: { name: 'Main Operator' } }] },
    }))
    expect(getMainAgentId()).toBe('custom-agent')
  })

  it('ignores empty string mainAgentId in settings', () => {
    vi.mocked(getSettings).mockReturnValue({ mainAgentId: '' } as any)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      agents: { list: [{ id: 'main', identity: { name: 'Main Operator' } }] },
    }))
    expect(getMainAgentId()).toBe('main-operator')
  })
})
