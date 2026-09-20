/**
 * #873 — agent-config mutators against the 2026.9.5 keyed registry.
 * Every mutation touches only agents.entries[<id>] and round-trips
 * ownership/defaults/gateway/unknown fields; a legacy list config upgrades
 * one-way on first mutation; a corrupt config is REFUSED, never replaced.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = mkdtempSync(join(tmpdir(), 'bakin-test-oc-agentcfg-'))

mock.module('../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => testHome,
  getOpenClawPath: (...parts: string[]) => join(testHome, ...parts),
  resetOpenClawHome: () => {},
}))
const contentDirMock = () => ({
  getContentDir: () => join(testHome, 'bakin'),
  getBakinPaths: () => ({ home: join(testHome, 'bakin'), db: join(testHome, 'bakin', 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import {
  upsertOpenClawAgentConfig,
  updateOpenClawAgentIdentity,
  updateAgentAllowlist,
  removeOpenClawAgentConfig,
  getWorkspacePath,
} from '../../packages/adapter-openclaw/src/agent-config'
import { resetOpenClawConfigCache } from '../../packages/adapter-openclaw/src/config'

const configPath = () => join(testHome, 'openclaw.json')

function writeConfig(config: Record<string, unknown>): void {
  writeFileSync(configPath(), JSON.stringify(config, null, 2))
  resetOpenClawConfigCache()
}

function readConfigFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath(), 'utf-8')) as Record<string, unknown>
}

/** A 9.5-shaped config with policy fields + unrelated sections to round-trip. */
function entriesConfig(): Record<string, unknown> {
  return {
    agents: {
      ownership: 'explicit',
      defaults: { model: { primary: 'openai/gpt-5.4' }, workspace: join(testHome, 'workspace') },
      entries: {
        main: {
          model: 'openai/gpt-5.5',
          identity: { name: 'Roscoe', emoji: '🐷' },
          subagents: { allowAgents: ['pixel'] },
          models: { 'openai/gpt-5.5': { agentRuntime: { id: 'codex' } } },
          workspace: join(testHome, 'workspace'),
        },
        pixel: {
          name: 'pixel',
          workspace: join(testHome, 'workspaces', 'pixel'),
          identity: { name: 'Pixel', emoji: '🎨' },
          model: { primary: 'openai/gpt-5.5' },
          futureField: { keep: true },
        },
      },
    },
    gateway: { auth: { token: 'SECRET-TOKEN' } },
    channels: { discord: { configured: true } },
  }
}

function agentsOf(file: Record<string, unknown>) {
  return file.agents as { ownership?: string; defaults?: unknown; list?: unknown; entries: Record<string, Record<string, unknown>> }
}

beforeEach(() => {
  rmSync(configPath(), { force: true })
  resetOpenClawConfigCache()
})

afterAll(() => rmSync(testHome, { recursive: true, force: true }))

describe('identity edits (#873)', () => {
  it('touches only entries[<id>].identity and round-trips everything else', () => {
    writeConfig(entriesConfig())
    updateOpenClawAgentIdentity('pixel', { name: 'Pixel Prime', emoji: '🖌️' })
    const file = readConfigFile()
    const agents = agentsOf(file)
    expect(agents.entries.pixel!.identity).toEqual({ name: 'Pixel Prime', emoji: '🖌️' })
    // Unknown entry fields + policy + unrelated sections survive.
    expect(agents.entries.pixel!.futureField).toEqual({ keep: true })
    expect(agents.ownership).toBe('explicit')
    expect(agents.entries.main!.models).toBeDefined()
    expect((file.gateway as { auth: { token: string } }).auth.token).toBe('SECRET-TOKEN')
    expect(agents.list).toBeUndefined()
  })

  it('throws typed not_found for an agent missing from an authoritative registry', () => {
    writeConfig(entriesConfig())
    expect(() => updateOpenClawAgentIdentity('ghost', { name: 'x' })).toThrow('Agent not found')
  })
})

describe('allowlist edits', () => {
  it('updates entries[<id>].subagents.allowAgents in place', () => {
    writeConfig(entriesConfig())
    updateAgentAllowlist('main', (current) => [...current, 'rolo'])
    const agents = agentsOf(readConfigFile())
    expect(agents.entries.main!.subagents).toEqual({ allowAgents: ['pixel', 'rolo'] })
  })

  it('main on a virgin config materializes into entries', () => {
    writeConfig({ agents: { defaults: { workspace: join(testHome, 'workspace') } } })
    updateAgentAllowlist('main', () => ['pixel'])
    const agents = agentsOf(readConfigFile())
    expect(agents.list).toBeUndefined()
    expect((agents.entries.main!.subagents as { allowAgents: string[] }).allowAgents).toEqual(['pixel'])
  })

  it('main missing from an authoritative registry throws instead of being invented', () => {
    writeConfig({ agents: { ownership: 'explicit', entries: { pixel: {} } } })
    expect(() => updateAgentAllowlist('main', () => [])).toThrow('Agent not found')
  })
})

describe('removal', () => {
  it('deletes the entry and scrubs it from every other allowlist', () => {
    writeConfig(entriesConfig())
    removeOpenClawAgentConfig('pixel')
    const agents = agentsOf(readConfigFile())
    expect(agents.entries.pixel).toBeUndefined()
    expect((agents.entries.main!.subagents as { allowAgents: string[] }).allowAgents).toEqual([])
    expect(agents.ownership).toBe('explicit')
  })

  it('removing from a legacy list config upgrades it to entries', () => {
    writeConfig({ agents: { list: [{ id: 'main' }, { id: 'pixel' }] } })
    removeOpenClawAgentConfig('pixel')
    const agents = agentsOf(readConfigFile())
    expect(agents.list).toBeUndefined()
    expect(Object.keys(agents.entries)).toEqual(['main'])
  })

  it('removing an unknown agent writes nothing', () => {
    writeConfig(entriesConfig())
    const before = readFileSync(configPath(), 'utf-8')
    removeOpenClawAgentConfig('ghost')
    expect(readFileSync(configPath(), 'utf-8')).toBe(before)
  })
})

describe('upsert (creation fallback path)', () => {
  it('creates entries[<id>] on a 9.5 config without inventing main or list', () => {
    writeConfig(entriesConfig())
    upsertOpenClawAgentConfig({ id: 'rolo', name: 'Rolo', workspace: join(testHome, 'workspaces', 'rolo') })
    const agents = agentsOf(readConfigFile())
    expect(agents.entries.rolo).toEqual(expect.objectContaining({ name: 'Rolo' }))
    expect(agents.list).toBeUndefined()
    expect(existsSync(join(testHome, 'workspaces', 'rolo'))).toBe(true)
  })

  it('upgrades a legacy list config to entries on first upsert', () => {
    writeConfig({ agents: { list: [{ id: 'main', workspace: '/mw' }] } })
    upsertOpenClawAgentConfig({ id: 'pixel', name: 'Pixel', workspace: join(testHome, 'workspaces', 'pixel') })
    const agents = agentsOf(readConfigFile())
    expect(agents.list).toBeUndefined()
    expect(Object.keys(agents.entries).sort()).toEqual(['main', 'pixel'])
    expect(agents.entries.main!.workspace).toBe('/mw')
  })

})

describe('workspace resolution', () => {
  it('honors per-entry workspace under the keyed registry', () => {
    const config = entriesConfig()
    writeConfig(config)
    expect(getWorkspacePath('pixel')).toBe(join(testHome, 'workspaces', 'pixel'))
    expect(getWorkspacePath('main')).toBe(join(testHome, 'workspace'))
  })
})
