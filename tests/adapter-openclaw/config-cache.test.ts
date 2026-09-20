import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { agentListFrom, readOpenClawConfig, resetOpenClawConfigCache } from '../../packages/adapter-openclaw/src/config'

describe('OpenClaw config cache', () => {
  const originalOpenClawHome = process.env.OPENCLAW_HOME
  const homes: string[] = []

  afterEach(() => {
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    resetOpenClawConfigCache()
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true })
    }
  })

  function writeConfig(name: string, mtime: Date): string {
    const home = mkdtempSync(join(tmpdir(), 'bakin-openclaw-cache-'))
    homes.push(home)
    mkdirSync(home, { recursive: true })
    const path = join(home, 'openclaw.json')
    writeFileSync(path, JSON.stringify({
      agents: { list: [{ id: 'main', identity: { name } }] },
    }), 'utf-8')
    utimesSync(path, mtime, mtime)
    return home
  }

  it('does not reuse cached config when OPENCLAW_HOME changes to a same-mtime file', () => {
    const mtime = new Date('2026-01-01T00:00:00.000Z')
    const first = writeConfig('First', mtime)
    const second = writeConfig('Second', mtime)

    process.env.OPENCLAW_HOME = first
    expect(readOpenClawConfig()?.agents?.list?.[0]?.identity?.name).toBe('First')

    process.env.OPENCLAW_HOME = second
    expect(readOpenClawConfig()?.agents?.list?.[0]?.identity?.name).toBe('Second')
  })
})

describe('agentListFrom', () => {
  const originalOpenClawHome = process.env.OPENCLAW_HOME
  afterEach(() => {
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
  })

  it('returns the declared agent list when present', () => {
    const list = agentListFrom({ agents: { list: [{ id: 'main' }, { id: 'pixel' }] } })
    expect(list.map((a) => a.id)).toEqual(['main', 'pixel'])
  })

  it('synthesizes an implicit main agent when only defaults exist (minimal config)', () => {
    process.env.OPENCLAW_HOME = join(tmpdir(), 'bakin-agentlist-test')
    const list = agentListFrom({ agents: { defaults: { model: { primary: 'openai/gpt-5.5' }, workspace: '/w' } } })
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('main')
    expect((list[0].model as { primary?: string } | undefined)?.primary).toBe('openai/gpt-5.5')
  })

  it('returns an empty list for a null config', () => {
    expect(agentListFrom(null)).toEqual([])
  })
})

describe('agentListFrom — 2026.9.5 keyed entries (#873)', () => {
  // Representative slice of a REAL migrated config (this box, 2026-09-20):
  // string-model main with a models map + allowlist, object-model pixel.
  const entriesConfig = {
    agents: {
      ownership: 'explicit',
      defaults: { model: { primary: 'openai/gpt-5.4' }, workspace: '/home/ws' },
      entries: {
        main: {
          model: 'openai/gpt-5.5',
          identity: { name: 'Roscoe', emoji: '🐷' },
          subagents: { allowAgents: ['pixel'] },
          models: { 'openai/gpt-5.5': { agentRuntime: { id: 'codex' } } },
          workspace: '/home/ws',
        },
        pixel: {
          name: 'pixel',
          workspace: '/home/workspaces/pixel',
          identity: { name: 'Pixel', emoji: '🎨' },
          model: { primary: 'openai/gpt-5.5' },
        },
      },
    },
  } as never

  it('decodes every entry with the map key as the agent id', () => {
    const list = agentListFrom(entriesConfig)
    expect(list.map((a) => a.id).sort()).toEqual(['main', 'pixel'])
    const main = list.find((a) => a.id === 'main')!
    expect(main.model).toBe('openai/gpt-5.5') // string model passes through
    expect(main.identity?.name).toBe('Roscoe')
    expect(main.subagents?.allowAgents).toEqual(['pixel'])
    // Unknown entry fields survive the decode untouched.
    expect((main as { models?: unknown }).models).toBeDefined()
    const pixel = list.find((a) => a.id === 'pixel')!
    expect((pixel.model as { primary?: string }).primary).toBe('openai/gpt-5.5')
  })

  it('the map key wins over any embedded id field', () => {
    const list = agentListFrom({ agents: { entries: { rolo: { id: 'impostor' } as never } } } as never)
    expect(list.map((a) => a.id)).toEqual(['rolo'])
  })

  it('entries wins over a lingering legacy list (hybrid file)', () => {
    const list = agentListFrom({
      agents: { entries: { main: {} }, list: [{ id: 'stale-a' }, { id: 'stale-b' }] },
    } as never)
    expect(list.map((a) => a.id)).toEqual(['main'])
  })

  it('an EMPTY entries map is authoritative — no fabricated Main', () => {
    expect(agentListFrom({ agents: { entries: {}, defaults: { workspace: '/w' } } } as never)).toEqual([])
  })

  it('ownership explicit means never synthesize, even without entries', () => {
    expect(agentListFrom({ agents: { ownership: 'explicit', defaults: { workspace: '/w' } } } as never)).toEqual([])
  })
})
