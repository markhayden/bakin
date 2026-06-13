/**
 * Tests for layered team context files (layered-context spec, C3).
 *
 * Coverage:
 *   - seedContextFiles creates global + role files once, never overwrites
 *   - refreshRoleContextBlocks updates only the managed block interior,
 *     preserving user additions byte-for-byte; seeds missing files
 *   - isRoleContextCurrent reflects block state
 *   - effectiveContextContent strips HTML comments + block markers, keeps
 *     block interior and user content
 *   - substituteTokens resolves all four tokens
 *   - resolveContextInputs: role selection (main → orchestrator), team layer
 *     via team.getAgentTeam hook, hook-missing fallback, absent files omitted
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-team-context-${Date.now()}-${randomUUID()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const silentLogger = {
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}
mock.module('../../src/core/logger', () => silentLogger)
mock.module('@/core/logger', () => silentLogger)

// Hook registry mock — per-test handler for team.getAgentTeam.
let agentTeamHandler: ((data: unknown) => unknown) | null = null
mock.module('../../src/lib/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: async <R,>(name: string, data: unknown): Promise<R | undefined> => {
      if (name === 'team.getAgentTeam' && agentTeamHandler) {
        return (await agentTeamHandler(data)) as R
      }
      return undefined
    },
  }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async <R,>(name: string, data: unknown): Promise<R | undefined> => {
      if (name === 'team.getAgentTeam' && agentTeamHandler) {
        return (await agentTeamHandler(data)) as R
      }
      return undefined
    },
  }),
}))

import {
  effectiveContextContent,
  getGlobalContextPath,
  getRoleContextPath,
  getTeamContextPath,
  isRoleContextCurrent,
  refreshRoleContextBlocks,
  resolveContextInputs,
  resolveTeamMembership,
  seedContextFiles,
  substituteTokens,
} from '../../src/core/team-context'
import { ROLE_DEFAULTS } from '../../src/core/team-context-defaults'
import { extractBlock } from '../../packages/core/src/agent-packages/managed-blocks'
import { MANAGED_BLOCK_ID } from '../../packages/core/src/agent-packages/composer'

const VARS = {
  agentId: 'pixel',
  agentName: 'Pixel',
  mainAgentId: 'main',
  mainAgentName: 'Roscoe',
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  agentTeamHandler = null
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('seedContextFiles', () => {
  it('creates global + both role files', () => {
    const { created } = seedContextFiles()
    expect(created).toHaveLength(3)
    expect(existsSync(getGlobalContextPath())).toBe(true)
    for (const role of ['orchestrator', 'subagent'] as const) {
      const content = readFileSync(getRoleContextPath(role), 'utf-8')
      expect(extractBlock(content, MANAGED_BLOCK_ID)).toBe(ROLE_DEFAULTS[role].trim())
    }
  })

  it('never overwrites existing files', () => {
    seedContextFiles()
    writeFileSync(getGlobalContextPath(), 'MY GLOBAL RULES')
    const { created } = seedContextFiles()
    expect(created).toHaveLength(0)
    expect(readFileSync(getGlobalContextPath(), 'utf-8')).toBe('MY GLOBAL RULES')
  })
})

describe('refreshRoleContextBlocks', () => {
  it('reports no updates when blocks are current', () => {
    seedContextFiles()
    expect(refreshRoleContextBlocks().updated).toHaveLength(0)
    expect(isRoleContextCurrent('orchestrator')).toBe(true)
  })

  it('rewrites a drifted block interior, preserving user additions', () => {
    seedContextFiles()
    const path = getRoleContextPath('subagent')
    const withUserText = 'MY SUBAGENT ADDITIONS\n\n' + readFileSync(path, 'utf-8')
    // Simulate an old binary's block content
    writeFileSync(path, withUserText.replace('## Bakin Mission Control', '## Old Heading'))
    expect(isRoleContextCurrent('subagent')).toBe(false)

    const { updated } = refreshRoleContextBlocks()
    expect(updated).toEqual(['subagent'])
    const after = readFileSync(path, 'utf-8')
    expect(after.startsWith('MY SUBAGENT ADDITIONS')).toBe(true)
    expect(extractBlock(after, MANAGED_BLOCK_ID)).toBe(ROLE_DEFAULTS.subagent.trim())
  })

  it('seeds missing role files', () => {
    const { updated } = refreshRoleContextBlocks()
    expect(updated.sort()).toEqual(['orchestrator', 'subagent'])
  })
})

describe('effectiveContextContent', () => {
  it('strips HTML comments and block markers, keeps interior + user text', () => {
    seedContextFiles()
    const raw = readFileSync(getRoleContextPath('subagent'), 'utf-8')
    const effective = effectiveContextContent(raw)
    expect(effective).toContain('## Bakin Mission Control')
    expect(effective).not.toContain('<!--')
    expect(effective).not.toContain('bakin:managed')
  })

  it('returns empty string for comment-only files (fresh global seed)', () => {
    seedContextFiles()
    expect(effectiveContextContent(readFileSync(getGlobalContextPath(), 'utf-8'))).toBe('')
  })
})

describe('substituteTokens', () => {
  it('resolves all four tokens, all occurrences', () => {
    const out = substituteTokens(
      '{{agentId}}/{{agentName}} reports to {{mainAgentName}} via bakin-{{mainAgentId}} and bakin-{{agentId}}',
      VARS,
    )
    expect(out).toBe('pixel/Pixel reports to Roscoe via bakin-main and bakin-pixel')
  })
})

describe('resolveTeamMembership', () => {
  it('returns the team id from team.getAgentTeam', async () => {
    agentTeamHandler = () => ({ id: 'media', label: 'Media' })
    expect(await resolveTeamMembership('pixel')).toBe('media')
  })

  it('returns null when the hook is unregistered or errors', async () => {
    expect(await resolveTeamMembership('pixel')).toBeNull()
    agentTeamHandler = () => { throw new Error('boom') }
    expect(await resolveTeamMembership('pixel')).toBeNull()
  })
})

describe('resolveContextInputs', () => {
  it('selects the subagent role for non-main agents and substitutes tokens', async () => {
    seedContextFiles()
    const inputs = await resolveContextInputs(VARS)
    expect(inputs.role?.id).toBe('subagent')
    expect(inputs.role?.content).toContain('bakin-pixel.bakin_exec_get_paths')
    expect(inputs.role?.content).not.toContain('{{agentId}}')
    // Fresh global seed is comment-only → omitted entirely
    expect(inputs.global).toBeUndefined()
  })

  it('selects the orchestrator role for the main agent', async () => {
    seedContextFiles()
    const inputs = await resolveContextInputs({ ...VARS, agentId: 'main', agentName: 'Roscoe' })
    expect(inputs.role?.id).toBe('orchestrator')
    expect(inputs.role?.content).toContain('Roscoe as orchestrator')
    expect(inputs.role?.content).toContain('bakin-main')
  })

  it('includes user global content once written', async () => {
    seedContextFiles()
    writeFileSync(getGlobalContextPath(), '# House Rules\n\n- {{agentName}} logs progress')
    const inputs = await resolveContextInputs(VARS)
    expect(inputs.global).toBe('# House Rules\n\n- Pixel logs progress')
  })

  it('includes the team layer when membership + file exist', async () => {
    seedContextFiles()
    agentTeamHandler = (d) => ((d as { id: string }).id === 'pixel' ? { id: 'media' } : null)
    writeFileSync(getTeamContextPath('media'), '# Media Team\n\n- Use the style guide')
    const inputs = await resolveContextInputs(VARS)
    expect(inputs.team).toEqual({ id: 'media', content: '# Media Team\n\n- Use the style guide' })
  })

  it('omits the team layer when the member has no context file', async () => {
    seedContextFiles()
    agentTeamHandler = () => ({ id: 'media' })
    const inputs = await resolveContextInputs(VARS)
    expect(inputs.team).toBeUndefined()
  })
})
