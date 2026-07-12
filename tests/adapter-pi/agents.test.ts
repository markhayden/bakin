/**
 * adapter-pi P5 — registry + agents surface under a temp PI_HOME.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-adapter-pi-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ home: join(testDir, 'bakin'), db: join(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createPiRuntimeAdapter } from '../../packages/adapter-pi/src/index'
import { getPiHome, getAgentWorkspaceDir, resetPiHome } from '../../packages/adapter-pi/src/home'
import { selectRuntimeMainAgent } from '../../packages/core/src/adapters/runtime/helpers'
import { RuntimeError } from '@bakin/core/adapters/runtime'

const adapter = createPiRuntimeAdapter()

beforeAll(async () => {
  resetPiHome()
  await adapter.initialize({ contentDir: join(testDir, 'bakin') })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('home resolution', () => {
  test('PI_HOME env wins', () => {
    expect(getPiHome()).toBe(join(testDir, 'pi'))
  })
})

describe('registry + agents surface', () => {
  test('initialize is write-free; provision seeds a main orchestrator resolvable by the neutral helper', async () => {
    // initialize alone (beforeAll) must not have seeded anything.
    expect((await adapter.agents.list()).length).toBe(0)
    await adapter.provisionToolAccess()
    const agents = await adapter.agents.list()
    expect(agents.length).toBe(1)
    const main = selectRuntimeMainAgent(agents)
    expect(main?.id).toBe('main')
    expect(main?.role).toBe('orchestrator')
    expect(String(main?.metadata?.workspace)).toBe(getAgentWorkspaceDir('main'))
    expect(existsSync(getAgentWorkspaceDir('main'))).toBe(true)
  })

  test('second provision does not re-seed', async () => {
    await adapter.provisionToolAccess()
    expect((await adapter.agents.list()).length).toBe(1)
  })

  test('create/update/get/remove round-trip with dir scaffolding + cleanup', async () => {
    const created = await adapter.agents.create({ id: 'scout', name: 'Scout', role: 'subagent', model: 'openai-codex/gpt-5.4' })
    expect(created.id).toBe('scout')
    expect(existsSync(getAgentWorkspaceDir('scout'))).toBe(true)

    const updated = await adapter.agents.update('scout', { name: 'Scout II', model: 'openai-codex/gpt-5.5' })
    expect(updated.name).toBe('Scout II')
    expect(updated.model).toBe('openai-codex/gpt-5.5')

    expect((await adapter.agents.get('scout'))?.name).toBe('Scout II')

    await adapter.agents.remove('scout')
    expect(await adapter.agents.get('scout')).toBeNull()
    expect(existsSync(getAgentWorkspaceDir('scout'))).toBe(false)
  })

  test('duplicate create and unknown update fail loudly', async () => {
    await expect(adapter.agents.create({ id: 'main', name: 'Dup' })).rejects.toThrow('already exists')
    await expect(adapter.agents.update('ghost', { name: 'x' })).rejects.toThrow('unknown agent')
  })

  test('invalid agent ids are rejected before touching the filesystem', async () => {
    await expect(adapter.agents.create({ id: '../evil', name: 'Evil' })).rejects.toThrow('invalid agent id')
  })
})

describe('workspace files', () => {
  test('write/read/list/stats/remove + traversal guard', async () => {
    await adapter.agents.writeWorkspaceFile('main', { path: 'AGENTS.md', content: '# Rules\nBe good.' })
    await adapter.agents.writeWorkspaceFile('main', { path: '.pi/skills/greet/SKILL.md', content: '# greet' })
    await adapter.agents.writeWorkspaceFile('main', { path: 'notes/scratch.txt', content: 'hi' })

    const files = await adapter.agents.listWorkspaceFiles('main')
    expect(files).toContain('AGENTS.md')
    expect(files).toContain(join('.pi', 'skills', 'greet', 'SKILL.md'))

    const agentsMd = await adapter.agents.readWorkspaceFile('main', 'AGENTS.md')
    expect(agentsMd?.content).toContain('Be good.')

    const stats = await adapter.agents.workspaceFileStats!('main')
    const byName = Object.fromEntries(stats!.map((s) => [s.name, s]))
    expect(byName['AGENTS.md'].kind).toBe('canonical')
    expect(byName['AGENTS.md'].bytes).toBeGreaterThan(0)
    expect(byName[join('.pi', 'skills', 'greet', 'SKILL.md')].kind).toBe('skill')
    expect(byName[join('notes', 'scratch.txt')].kind).toBe('memory')

    await expect(adapter.agents.readWorkspaceFile('main', '../../escape.md')).rejects.toThrow('escapes')

    await adapter.agents.removeWorkspaceFile('main', 'notes/scratch.txt')
    expect(await adapter.agents.readWorkspaceFile('main', 'notes/scratch.txt')).toBeNull()
  })

  // allowlist = SUBAGENT dispatch allowlist (agent ids) — never tool names.
  test('allowlist patches persist on the record; unknown agent is typed not_found', async () => {
    await adapter.agents.updateAllowlist('main', { add: ['scout', 'pixel'] })
    await adapter.agents.updateAllowlist('main', { remove: ['pixel'] })
    let main = await adapter.agents.get('main')
    expect(main?.metadata?.allowlist).toEqual(['scout'])

    await adapter.agents.updateAllowlist('main', { replace: [] })
    main = await adapter.agents.get('main')
    expect(main?.metadata?.allowlist).toBeUndefined()

    // Mutations addressing a missing agent reject typed not_found (R28) —
    // core classifies on kind, never message text.
    const rejection = await adapter.agents.updateAllowlist('ghost', { add: ['scout'] }).then(
      () => null,
      (err: unknown) => err,
    )
    expect(rejection).toBeInstanceOf(RuntimeError)
    expect((rejection as RuntimeError).kind).toBe('not_found')
  })

  test('corrupt registry fails loudly instead of silently starting empty', async () => {
    const registryPath = join(getPiHome(), 'agent', 'bakin-agents.json')
    const good = readFileSync(registryPath, 'utf-8')
    writeFileSync(registryPath, '{not json')
    await expect(adapter.agents.list()).rejects.toThrow('registry unreadable')
    writeFileSync(registryPath, good)
  })
})
